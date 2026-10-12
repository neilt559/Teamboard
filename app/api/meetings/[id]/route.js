import { handle, parseId, ymd, bad } from '@/lib/http';
import { guardedPatch, norm } from '@/lib/patch';
import { deleteWithSnapshot } from '@/lib/audit';
import { shapeMeeting } from '@/lib/queries/offices';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// Office meetings (design §8.2, inventory §1.8). Office-internal: tb_can_see_office in the same statement as
// the write, so a meeting in an office you can't see answers 404, exactly like a missing one.
const SCOPE = 'tb_can_see_office($1::bigint, office_id)';

// '' or null clears the date; anything else must be a real 'YYYY-MM-DD' (date-only values stay TEXT).
const dateNorm = (v) => {
  if (v == null || v === '') return null;
  const d = ymd(v);
  if (!d) throw bad('Invalid date.');
  return d;
};

const COLUMNS = {
  title: { type: 'text', text: true, norm: norm.lineOr(300, 'Meeting') },     // blank -> 'Meeting', as today
  minutes: { type: 'text', text: true, norm: norm.text(100_000) },            // multi-line: capped, not trimmed
  meeting_date: { type: 'text', norm: dateNorm },                             // discrete: last write wins
};

// PATCH {title?, meeting_date?, minutes?, base?: {title?, minutes?}} -> { ok, row }. Text fields compare
// against their base (409 with the current row when someone else changed them); the date is last-write-wins.
// The office can't be changed (as today).
export const PATCH = handle(async ({ viewer, params, body, now }) => {
  const id = parseId(params.id);
  const b = await body();
  const { row } = await guardedPatch({
    table: 'meetings', id, body: b, columns: COLUMNS, actorId: viewer.id, now,
    scopeSql: SCOPE, scopeParams: [String(viewer.id)],
  });
  return { ok: true, row: { ...shapeMeeting(row), updated_by_name: row.updated_by_name ?? null } };
}, { legacyWrite: true });

// DELETE: hard delete with a JSON snapshot in the same statement (§13 #12). Already gone, or in an office the
// caller can't see: { ok: true } either way, so a hidden meeting answers exactly like a missing one (§4.6, §7.1).
// The scoped statement never deletes a hidden row.
export const DELETE = handle(async ({ viewer, params }) => {
  const id = parseId(params.id);
  await deleteWithSnapshot({
    table: 'meetings', id, actorId: viewer.id, action: 'meeting.delete',
    scopeSql: SCOPE, scopeParams: [String(viewer.id)],
  });
  return { ok: true };
}, { legacyWrite: true });
