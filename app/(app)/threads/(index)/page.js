import { redirect } from 'next/navigation';
import { requirePageViewer } from '@/lib/viewer';

// /threads: the thread spaces were replaced by the Suggestions/Announcements boards (design-amendments A10.1).
// Every /threads address redirects there.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export default async function ThreadsPage() {
  await requirePageViewer();
  redirect('/suggestions');
}
