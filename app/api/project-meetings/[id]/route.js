import { handle, bad, noNul, parseId } from '@/lib/http';
import { guardedPatch } from '@/lib/patch';
import { MEETING_NORM, MEETING_TEXT, seriesIdOf, seriesFitsMeeting } from '@/lib/queries/project';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

const SCOPE = 'tb_can_see_project($1::bigint, project_id)';
const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
// Attendance is coerced with String() (a non-string no longer gives a 500). A meeting can't change project; since
// A9 (design-amendments A9.2) its series is an optional label it can move between (or out of), and it gains a time,
// a place and archived.
const COLUMNS = {
  title: { type: 'text', text: true, norm: MEETING_NORM.title },
  attendance: { type: 'text', text: true, norm: MEETING_NORM.attendance },
  notes: { type: 'text', text: true, norm: MEETING_NORM.notes },
  location: { type: 'text', text: true, norm: MEETING_NORM.location },
  meeting_date: { type: 'text', norm: MEETING_NORM.meeting_date },
  meeting_time: { type: 'text', norm: MEETING_NORM.meeting_time },
  series_id: { type: 'bigint', norm: seriesIdOf },
  archived: { type: 'boolean', norm: (v) => !!v },
};

// PATCH /api/project-meetings/:id: the editor sends only the fields that changed, each text field with the
// value it opened with (base); { archived: true | false } archives or restores it. -> { ok, row }; 409 lists the
// fields someone else changed. A series of another project is a 400.
export const PATCH = handle(async ({ viewer, params, body, now }) => {
  const id = parseId(params.id);
  const b = await body();
  for (const k of MEETING_TEXT) if (has(b, k)) noNul(b[k]);
  if (has(b, 'series_id') && !(await seriesFitsMeeting(viewer, id, seriesIdOf(b.series_id)))) {
    throw bad('That meeting series isn’t in this project.');
  }
  const { row } = await guardedPatch({
    table: 'project_meetings', id, body: b, columns: COLUMNS, actorId: viewer.id,
    scopeSql: SCOPE, scopeParams: [String(viewer.id)], bumpProjectRev: true, now,
  });
  return { ok: true, row };
}, { legacyWrite: true });

// DELETE /api/project-meetings/:id: since A9 a meeting is archived, never deleted ("Delete only inside edit mode, now
// archive"); an old open tab's delete archives it too. Missing or not visible: { ok } either way (no existence
// leak, design §4.6 / §7.1).
export const DELETE = handle(async ({ viewer, params, now }) => {
  try {
    await guardedPatch({
      table: 'project_meetings', id: parseId(params.id), body: { archived: true }, columns: { archived: COLUMNS.archived },
      actorId: viewer.id, scopeSql: SCOPE, scopeParams: [String(viewer.id)], bumpProjectRev: true, now,
    });
  } catch (e) {
    if (e?.status !== 404) throw e;
  }
  return { ok: true };
}, { legacyWrite: true });
