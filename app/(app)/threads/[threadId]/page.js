import { notFound } from 'next/navigation';
import { requirePageViewer } from '@/lib/viewer';

// Release 2 has no thread pages: a space holds announcements, suggestions and chat (design-amendments A5 replaces
// design §9). This M0 placeholder route stays so an old /threads/<id> link is a plain 404.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export default async function ThreadPage() {
  await requirePageViewer();
  notFound();
}
