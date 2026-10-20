import { notFound } from 'next/navigation';
import { requirePageViewer, publicViewer } from '@/lib/viewer';
import { loadChallengePage } from '@/lib/queries/challenges';
import ChallengeView from '../_components/ChallengeView';
import BingoView from '../_components/BingoView';
import ChiliView from '../_components/ChiliView';

// /culture/challenges/[id]: one challenge (design §2.1, §10(a); agent K1): "Log my stats", my entries (edit and
// delete my own until the end date + 3 days), my standing and the leaderboards (Individuals / Offices / Departments).
// Organizers also edit or archive the challenge and see every entry. An office bingo challenge gets the bingo
// cards instead (BingoView). Everyone reads every challenge; an archived
// one is the not-found page except for organizers.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export async function generateMetadata({ params }) {
  const viewer = await requirePageViewer();
  const data = await loadChallengePage(viewer, params.id);
  return { title: data?.challenge?.title || 'Challenge' };
}

export default async function ChallengePage({ params }) {
  const viewer = await requirePageViewer();
  if (!/^[0-9]{1,18}$/.test(String(params.id))) notFound();
  const data = await loadChallengePage(viewer, params.id);
  if (!data) notFound();
  if (data.challenge.kind === 'bingo') return <BingoView initial={data} viewer={publicViewer(viewer)} />;
  if (data.challenge.kind === 'chili') return <ChiliView initial={data} />;
  return <ChallengeView initial={data} viewer={publicViewer(viewer)} />;
}
