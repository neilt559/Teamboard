import { handle } from '@/lib/http';
import { pruneLegacy } from '@/lib/queries/admin';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// "Apply new rules to legacy users" for everyone (§6, §16 step 6): every legacy membership is soft-removed
// except each person's own (home) team's projects, the projects of every team on their active roster (A4 rule
// 3d; those kept rows become source 'team_legacy': the roster manages them and they keep legacy-manager rights)
// and projects where they own tasks. One batch, one undo.
// -> { ok, batch, removed, people, relabeled }
export const POST = handle(async ({ viewer }) => ({ ok: true, ...(await pruneLegacy({ adminId: viewer.id, userId: null })) }),
  { auth: 'admin' });
