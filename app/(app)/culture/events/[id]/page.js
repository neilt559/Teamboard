import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePageViewer } from '@/lib/viewer';
import { nowFromRequestContext } from '@/lib/clock';
import { isOrganizer } from '@/lib/policy';
import { chicagoToday } from '@/lib/time';
import { eventStatus, monthOf } from '@/lib/events';
import { loadEventPage } from '@/lib/queries/events';
import { FormattedNotes } from '@/app/notes-format';
import { IconCalendar, IconChevronLeft, IconClock, IconMapPin, IconBuilding, IconExternal, IconAlert, IconArchive } from '@/app/icons';
import { calHref } from '../../calendar/cal-items';
import EventActions from '../_components/EventActions';
import RefreshOnFocus from '../_components/RefreshOnFocus';

// /culture/events/[id]: one culture event (design §2.1, §10(b); agent K2). Everyone signed in reads every event
// (company-wide and every office's); an archived event is the same 404 as a missing one except for organizers and
// admins, who also get Edit, Cancel / Restore and Archive / Restore from the archive (EventActions). A timed event
// shows its own zone plus the viewer's office zone when that differs ("4:00–6:00 PM ET (3:00–5:00 PM CT)").
// Refreshes when the tab regains focus (§7.5).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

const validId = (id) => /^[0-9]{1,18}$/.test(String(id ?? ''));

export async function generateMetadata({ params }) {
  if (!validId(params.id)) return { title: 'Event' };
  const viewer = await requirePageViewer();
  const e = await loadEventPage(viewer, params.id);
  return { title: e?.title || 'Event' };
}

const STATUS = {
  now: { label: 'Happening today', cls: 'ev-chip-now' },
  upcoming: { label: 'Upcoming', cls: 'ev-chip-upcoming' },
  past: { label: 'Over', cls: 'ev-chip-past' },
};

const fmtStamp = (iso, tz) => {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
      .format(new Date(iso));
  } catch {
    return '';
  }
};

export default async function EventPage({ params }) {
  const viewer = await requirePageViewer();
  if (!validId(params.id)) notFound();
  const e = await loadEventPage(viewer, params.id);
  if (!e) notFound();
  const now = nowFromRequestContext();
  const today = chicagoToday(now);
  const status = eventStatus(e, today, now);
  const org = isOrganizer(viewer);
  const vtz = viewer.tz || 'America/Chicago';
  const back = calHref({ m: monthOf(e.starts_on), hash: `d-${e.starts_on >= today ? e.starts_on : today}` });
  const st = STATUS[status];
  return (
    <div className={`ev-page${e.cancelled ? ' is-cancelled' : ''}${e.archived ? ' is-archived' : ''}`}>
      <RefreshOnFocus />
      <Link href={back} prefetch={false} className="ev-back wi"><IconChevronLeft size={15} /> Calendar</Link>
      <div className="proj-head ev-head">
        <h1 className="wi-h ev-title"><IconCalendar size={24} /> <span className="ev-title-text">{e.title || 'Event'}</span></h1>
      </div>
      <div className="ev-chips">
        {e.archived && <span className="ev-chip ev-chip-archived"><IconArchive size={12} /> Archived</span>}
        {e.cancelled && <span className="ev-chip ev-chip-cancel">Cancelled</span>}
        {!e.cancelled && !e.archived && st && <span className={`ev-chip ${st.cls}`}>{st.label}</span>}
        <span className={`ev-chip ${e.office_id ? 'ev-chip-office' : 'ev-chip-company'}`}>
          {e.office_id ? <><IconBuilding size={12} /> {`${e.office_name} office`}</> : 'Company-wide'}
        </span>
      </div>

      {e.archived && (
        <p className="ev-banner" role="status"><IconArchive size={15} /> This event is archived: only organizers can see it. Restore it to put it back on the calendar.</p>
      )}
      {e.cancelled && !e.archived && (
        <p className="ev-banner ev-banner-cancel" role="status">
          <IconAlert size={15} /> This event is cancelled{e.cancelled_by_name ? ` (by ${e.cancelled_by_name})` : ''}. It stays on the calendar so nobody shows up for it.
        </p>
      )}

      <div className="ev-layout">
        <section className="ev-panel ev-facts" aria-label="When and where">
          <div className="ev-fact">
            <span className="ev-fact-icon"><IconClock size={18} /></span>
            <span className="ev-fact-main">
              <span className="ev-when-date">{e.when.date}</span>
              <span className="ev-when-time">{e.when.time}</span>
              {e.when.alt && <span className="ev-when-alt">Your time: {e.when.alt}</span>}
            </span>
          </div>
          {e.location && (
            <div className="ev-fact">
              <span className="ev-fact-icon"><IconMapPin size={18} /></span>
              <span className="ev-fact-main"><span className="ev-where">{e.location}</span></span>
            </div>
          )}
          {e.link_url && (
            <div className="ev-fact">
              <span className="ev-fact-icon"><IconExternal size={18} /></span>
              <span className="ev-fact-main">
                <a href={e.link_url} target="_blank" rel="noopener noreferrer" className="ev-link">{e.link_url}</a>
              </span>
            </div>
          )}
        </section>

        <section className="ev-panel ev-details" aria-label="Details">
          <h2 className="ev-panel-h">Details</h2>
          <FormattedNotes text={e.details} linkify empty="No details yet." />
        </section>
      </div>

      <p className="ev-meta">
        {e.created_by_name ? `Added by ${e.created_by_name}` : 'Added'}{e.created_at ? ` on ${fmtStamp(e.created_at, vtz)}` : ''}
        {e.updated_at && e.updated_by_name ? ` · Last changed by ${e.updated_by_name} on ${fmtStamp(e.updated_at, vtz)}` : ''}
      </p>

      {org && <EventActions event={{ id: e.id, title: e.title, cancelled: e.cancelled, archived: e.archived }} />}
    </div>
  );
}
