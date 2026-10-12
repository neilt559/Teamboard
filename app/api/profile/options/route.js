import { handle } from '@/lib/http';
import { loadProfileOptions } from '@/lib/queries/profile';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/profile/options (design §8.2): what the wizard and Settings > Profile offer. Active offices (with
// their time zone), teams, departments, positions (with levels), boss candidates (display_name || username,
// public fields only), unlinked names on tasks (with "someone has asked for this name"), plus my own profile,
// my linked name and my open requests. Works before the profile is finished.
export const GET = handle(async ({ viewer }) => loadProfileOptions(viewer), { allowIncomplete: true });
