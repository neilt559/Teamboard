import { handle, parseId } from '@/lib/http';
import { guardedPatch } from '@/lib/patch';
import { deleteWithSnapshot } from '@/lib/audit';
import { MEETING_NORM } from '@/lib/queries/project';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

const SCOPE = 'tb_can_see_project($1::bigint, project_id)';
// Attendance is coerced with String() (a non-string no longer gives a 500). A meeting can't change series
// or project.
const COLUMNS = {
  title: { type: 'text', text: true, norm: MEETING_NORM.title },
  attendance: { type: 'text', text: true, norm: MEETING_NORM.attendance },
  notes: { type: 'text', text: true, norm: MEETING_NORM.notes },
  meeting_date: { type: 'text', norm: MEETING_NORM.meeting_date },
};

// PATCH /api/project-meetings/:id: the editor sends only the fields that changed, each text field with the
// value it opened with (base). -> { ok, row }; 409 lists the fields someone else changed.
export const PATCH = handle(async ({ viewer, params, body, now }) => {
  const { row } = await guardedPatch({
    table: 'project_meetings', id: parseId(params.id), body: await body(), columns: COLUMNS, actorId: viewer.id,
    scopeSql: SCOPE, scopeParams: [String(viewer.id)], bumpProjectRev: true, now,
  });
  return { ok: true, row };
}, { legacyWrite: true });

// DELETE /api/project-meetings/:id: confirmed in the UI; snapshot in audit_log.
// Missing or not visible: { ok } either way (no existence leak, design §4.6 / §7.1).
export const DELETE = handle(async ({ viewer, params }) => {
  await deleteWithSnapshot({
    table: 'project_meetings', id: parseId(params.id), actorId: viewer.id, action: 'project_meeting.delete',
    scopeSql: SCOPE, scopeParams: [String(viewer.id)], bumpProjectRev: true,
  });
  return { ok: true };
}, { legacyWrite: true });
