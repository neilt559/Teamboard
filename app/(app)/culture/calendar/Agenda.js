import Link from 'next/link';
import { fmtDate, fmtTime, tzAbbr } from '@/lib/events';
import { IconMedal, IconTrophy, IconMapPin, IconBuilding } from '@/app/icons';
import { daysOf, dayOfSpan } from './cal-items';

// The agenda (design §10(b)): the phone default (prefs.calendar_view), grouped by day ("Mon, Oct 12"). Challenges
// running this month sit in a strip at the top; events show on each day they cover; the auto bracket shows each
// day's round (Mon Wildcard ... Fri Championship). In the current month the days before today fold into
// "Earlier this month", so today's events are at the top on a phone. A server component.

function timeCell(e, day) {
  if (e.all_day || !e.start_time) return { main: 'All day', alt: null };
  const ab = tzAbbr(e.tz);
  if (e.ends_on === e.starts_on) return { main: e.when.time, alt: e.when.alt };
  if (day === e.starts_on) return { main: `From ${fmtTime(e.start_time)} ${ab}`, alt: null };
  if (day === e.ends_on && e.end_time) return { main: `Until ${fmtTime(e.end_time)} ${ab}`, alt: null };
  return { main: 'All day', alt: null };
}

function EventRow({ e, day }) {
  const t = timeCell(e, day);
  const span = dayOfSpan(e, day);
  return (
    <li className={`cal-ag-item cal-ag-event ${e.office_id ? 'is-office' : 'is-company'}${e.cancelled ? ' is-cancelled' : ''}`}>
      <span className="cal-ag-time">
        <span>{t.main}</span>
        {t.alt && <span className="cal-ag-alt">{t.alt}</span>}
      </span>
      <span className="cal-ag-main">
        <Link href={e.href} prefetch={false} className="cal-ag-title">{e.title}</Link>
        <span className="cal-ag-meta">
          {e.cancelled && <span className="cal-tag cal-tag-cancel">Cancelled</span>}
          <span className={`cal-tag ${e.office_id ? 'cal-tag-office' : 'cal-tag-company'}`}>
            {e.office_id ? <><IconBuilding size={12} /> {e.office_name}</> : 'Company-wide'}
          </span>
          {e.location && <span className="cal-ag-loc"><IconMapPin size={12} /> {e.location}</span>}
          {span && <span className="cal-ag-span">{span}</span>}
        </span>
      </span>
    </li>
  );
}

function BracketRow({ b, day, today }) {
  const when = day === today ? 'Vote today' : day > today ? 'Voting day' : 'Voting closed';
  return (
    <li className="cal-ag-item cal-ag-bracket">
      <span className="cal-ag-time"><span>{when}</span></span>
      <span className="cal-ag-main">
        <Link href={b.href} prefetch={false} className="cal-ag-title"><IconTrophy size={14} /> {b.days[day]}</Link>
        <span className="cal-ag-meta"><span className="cal-tag cal-tag-bracket">Bracket</span> {b.title}</span>
      </span>
    </li>
  );
}

function Day({ day, list, today }) {
  return (
    <section id={`d-${day}`} className={`cal-ag-day${day === today ? ' is-today' : ''}`} aria-label={fmtDate(day, { weekday: true, year: true })}>
      <h3 className="cal-ag-date">
        <span>{fmtDate(day, { weekday: true })}</span>
        {day === today && <span className="cal-today-tag">Today</span>}
      </h3>
      <ul className="cal-ag-list">
        {list.map((x) => (x.kind === 'bracket'
          ? <BracketRow key={x.key} b={x} day={day} today={today} />
          : <EventRow key={x.key} e={x} day={day} />))}
      </ul>
    </section>
  );
}

export default function Agenda({ cal }) {
  const { first, last } = cal.grid;
  const days = daysOf(first, last).map((day) => {
    const list = [
      ...cal.brackets.filter((b) => b.days[day]),
      ...cal.events.filter((e) => e.starts_on <= day && e.ends_on >= day)
        .sort((a, b) => {
          const ta = a.all_day || !a.start_time || a.starts_on !== day ? '' : a.start_time;
          const tb = b.all_day || !b.start_time || b.starts_on !== day ? '' : b.start_time;
          return ta === tb ? Number(a.id) - Number(b.id) : ta < tb ? -1 : 1;
        }),
    ];
    return { day, list };
  }).filter((d) => d.list.length > 0);
  const running = cal.challenges.filter((c) => c.starts_on <= last && c.ends_on >= first);
  const current = cal.month === cal.this_month;
  const earlier = current ? days.filter((d) => d.day < cal.today) : [];
  const rest = current ? days.filter((d) => d.day >= cal.today) : days;
  return (
    <div className="cal-agenda" aria-label={`${cal.label}, agenda`}>
      {running.length > 0 && (
        <section className="cal-ag-running" aria-label="Challenges this month">
          {running.map((c) => (
            <Link key={c.key} href={c.href} prefetch={false} className="cal-ag-challenge">
              <span className="cal-ag-ch-icon"><IconMedal size={16} /></span>
              <span className="cal-ag-main">
                <span className="cal-ag-title">{c.title}</span>
                <span className="cal-ag-meta">Challenge · {c.range}{c.office_name ? ` · ${c.office_name} office` : ''}</span>
              </span>
            </Link>
          ))}
        </section>
      )}
      {earlier.length > 0 && (
        <details className="cal-ag-earlier">
          <summary>Earlier this month ({earlier.length} {earlier.length === 1 ? 'day' : 'days'})</summary>
          {earlier.map((d) => <Day key={d.day} day={d.day} list={d.list} today={cal.today} />)}
        </details>
      )}
      {rest.map((d) => <Day key={d.day} day={d.day} list={d.list} today={cal.today} />)}
      {days.length === 0 && (
        <p className="cal-ag-empty">Nothing on the calendar in {cal.label}{cal.filter.key !== 'all' ? ' for this filter' : ''}.</p>
      )}
      {days.length > 0 && rest.length === 0 && current && (
        <p className="cal-ag-empty">Nothing else this month.</p>
      )}
    </div>
  );
}
