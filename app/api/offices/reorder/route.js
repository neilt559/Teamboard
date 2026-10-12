import { handle, bad, parseId } from '@/lib/http';
import { reorderOffices } from '@/lib/queries/admin';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// { ids: [...] } in the new order, in one UPDATE (today's ▲/▼ sent two separate PATCHes). The listed offices
// swap their existing position values, so archived offices (still shown on GeoGuessr) keep their place.
export const POST = handle(async ({ body }) => {
  const b = await body();
  if (!Array.isArray(b.ids) || !b.ids.length || b.ids.length > 200) throw bad('Send the offices in their new order.');
  const ids = b.ids.map(parseId);
  if (new Set(ids).size !== ids.length) throw bad('An office is listed twice.');
  const moved = await reorderOffices(ids);
  return { ok: true, moved };
}, { auth: 'admin' });
