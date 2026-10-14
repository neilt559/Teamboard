import { handle, HttpError, str, bad, forbidden, notFound, parseId, noNul } from '@/lib/http';
import { guardedPatch, norm } from '@/lib/patch';
import { deleteWithSnapshot } from '@/lib/audit';
import { isAdmin } from '@/lib/policy';
import { CATEGORIES, STATUSES } from '@/lib/suggestions';
import { suggestionMeta, activeUserCount, canChangeStatus, loadSuggestion } from '@/lib/queries/suggestions';
import { writableSql, ARCHIVED_MESSAGE } from '@/lib/queries/spaces';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// Suggestion edits (design §8.2; inventory §1.15; rules 27-28; §13 #13).
//   title, details, category, anonymous: the author only (403 for anyone else), now in ONE statement.
//     title and details are base-compared (lib/patch.js): the edit form sends the values it opened with.
//   status: anyone while there are fewer than 50 active users, then culture organizers and admins only;
//     records status_changed_by / status_changed_at.
//   hidden: admins only (moderation; hidden suggestions disappear for everyone else).
// The response never carries the author's user_id (an anonymous post stays anonymous to everyone).
// Release 2 (design-amendments A5): a suggestion in a thread space the viewer can't read is the same 404 as a
// missing one (tb_can_read_space, checked first and again in the UPDATE itself); in an archived office or team
// space nothing changes except by an admin (409).

const AUTHOR_KEYS = ['title', 'details', 'category', 'anonymous'];
const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const isoAt = (ms) => new Date(ms).toISOString();

const COLUMNS = {
  title: { type: 'text', text: true, norm: norm.line(160) },
  details: { type: 'text', text: true, norm: (v) => str(v, 5000) },     // trimmed, as today
  category: { type: 'text' },
  anonymous: { type: 'boolean' },
  status: { type: 'text' },
  status_changed_by: { type: 'bigint' },
  status_changed_at: { type: 'timestamptz' },
  hidden_at: { type: 'timestamptz' },
  hidden_by: { type: 'bigint' },
  updated_at: { type: 'timestamptz' },
};
// What a PATCH reads back: never user_id.
const RETURNING = ['title', 'details', 'category', 'status', 'anonymous', 'created_at', 'updated_at', 'hidden_at'];
const PUBLIC = ['id', ...RETURNING];
const publicRow = (r) => {
  if (!r) return r;
  const out = {};
  for (const k of PUBLIC) if (k in r) out[k] = r[k] instanceof Date ? r[k].toISOString() : r[k];
  if ('id' in out) out.id = String(out.id);
  out.hidden = r.hidden_at != null;
  delete out.hidden_at;
  return out;
};

