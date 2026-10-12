import { handle, forbidden } from '@/lib/http';
import { requireVisibleProject, canRemoveMember } from '@/lib/access';
import { memberRow, removeMember } from '@/lib/queries/project';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// DELETE /api/projects/:id/members/:userId: soft removal (removed_at, removed_by) plus an audit row (design §6).
// Allowed for yourself ("Leave project"), the person who added them, L2+ who can see the project, and admins.
// -> { ok, removed, still_visible } (still_visible: whether the caller can still see the project).
export const DELETE = handle(async ({ viewer, params }) => {
  const p = await requireVisibleProject(viewer, params.id);
  const m = await memberRow(viewer, params.id, params.userId);
  if (!m) return { ok: true, removed: 0, still_visible: true };
  if (!canRemoveMember(viewer, p, m)) throw forbidden('You can remove yourself, or people you added.');
  const r = await removeMember(viewer, params.id, params.userId);
  return { ok: true, ...r };
});
