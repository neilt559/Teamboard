import { handle } from '@/lib/http';
import { pruneLegacy } from '@/lib/queries/admin';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// "Apply new rules to legacy users" for everyone (§6, §16 step 6): every legacy membership is soft-removed
// except each person's own team's projects and projects where they own tasks. One batch, one undo.
// -> { ok, batch, removed, people }
export const POST = handle(async ({ viewer }) => ({ ok: true, ...(await pruneLegacy({ adminId: viewer.id, userId: null })) }),
  { auth: 'admin' });
