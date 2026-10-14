import { notFound } from 'next/navigation';
import { requirePageViewer } from '@/lib/viewer';
import SpaceScreen, { spaceMetadata } from '../../_components/SpaceScreen';

// /threads/office/[officeId]: one office's space (design-amendments A5.6). Readable by the office's home and
// extra-office members, Director and up (L4) and admins; everyone else gets the same 404 as a missing office.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

const validId = (v) => /^[0-9]{1,18}$/.test(String(v ?? ''));

export async function generateMetadata({ params }) {
  if (!validId(params.officeId)) return { title: 'Threads' };
  return spaceMetadata(`office:${params.officeId}`);
}

export default async function OfficeSpacePage({ params, searchParams }) {
  const viewer = await requirePageViewer();
  if (!validId(params.officeId)) notFound();
  return <SpaceScreen viewer={viewer} spaceKey={`office:${params.officeId}`} searchParams={searchParams} />;
}
