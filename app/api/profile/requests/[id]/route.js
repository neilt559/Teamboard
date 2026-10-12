import { handle, HttpError, parseId } from '@/lib/http';
import { withdrawRequest } from '@/lib/requests';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// DELETE /api/profile/requests/:id: withdraw my own pending office change or name link (design §5.3, §8.2).
// Only the requester's own pending request; anything else (decided already, or someone else's) is 409.
export const DELETE = handle(async ({ viewer, params }) => {
  const ok = await withdrawRequest({ userId: viewer.id, requestId: parseId(params.id) });
  if (!ok) throw new HttpError(409, 'That request was already decided, or it isn’t yours. Refresh to see where it stands.');
  return { ok: true };
}, { maxBody: 10_000 });
