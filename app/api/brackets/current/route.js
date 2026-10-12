import { handle } from '@/lib/http';
import { loadBracketPoll } from '@/lib/queries/brackets';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/brackets/current: what the live bracket page polls every 15 s while a round is open (design §7.5).
// { current: { bracket, entrants, matches, votes } | null, upcoming, past, users (voters and the viewer only),
//   schedule: { open_round, closes_at } }. Release 3 (K3) runs advanceDueBrackets(now) first and adds
// next_monday_scheduled for organizers.
export const GET = handle(async ({ viewer, now }) => loadBracketPoll(viewer, now));
