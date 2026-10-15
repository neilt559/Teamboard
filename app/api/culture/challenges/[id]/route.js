import { handle, notFound, parseId } from '@/lib/http';
import { loadChallenge, patchChallenge } from '@/lib/queries/challenges';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/culture/challenges/:id -> the challenge, the leaderboards (Individuals / Offices / Departments), my
// score, rank and entries, and (organizers) every entry. An archived challenge is 404 except for organizers.
export const GET = handle(async ({ viewer, params, now }) => {
  const data = await loadChallenge(viewer, parseId(params.id), now);
  if (!data) throw notFound('Challenge not found');
  return data;
});

// PATCH /api/culture/challenges/:id { title?, description?, metric_label?, unit? (each with base, design §7.3),
// aggregation?, higher_is_better?, group_rank?, starts_on?, ends_on?, office_id?, archived? } -> { ok, row }.
// Culture organizers and admins only; 409 with the current row when a text field changed since its base.
export const PATCH = handle(async ({ viewer, params, body, now }) => {
  const row = await patchChallenge(viewer, params.id, await body(), now);
  return { ok: true, row };
}, { auth: 'organizer' });
