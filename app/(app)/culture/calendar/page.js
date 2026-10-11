import { requirePageViewer } from '@/lib/viewer';
import { IconCalendar } from '@/app/icons';

// Placeholder from M0 so the route exists and is guarded; replaced in M4 (K2) (design §2.1, §15).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Culture calendar' };

export default async function CalendarPage() {
  const viewer = await requirePageViewer();
  return (
    <div className="coming-soon">
      <div className="proj-head">
        <h1 className="wi-h"><IconCalendar size={24} /> Culture calendar</h1>
      </div>
      <div className="empty">
        <h3>Coming soon</h3>
        <p>Culture events across the company, by month or as a list.</p>
      </div>
    </div>
  );
}
