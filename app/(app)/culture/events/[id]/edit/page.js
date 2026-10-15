import { redirect } from 'next/navigation';
import { requirePageViewer } from '@/lib/viewer';

// The culture events calendar was taken out of the app (Neil, 2026-10-15: "I don't want the calendar. I think
// nobody will use it."). Its events stay in culture_events (nothing is deleted); old links land on /culture.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export default async function RetiredCalendarPage() {
  await requirePageViewer();
  redirect('/culture');
}
