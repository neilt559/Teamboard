import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePageViewer } from '@/lib/viewer';
import { isOrganizer } from '@/lib/policy';
import { listEventOffices, loadEvent, loadEventRow } from '@/lib/queries/events';
import { IconCalendar } from '@/app/icons';
import EventForm from '../../_components/EventForm';

// /culture/events/[id]/edit: change an event (design §10(b); agent K2). Culture organizers and admins; the form is a
// draft editor (base frozen on open, 409 shows the other version). Others get a short explanation. An archived event
// is restored from its page first.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Edit event' };

export default async function EditEventPage({ params }) {
  const viewer = await requirePageViewer();
  if (!/^[0-9]{1,18}$/.test(String(params.id))) notFound();
  if (!isOrganizer(viewer)) {
    // A missing (or archived) event is the same 404 as on its own page; an existing one gets the explanation.
    if (!(await loadEvent(viewer, params.id))) notFound();
    return (
      <div>
        <div className="proj-head">
          <h1 className="wi-h"><IconCalendar size={24} /> Edit event</h1>
        </div>
        <div className="empty">
          <h3>Only culture organizers can change events</h3>
          <p>Ask an admin or a culture organizer if something about this event is wrong.</p>
          <Link className="btn btn-ink" href={`/culture/events/${params.id}`} prefetch={false}>Back to the event</Link>
        </div>
      </div>
    );
  }
  const event = await loadEventRow(viewer, params.id);
  if (!event) notFound();
  if (event.archived) {
    return (
      <div>
        <div className="proj-head">
          <h1 className="wi-h"><IconCalendar size={24} /> Edit event</h1>
        </div>
        <div className="empty">
          <h3>This event is archived</h3>
          <p>Restore it from its page first, then edit it.</p>
          <Link className="btn btn-ink" href={`/culture/events/${event.id}`} prefetch={false}>Back to the event</Link>
        </div>
      </div>
    );
  }
  const offices = await listEventOffices(event.office_id);
  return <EventForm key={event.updated_at || event.id} mode="edit" event={event} offices={offices} viewerTz={viewer.tz} />;
}
