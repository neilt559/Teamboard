import { redirect } from 'next/navigation';
import { requirePageViewer } from '@/lib/viewer';

// The M0 placeholder URL for the company channel: now the CAGE Suggestions/Announcements board
// (design-amendments A10.1).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export default async function CompanyThreadsPage() {
  await requirePageViewer();
  redirect('/suggestions');
}
