import { handle } from '@/lib/http';
import { listApprovals } from '@/lib/queries/admin';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// The approval queue (§5.5): position requests, office changes, person links and identity checks, oldest
// first, each with a plain-English consequence. -> { items, positions, counts }
export const GET = handle(async () => listApprovals(), { auth: 'admin' });
