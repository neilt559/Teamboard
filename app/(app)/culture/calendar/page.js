import Link from 'next/link';
import { requirePageViewer } from '@/lib/viewer';
import { nowFromRequestContext } from '@/lib/clock';
import { withDefaults } from '@/lib/prefs';
import { listCalendar } from '@/lib/queries/events';
import { IconCalendar, IconChevronLeft, IconChevronRight, IconPlus, IconBuilding, IconCaret, IconArchive } from '@/app/icons';
import RefreshOnFocus from '../events/_components/RefreshOnFocus';
import MonthGrid from './MonthGrid';
import Agenda from './Agenda';
import { calHref, calendarItems } from './cal-items';

// /culture/calendar?m=YYYY-MM&view=month|agenda&office=mine|company|all|<id> (design §2.1, §10(b); agent K2).
// Culture events (company-wide and per office) plus the running challenges and auto bracket weeks, merged in at
// read time. Everyone signed in sees every event; the office chips only filter what's shown (default: company + my
// offices + followed). View: ?view= wins, else Settings > Customize (prefs.calendar_view), else the device default:
// both views are rendered and CSS shows the month grid on desktop and the agenda on phones (no JavaScript needed).
// Organizers and admins get "New event", a "+" on each day and this month's archived events (to restore them).
// Refreshes when the tab regains focus (§7.5).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Culture calendar' };

const VIEWS = ['month', 'agenda'];

export default async function CalendarPage({ searchParams }) {
  const viewer = await requirePageViewer();
  const now = nowFromRequestContext();
  const sp = searchParams || {};
  const one = (v) => (Array.isArray(v) ? v[0] : v);
  const cal = await listCalendar(viewer, { month: one(sp.m), office: one(sp.office), now });
  const prefs = withDefaults(viewer.prefs, { isAdmin: !!viewer.is_admin });
  const asked = one(sp.view);
  const view = VIEWS.includes(asked) ? asked : VIEWS.includes(prefs.calendar_view) ? prefs.calendar_view : 'auto';
  const office = cal.filter.key;
  const link = (o) => calHref({ m: cal.month, view: VIEWS.includes(asked) ? asked : null, office, ...o });
  const items = calendarItems(cal);
  const pickedOffice = cal.offices.find((o) => o.id === office) || null;
  const chips = [
    { key: 'mine', label: 'Mine', title: 'Company-wide events plus your offices and the offices you follow' },
    { key: 'company', label: 'Company', title: 'Company-wide events only' },
    { key: 'all', label: 'All offices', title: 'Every office’s events' },
  ];
  const isThisMonth = cal.month === cal.this_month;
  return (
    <div className="cal-page">
      <RefreshOnFocus />
      <div className="proj-head cal-head">
        <h1 className="wi-h"><IconCalendar size={24} /> Culture calendar</h1>
        <div className="spacer" />
        {cal.can_manage && (
          <Link href={`/culture/events/new${isThisMonth ? `?date=${cal.today}` : `?date=${cal.grid.first}`}`} prefetch={false} className="btn btn-lime wi cal-new">
            <IconPlus size={15} /> New event
          </Link>
        )}
      </div>

      <div className="cal-toolbar">
        <div className="cal-nav">
          <Link href={link({ m: cal.prev })} prefetch={false} className="cal-navbtn" aria-label={`Previous month`} title="Previous month"><IconChevronLeft size={18} /></Link>
          <h2 className="cal-label" aria-live="polite">{cal.label}</h2>
          <Link href={link({ m: cal.next })} prefetch={false} className="cal-navbtn" aria-label={`Next month`} title="Next month"><IconChevronRight size={18} /></Link>
          <Link href={link({ m: cal.this_month, hash: `d-${cal.today}` })} prefetch={false}
            className={`btn btn-plain btn-sm cal-today-btn${isThisMonth ? ' is-here' : ''}`} aria-current={isThisMonth ? 'date' : undefined}>Today</Link>
        </div>
        <div className={`cal-views cal-views-${view}`} role="group" aria-label="View">
          <Link href={calHref({ m: cal.month, view: 'month', office })} prefetch={false} className={`cal-view-opt v-month${view === 'month' ? ' on' : ''}`}>Month</Link>
          <Link href={calHref({ m: cal.month, view: 'agenda', office })} prefetch={false} className={`cal-view-opt v-agenda${view === 'agenda' ? ' on' : ''}`}>Agenda</Link>
        </div>
      </div>

      <div className="cal-filters" role="group" aria-label="Which events">
        {chips.map((c) => (
          <Link key={c.key} href={link({ office: c.key })} prefetch={false} title={c.title}
            className={`cal-filter${office === c.key ? ' on' : ''}`} aria-current={office === c.key ? 'true' : undefined}>{c.label}</Link>
        ))}
        <details className="cal-office-pick">
          <summary className={`cal-filter${pickedOffice ? ' on' : ''}`}>
            <IconBuilding size={13} /> {pickedOffice ? pickedOffice.name : 'One office'} <IconCaret size={13} />
          </summary>
          <div className="cal-office-pop" role="list">
            {cal.offices.map((o) => (
              <Link key={o.id} role="listitem" href={link({ office: o.id })} prefetch={false} className={`cal-office-opt${office === o.id ? ' on' : ''}`}>{o.name}</Link>
            ))}
          </div>
        </details>
        <span className="cal-filter-label">{cal.filter.label}</span>
      </div>

      <div className={`cal-body cal-show-${view}`}>
        {view !== 'agenda' && <MonthGrid cal={cal} items={items} />}
        {view !== 'month' && <Agenda cal={cal} />}
      </div>

      {cal.can_manage && cal.archived.length > 0 && (
        <details className="cal-archived">
          <summary><IconArchive size={14} /> Archived in {cal.label} ({cal.archived.length})</summary>
          <ul className="cal-archived-list">
            {cal.archived.map((e) => (
              <li key={e.id}>
                <Link href={e.href} prefetch={false} className="cal-archived-row">
                  <span className="cal-archived-title">{e.title}</span>
                  <span className="cal-archived-meta">{e.when.line}{e.office_name ? ` · ${e.office_name} office` : ' · Company-wide'}</span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}

      <ul className="cal-legend" aria-label="Legend">
        <li><span className="cal-key cal-key-company" /> Company-wide event</li>
        <li><span className="cal-key cal-key-office" /> Office event</li>
        <li><span className="cal-key cal-key-challenge" /> Challenge</li>
        <li><span className="cal-key cal-key-bracket" /> Bracket week</li>
        <li><span className="cal-key cal-key-cancel">Ab</span> Cancelled</li>
      </ul>
    </div>
  );
}
