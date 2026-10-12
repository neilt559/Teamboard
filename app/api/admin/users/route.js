import { handle } from '@/lib/http';
import { listAccounts } from '@/lib/queries/admin';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// Every account for the Accounts page: profile, identity state, pending items, last sign-in, devices and the
// sign-in lock. Never password hashes or photo blobs. 404 for non-admins (rule 29).
export const GET = handle(async () => ({ users: await listAccounts() }), { auth: 'admin' });
