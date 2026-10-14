import { requirePageViewer } from '@/lib/viewer';
import SpaceScreen, { spaceMetadata } from '../_components/SpaceScreen';

// /threads/cage: the CAGE space, everyone's (design-amendments A5.6). ?tab=announcements|suggestions|chat.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export async function generateMetadata() {
  return spaceMetadata('company');
}

export default async function CageSpacePage({ searchParams }) {
  const viewer = await requirePageViewer();
  return <SpaceScreen viewer={viewer} spaceKey="company" searchParams={searchParams} />;
}
