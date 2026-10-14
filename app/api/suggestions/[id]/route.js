import { handle, HttpError, str, bad, forbidden, notFound, parseId, noNul } from '@/lib/http';
import { guardedPatch, norm } from '@/lib/patch';
import { deleteWithSnapshot } from '@/lib/audit';
import { CATEGORIES, STATUSES, TITLE_MAX, DETAILS_MAX, ANNOUNCEMENT_MAX } from '@/lib/suggestions';
import {
  suggestionMeta, activeUserCount, canChangeStatus, canHideKind, loadSuggestion,
} from '@/lib/queries/suggestions';
import { writableSql, archivedError } from '@/lib/queries/spaces';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// Post edits on the Suggestions/Announcements boards (design §8.2; inventory §1.15; rules 27-28; §13 #13;
// design-amendments A10).
//   title, details: the author only (403 for anyone else), base-compared (lib/patch.js): the edit form sends the
//     values it opened with. An announcement's details is its body (up to 10,000 characters).
//   category, anonymous: the author of a suggestion. An announcement has no category, and is never anonymous
//     (anonymous: true is 400).
//   status: suggestions only; anyone while there are fewer than 50 active users, then culture organizers and admins
//     only; records status_changed_by / status_changed_at.
//   hidden: moderation, the post disappears for everyone else: suggestions admins only, announcements admins and
//     culture organizers.
// The response never carries the author's user_id (an anonymous post stays anonymous to everyone). A post on a board
// the viewer can't read is the same 404 as a missing one (tb_can_read_space, checked first and again in the UPDATE
// itself); on an archived office's board nothing changes except by an admin (409). The kind never changes.

const AUTHOR_KEYS = ['title', 'details', 'category', 'anonymous'];
const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const isoAt = (ms) => new Date(ms).toISOString();

const columns = (announcement) => ({
  title: { type: 'text', text: true, norm: norm.line(TITLE_MAX) },
  details: { type: 'text', text: true, norm: (v) => str(v, announcement ? ANNOUNCEMENT_MAX : DETAILS_MAX) },   // trimmed
  category: { type: 'text' },
  anonymous: { type: 'boolean' },
  status: { type: 'text' },
  status_changed_by: { type: 'bigint' },
  status_changed_at: { type: 'timestamptz' },
  hidden_at: { type: 'timestamptz' },
  hidden_by: { type: 'bigint' },
  updated_at: { type: 'timestamptz' },
});
// What a PATCH reads back: never user_id.
const RETURNING = ['kind', 'title', 'details', 'category', 'status', 'anonymous', 'created_at', 'updated_at', 'hidden_at'];
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
  const s = await suggestionMeta(viewer, id);
  const seesHidden = !!s && canHideKind(viewer, s.kind);
  if (!s || (s.hidden && !seesHidden)) throw notFound('Suggestion not found');
  const announcement = s.kind === 'announcement';
  const mine = s.user_id != null && s.user_id === String(viewer.id);
  const authorKeys = AUTHOR_KEYS.filter((k) => has(b, k));
  if (authorKeys.length && !mine) throw forbidden('Only the person who posted this can edit it.');
  if (!s.writable) throw archivedError();

  // Validate everything before writing anything (today a bad title after a status change half-applied).
  const patch = {};
  if (has(b, 'status')) {
    if (announcement) throw bad('Announcements don’t have a status.');
    if (!STATUSES.some((x) => x.key === b.status)) throw bad('Unknown status');
    if (!canChangeStatus(viewer, await activeUserCount())) {
      throw forbidden('Only culture organizers and admins can change the status.');
    }
    patch.status = b.status;
    patch.status_changed_by = String(viewer.id);
    patch.status_changed_at = isoAt(now);
  }
  if (has(b, 'title')) {
    const title = noNul(str(b.title, TITLE_MAX));                  // a NUL can't be stored: 400, not 500
    if (!title) throw bad(announcement ? 'An announcement needs a title.' : 'A suggestion needs a title.');
    patch.title = title;
  }
  if (has(b, 'details')) {
    patch.details = b.details == null ? '' : noNul(String(b.details));   // the column norm str()s it
    if (announcement && !str(patch.details, ANNOUNCEMENT_MAX)) throw bad('An announcement can’t be empty — delete it instead.');
  }
  if (has(b, 'category') && !announcement && CATEGORIES.some((c) => c.key === b.category)) patch.category = b.category;  // else ignored, as today
  if (has(b, 'anonymous')) {
    if (announcement && b.anonymous) throw bad('Announcements always show who posted them.');
    if (!announcement) patch.anonymous = !!b.anonymous;
  }
  if (has(b, 'hidden')) {
    if (!canHideKind(viewer, s.kind)) {
      throw forbidden(announcement ? 'Only admins and culture organizers can hide announcements.' : 'Only admins can hide suggestions.');
    }
    patch.hidden_at = b.hidden ? isoAt(now) : null;
    patch.hidden_by = b.hidden ? String(viewer.id) : null;
  }
  if (Object.keys(patch).length) patch.updated_at = isoAt(now);

  const base = {};
  if (b.base && typeof b.base === 'object') {
    for (const k of ['title', 'details']) if (has(patch, k) && has(b.base, k)) base[k] = b.base[k];
  }

  // Race-safe scope: still readable and writable for the viewer and still this kind; author fields only while it
  // is still the author's row; hidden rows only for those who see hidden posts of this kind.
  const scopeParams = [String(viewer.id), s.kind];
  const scope = [
    'tb_can_read_space($1::bigint, suggestions.scope, suggestions.office_id, suggestions.team_id)',
    writableSql('$1::bigint', 'suggestions.scope', 'suggestions.office_id', 'suggestions.team_id'),
    'suggestions.kind = $2::text',
  ];
  if (authorKeys.length) scope.push('user_id = $1::bigint');
  if (!seesHidden) scope.push('hidden_at IS NULL');

  let row;
  try {
    ({ row } = await guardedPatch({
      table: 'suggestions', id, body: { ...patch, base }, columns: columns(announcement), actorId: viewer.id,
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

// Only the author can delete their own post (as today). Votes and replies go with it (cascade); a JSON snapshot of
// the post and its replies goes to audit_log in the same statement.
// Missing, or on a board the viewer can't read -> { ok: true } (no existence leak); someone else's -> 403;
// archived office -> 409.
export const DELETE = handle(async ({ viewer, params }) => {
  const id = parseId(params.id);
  const s = await suggestionMeta(viewer, id);
  if (!s) return { ok: true };
  if (s.user_id !== String(viewer.id)) throw forbidden('Only the person who posted this can delete it.');
  if (!s.writable) throw archivedError();
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
    if (now && !now.writable) throw archivedError();
  }
  return { ok: true };
}, { legacyWrite: true });
