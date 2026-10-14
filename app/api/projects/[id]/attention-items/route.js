import { handle, HttpError } from '@/lib/http';
import { listAttention, createAttention } from '@/lib/queries/project-items';
import { chicagoToday } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/projects/:id/attention-items -> { items: [...], today } (design-amendments A8): every attention item of
// the project, received and archived ones included (status, archived), each with flag ('overdue' | 'soon' | '' on
// today's Central date, open items only). Anyone who can see the project; otherwise the same 404 as a missing one.
export const GET = handle(async ({ viewer, params, now }) => {
  const today = chicagoToday(now);
  const items = await listAttention(viewer, params.id, today);
  if (!items) throw new HttpError(404, 'Project not found');
  return { items, today };
});

// POST /api/projects/:id/attention-items {item, from_party?, need_by?, note?} -> { ok, row }. item (what's needed)
// required; need_by 'YYYY-MM-DD' or empty. A new item is open. Anyone who can see the project (A8.2); bumps
// projects.rev.
export const POST = handle(async ({ viewer, params, body, now }) => {
  const row = await createAttention(viewer, params.id, await body(), chicagoToday(now));
  return { ok: true, row };
});
