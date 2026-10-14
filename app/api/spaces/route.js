import { handle } from '@/lib/http';
import { listSpaces } from '@/lib/queries/spaces';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/spaces (design-amendments A5.5) -> { spaces: [{ key, scope, office_id, team_id, name, parent_key,
//   archived, unread: { announcements, suggestions, chat }, href, office_name, mine, my_role }], unread_total }
// Only the spaces this viewer can read (tb_can_read_space in SQL), in list order: CAGE, my offices with my teams
// nested, then (L4 and admins) the other offices with their teams. See lib/queries/spaces.js listSpaces.
export const GET = handle(async ({ viewer }) => listSpaces(viewer));
