import { redirect } from 'next/navigation';
import { requirePageViewer } from '@/lib/viewer';

// The M0 placeholder URL for the company channel. The CAGE space lives at /threads/cage (design-amendments A5.6).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export default async function CompanyThreadsPage({ searchParams }) {
  await requirePageViewer();
  const tab = ['announcements', 'suggestions', 'chat'].includes(searchParams?.tab) && searchParams.tab !== 'announcements'
    ? `?tab=${searchParams.tab}` : '';
  redirect(`/threads/cage${tab}`);
}
