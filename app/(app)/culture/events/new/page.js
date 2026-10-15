import Link from 'next/link';
import { requirePageViewer } from '@/lib/viewer';
import { nowFromRequestContext } from '@/lib/clock';
import { isOrganizer } from '@/lib/policy';
import { chicagoToday } from '@/lib/time';
import { parseYmd } from '@/lib/events';
import { listEventOffices } from '@/lib/queries/events';
import { IconCalendar } from '@/app/icons';
import EventForm from '../_components/EventForm';

// /culture/events/new[?date=YYYY-MM-DD]: add an event to the culture calendar (design §10(b); agent K2). Culture
// organizers and admins; everyone else gets a short explanation (the API refuses them too). The date defaults to
// today (Central), or the day picked on the calendar.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'New event' };

export default async function NewEventPage({ searchParams }) {
  const viewer = await requirePageViewer();
  if (!isOrganizer(viewer)) {
    return (
      <div>
        <div className="proj-head">
          <h1 className="wi-h"><IconCalendar size={24} /> New event</h1>
        </div>
        <div className="empty">
          <h3>Only culture organizers can add events</h3>
          <p>Ask an admin or a culture organizer to put your event on the calendar.</p>
          <Link className="btn btn-ink" href="/culture/calendar" prefetch={false}>Open the calendar</Link>
        </div>
      </div>
    );
  }
  const raw = Array.isArray(searchParams?.date) ? searchParams.date[0] : searchParams?.date;
  const date = parseYmd(raw) || chicagoToday(nowFromRequestContext());
  const offices = await listEventOffices();
  return <EventForm mode="new" date={date} offices={offices} viewerTz={viewer.tz} />;
}