export const PATCH = handle(async ({ viewer, params, body, now }) => {
  const id = parseId(params.id);
  const b = await body();
  const admin = isAdmin(viewer);
  const s = await suggestionMeta(viewer, id);
  if (!s || (s.hidden && !admin)) throw notFound('Suggestion not found');
  const mine = s.user_id != null && s.user_id === String(viewer.id);
  const authorKeys = AUTHOR_KEYS.filter((k) => has(b, k));
  if (authorKeys.length && !mine) throw forbidden('Only the person who posted this can edit it.');
  if (!s.writable) throw new HttpError(409, ARCHIVED_MESSAGE, { code: 'archived' });

  // Validate everything before writing anything (today a bad title after a status change half-applied).
  const patch = {};
  if (has(b, 'status')) {
    if (!STATUSES.some((x) => x.key === b.status)) throw bad('Unknown status');
    if (!canChangeStatus(viewer, await activeUserCount())) {
      throw forbidden('Only culture organizers and admins can change the status.');
    }
    patch.status = b.status;
    patch.status_changed_by = String(viewer.id);
    patch.status_changed_at = isoAt(now);
  }
  if (has(b, 'title')) {
    const title = noNul(str(b.title, 160));                       // a NUL can't be stored: 400, not 500
    if (!title) throw bad('A suggestion needs a title.');
    patch.title = title;
  }
  if (has(b, 'details')) patch.details = b.details == null ? '' : noNul(String(b.details));   // norm str()s it anyway
  if (has(b, 'category') && CATEGORIES.some((c) => c.key === b.category)) patch.category = b.category;  // else ignored, as today
  if (has(b, 'anonymous')) patch.anonymous = !!b.anonymous;
  if (has(b, 'hidden')) {
    if (!admin) throw forbidden('Only admins can hide suggestions.');
    patch.hidden_at = b.hidden ? isoAt(now) : null;
    patch.hidden_by = b.hidden ? String(viewer.id) : null;
  }
  if (Object.keys(patch).length) patch.updated_at = isoAt(now);

  const base = {};
  if (b.base && typeof b.base === 'object') {
    for (const k of ['title', 'details']) if (has(patch, k) && has(b.base, k)) base[k] = b.base[k];
  }

  // Race-safe scope: still readable and writable for the viewer; author fields only while it is still the author's
  // row; non-admins only while not hidden.
  const scopeParams = [String(viewer.id)];
  const scope = [
    'tb_can_read_space($1::bigint, suggestions.scope, suggestions.office_id, suggestions.team_id)',
    writableSql('$1::bigint', 'suggestions.scope', 'suggestions.office_id', 'suggestions.team_id'),
  ];
  if (authorKeys.length) scope.push('user_id = $1::bigint');
  if (!admin) scope.push('hidden_at IS NULL');

  let row;
  try {
    ({ row } = await guardedPatch({
      table: 'suggestions', id, body: { ...patch, base }, columns: COLUMNS, actorId: viewer.id,
      scopeSql: scope.join(' AND '), scopeParams, now, returning: RETURNING,
      notFound: new HttpError(404, 'gone', { message: 'This was deleted by someone else.' }),
    }));
  } catch (e) {
    if (e instanceof HttpError && e.status === 409 && e.extra?.current) e.extra.current = publicRow(e.extra.current);
    throw e;
  }
  const full = await loadSuggestion(viewer, id);
  return { ok: true, row: full || publicRow(row) };
}, { legacyWrite: true });

// Only the author can delete their own suggestion (as today). Votes and replies go with it (cascade);
// a JSON snapshot of the suggestion and its replies goes to audit_log in the same statement.
// Missing, or in a space the viewer can't read -> { ok: true } (no existence leak); someone else's -> 403;
// archived space -> 409.
export const DELETE = handle(async ({ viewer, params }) => {
  const id = parseId(params.id);
  const s = await suggestionMeta(viewer, id);
  if (!s) return { ok: true };
  if (s.user_id !== String(viewer.id)) throw forbidden('Only the person who posted this can delete it.');
  if (!s.writable) throw new HttpError(409, ARCHIVED_MESSAGE, { code: 'archived' });
  const r = await deleteWithSnapshot({
    table: 'suggestions', id, actorId: viewer.id, action: 'suggestion.delete',
    scopeSql: `suggestions.user_id = $1::bigint
      AND tb_can_read_space($1::bigint, suggestions.scope, suggestions.office_id, suggestions.team_id)
      AND ${writableSql('$1::bigint', 'suggestions.scope', 'suggestions.office_id', 'suggestions.team_id')}`,
    scopeParams: [String(viewer.id)],
    children: { replies: { table: 'suggestion_replies', fk: 'suggestion_id' } },
  });
  if (!r.deleted && r.existed) {
    // Changed meanwhile: answer from what it is now.
    const now = await suggestionMeta(viewer, id);
    if (now && now.user_id !== String(viewer.id)) throw forbidden('Only the person who posted this can delete it.');
    if (now && !now.writable) throw new HttpError(409, ARCHIVED_MESSAGE, { code: 'archived' });
  }
  return { ok: true };
}, { legacyWrite: true });
