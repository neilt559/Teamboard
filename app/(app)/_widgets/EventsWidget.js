import Link from 'next/link';
import { requirePageViewer, tagUpdating } from '@/lib/viewer';
import { nowFromRequestContext } from '@/lib/clock';
import { loadUpcomingEvents } from '@/lib/queries/events';
import { WEEKDAY_NAMES, monthShort, dayNum } from '@/lib/events';
import { addDays, weekdayOf } from '@/lib/time';
import { IconCalendar, IconBuilding, IconMapPin, IconPlus, IconChevronRight } from '@/app/icons';

// Home dashboard widget 'events' (design §2.1 "upcoming events", §10(b), §11; agent K2) and the events card on
// /culture. Async Server Components that load their own data (one cached loader per request):
//   <EventsWidget viewer={viewer} now={now} />     Home: the next 5 events
//   <EventsHubCard viewer={viewer} now={now} />    /culture: the next 3, as a hub card
// "Upcoming" = company-wide events plus the viewer's offices and followed ones (the calendar's default filter),
// from today (Central) on; an event that already ended today drops off. Cancelled ones stay, struck through, so
// nobody shows up for them. A timed event shows its own zone, plus the viewer's office time when that differs.

async function load(viewer, now, limit) {
  const v = viewer || await requirePageViewer();
  try {
    return await loadUpcomingEvents(v, now ?? nowFromRequestContext(), limit);
  } catch (e) {
    throw tagUpdating(e);                         // the dashboard's WidgetBoundary shows "This card couldn't load"
  }
}

// "Today", "Tomorrow", or nothing (the date badge says the rest).
function soon(e, today, tomorrow) {
  if (e.starts_on <= today && e.ends_on >= today) return e.starts_on < today ? 'On now' : 'Today';
  if (e.starts_on === tomorrow) return 'Tomorrow';
  return '';
}

function DateBadge({ ymd }) {
  return (
    <span className="ev-badge" aria-hidden="true">
      <span className="ev-badge-m">{monthShort(ymd)}</span>
      <span className="ev-badge-d">{dayNum(ymd)}</span>
      <span className="ev-badge-w">{WEEKDAY_NAMES[weekdayOf(ymd)]}</span>
    </span>
  );
}

export function EventRow({ e, today, tomorrow }) {
  const s = soon(e, today, tomorrow);
  const when = e.all_day ? (e.ends_on !== e.starts_on ? e.when.date : 'All day') : e.when.time;
  return (
    <li className="wl-item">
      <Link href={e.href} prefetch={false} className={`wl-row ev-w-row${e.cancelled ? ' is-cancelled' : ''}${e.office_id ? ' is-office' : ' is-company'}`}
        aria-label={`${e.title}, ${e.when.line}${e.office_name ? `, ${e.office_name} office` : ', company-wide'}${e.cancelled ? ', cancelled' : ''}`}>
        <DateBadge ymd={e.starts_on > today ? e.starts_on : today} />
        <span className="wl-main">
          <span className="wl-name ev-w-name">{e.title}</span>
          <span className="ev-w-meta">
            {e.cancelled ? <span className="ev-w-cancel">Cancelled</span> : s ? <span className="ev-w-soon">{s}</span> : null}
            <span>{when}</span>
            {e.when.alt && <span className="ev-w-alt">({e.when.alt})</span>}
          </span>
          <span className="ev-w-meta">
            {e.office_id ? <span className="ev-w-where"><IconBuilding size={12} /> {e.office_name}</span> : <span className="ev-w-where ev-w-co">Company-wide</span>}
            {e.location && <span className="ev-w-where"><IconMapPin size={12} /> {e.location}</span>}
          </span>
        </span>
        <IconChevronRight size={15} className="sp-row-go" />
      </Link>
    </li>
  );
}

export default async function EventsWidget({ viewer, now } = {}) {
  const s = await load(viewer, now, 5);
  const tomorrow = addDays(s.today, 1);
  return (
    <section className="widget ev-widget" aria-labelledby="w-events">
      <div className="widget-head">
        <h2 id="w-events" className="widget-title wi-h"><IconCalendar size={18} /> Upcoming events</h2>
        <Link href="/culture/calendar" prefetch={false} className="widget-more">Calendar →</Link>
      </div>
      {s.events.length > 0 ? (
        <ul className="widget-list ev-w-list">
          {s.events.map((e) => <EventRow key={e.id} e={e} today={s.today} tomorrow={tomorrow} />)}
        </ul>
      ) : (
        <p className="widget-empty">Nothing on the calendar for you yet. <Link href="/culture/calendar?office=all" prefetch={false}>See every office’s events</Link>.</p>
      )}
      <div className="ev-w-foot">
        {s.more && <Link href="/culture/calendar" prefetch={false} className="widget-foot">More on the calendar →</Link>}
        {s.can_manage && (
          <Link href="/culture/events/new" prefetch={false} className="btn btn-plain btn-sm wi ev-w-add"><IconPlus size={14} /> Add an event</Link>
        )}
      </div>
    </section>
  );
}

// /culture hub card: the next three events, then a link to the calendar.
export async function EventsHubCard({ viewer, now } = {}) {
  const s = await load(viewer, now, 3);
  const tomorrow = addDays(s.today, 1);
  return (
    <section className="home-card ev-hub-card" aria-labelledby="hub-events">
      <span className="home-card-icon ev-hub-icon"><IconCalendar size={22} /></span>
      <span className="home-card-main">
        <Link id="hub-events" href="/culture/calendar" prefetch={false} className="home-card-name ev-hub-title">Culture calendar</Link>
        {s.events.length > 0 ? (
          <ul className="widget-list ev-w-list ev-hub-list">
            {s.events.map((e) => <EventRow key={e.id} e={e} today={s.today} tomorrow={tomorrow} />)}
          </ul>
        ) : (
          <span className="home-card-stats">No events coming up for your offices.{s.can_manage ? ' Add the next one.' : ''}</span>
        )}
        <span className="ev-hub-actions">
          <Link href="/culture/calendar" prefetch={false} className="btn btn-plain btn-sm">Open the calendar</Link>
          {s.can_manage && <Link href="/culture/events/new" prefetch={false} className="btn btn-lime btn-sm wi"><IconPlus size={14} /> New event</Link>}
        </span>
      </span>
    </section>
  );
}
