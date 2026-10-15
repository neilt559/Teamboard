import { redirect } from 'next/navigation';
import { requirePageViewer, tagUpdating } from '@/lib/viewer';
import { nowFromRequestContext } from '@/lib/clock';
import { currentChallengeId } from '@/lib/queries/challenges';

// /culture/challenge: "this month's challenge" (design §2.1, §10(a); agent K1). Sends you to the featured challenge
// (the company challenge running today, Central), else a running challenge in your offices, else the challenge list.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'This month’s challenge' };

export default async function CurrentChallengePage() {
  const viewer = await requirePageViewer();
  let id;
  try {
    id = await currentChallengeId(viewer, nowFromRequestContext());
  } catch (e) {
    throw tagUpdating(e);
  }
  redirect(id ? `/culture/challenges/${id}` : '/culture/challenges');
}
