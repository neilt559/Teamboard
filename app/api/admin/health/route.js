import { handle } from '@/lib/http';
import { loadHealth } from '@/lib/queries/admin';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// Data health (§16 step 4): row counts per table, schema version (code vs database), the ledger rows,
// legacy-membership counts and the GeoGuessr delete guard. Counts only, never row contents.
export const GET = handle(async () => loadHealth(), { auth: 'admin' });
