import { notFound } from 'next/navigation';
import { requirePageViewer } from '@/lib/viewer';
import BoardScreen, { boardMetadata } from '../../BoardScreen';

// /suggestions/office/[officeId]: one office's Suggestions/Announcements board (design-amendments A10.1). Readable
// by the office's home and extra-office members, Director and up (L4) and admins (the A5 office rule,
// tb_can_read_space); everyone else gets the same 404 as a missing office.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

const validId = (v) => /^[1-9][0-9]{0,17}$/.test(String(v ?? ''));

export async function generateMetadata({ params }) {
  if (!validId(params.officeId)) return { title: 'Suggestions/Announcements' };
  return boardMetadata(`office:${params.officeId}`);
}

export default async function OfficeBoardPage({ params }) {
  const viewer = await requirePageViewer();
  if (!validId(params.officeId)) notFound();
  return <BoardScreen viewer={viewer} boardKey={`office:${params.officeId}`} />;
}
