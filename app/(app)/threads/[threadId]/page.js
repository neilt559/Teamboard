import { redirect } from 'next/navigation';
import { requirePageViewer } from '@/lib/viewer';

// An old /threads/<anything> link: the thread spaces were replaced by the Suggestions/Announcements boards
// (design-amendments A10.1), so it goes to the CAGE board.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export default async function ThreadPage() {
  await requirePageViewer();
  redirect('/suggestions');
}
