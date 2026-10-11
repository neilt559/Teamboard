import { requirePageViewer } from '@/lib/viewer';
import { notFound } from 'next/navigation';
import { IconCalendar } from '@/app/icons';

// Placeholder from M0 so the route exists and is guarded; replaced in M4 (K2) (design §2.1, §15).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Event' };

export default async function EventPage({ params }) {
  const viewer = await requirePageViewer();
  if (!/^[0-9]{1,18}$/.test(String(params.id))) notFound();
  return (
    <div className="coming-soon">
      <div className="proj-head">
        <h1 className="wi-h"><IconCalendar size={24} /> Event</h1>
      </div>
      <div className="empty">
        <h3>Coming soon</h3>
        <p>A culture event.</p>
      </div>
    </div>
  );
}
