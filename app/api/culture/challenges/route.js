import { handle } from '@/lib/http';
import { listChallenges, createChallenge } from '@/lib/queries/challenges';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// Monthly challenges (design §10(a), §8.2; agent K1).
// GET /api/culture/challenges[?show=all][&archived=1] -> { today, show, running, upcoming, past, archived_list, ... }
//   Every signed-in user reads every challenge; by default office challenges are limited to the viewer's offices
//   plus followed ones (show=all lists every office's). archived=1 lists the archived ones (organizers only).
export const GET = handle(async ({ req, viewer, now }) => {
  const q = new URL(req.url).searchParams;
  return listChallenges(viewer, now, { show: q.get('show') === 'all' ? 'all' : 'mine', archived: q.get('archived') === '1' });
});

// POST /api/culture/challenges { title, description?, metric_label?, unit?, aggregation?, higher_is_better?,
// group_rank?, starts_on?, ends_on?, office_id? } -> { ok, challenge }. Culture organizers and admins only.
export const POST = handle(async ({ viewer, body, now }) => {
  const challenge = await createChallenge(viewer, await body(), now);
  return { ok: true, challenge, id: challenge.id };
}, { auth: 'organizer' });
