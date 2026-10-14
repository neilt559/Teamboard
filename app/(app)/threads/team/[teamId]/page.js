import { notFound } from 'next/navigation';
import { requirePageViewer } from '@/lib/viewer';
import SpaceScreen, { spaceMetadata } from '../../_components/SpaceScreen';

// /threads/team/[teamId]: one team's space (design-amendments A5.6). Readable by the team's roster, Director and
// up (L4) and admins; everyone else gets the same 404 as a missing team.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

const validId = (v) => /^[0-9]{1,18}$/.test(String(v ?? ''));

export async function generateMetadata({ params }) {
  if (!validId(params.teamId)) return { title: 'Threads' };
  return spaceMetadata(`team:${params.teamId}`);
}

export default async function TeamSpacePage({ params, searchParams }) {
  const viewer = await requirePageViewer();
  if (!validId(params.teamId)) notFound();
  return <SpaceScreen viewer={viewer} spaceKey={`team:${params.teamId}`} searchParams={searchParams} />;
}
