import Link from 'next/link';
import { layoutWeek, fmtDate, WEEKDAY_NAMES } from '@/lib/events';
import { IconMedal, IconTrophy, IconPlus } from '@/app/icons';
import { dayView, itemTitle } from './cal-items';

// The desktop month grid (design §10(b)): 7 columns, the week starts on Sunday; up to 3 rows a day, else 2 and
// "+N more" (a no-JavaScript <details> popover with the whole day). Multi-day items (events, challenge range bars, the
// auto bracket's Mon-Fri week labeled with each day's round) show on every day they cover, drawn as one bar that keeps
// its row for the whole week (lib/events.js layoutWeek; empty rows under a bar are spacers); the label repeats at the
// start of each week's piece. Office events carry the office name; company events have a lime left border; cancelled
// events are struck through. Organizers get a "+" on each day of the month (new event that day).
// A server component: plain links, nothing to hydrate.

const MAX_ROWS = 3;

function Chip({ it, day }) {
  const v = dayView(it, day);
  const cls = ['cal-chip', `cal-${it.kind}`];
  if (it.kind === 'event') cls.push(it.office_id ? 'is-office' : 'is-company');
  if (it.cancelled) cls.push('is-cancelled');
  if (v.multi) {
    cls.push('cal-bar');
    if (v.start) cls.push('bar-start');
    if (v.end) cls.push('bar-end');
    if (!v.segStart && it.kind !== 'bracket') cls.push('bar-cont');
  }
  return (
    <li>
      <Link href={it.href} prefetch={false} className={cls.join(' ')} title={itemTitle(it)}>
        {it.kind === 'challenge' && v.segStart && <IconMedal size={12} />}
        {it.kind === 'bracket' && <IconTrophy size={12} />}
        {v.time && <span className="cal-chip-time">{v.time}</span>}
        <span className="cal-chip-title">{v.label}</span>
        {it.kind === 'event' && it.office_name && v.segStart && <span className="cal-chip-office">{it.office_name}</span>}
      </Link>
    </li>
  );
}

export default function MonthGrid({ cal, items }) {
  return (
    <div className="cal-month" aria-label={`${cal.label}, month view`}>
      <div className="cal-dow" aria-hidden="true">
        {WEEKDAY_NAMES.map((d) => <span key={d}>{d}</span>)}
      </div>
      <div className="cal-weeks">
        {cal.grid.weeks.map((week) => (
          <div className="cal-week" key={week[0]}>
            {layoutWeek(items, week, MAX_ROWS).map(({ day, slots, hidden, all }) => {
              const out = day < cal.grid.first || day > cal.grid.last;
              const isToday = day === cal.today;
              return (
                <div key={day} id={`g-${day}`} className={`cal-day${out ? ' is-out' : ''}${isToday ? ' is-today' : ''}${day < cal.today ? ' is-past' : ''}`}>
                  <div className="cal-day-head">
                    <span className="cal-day-num" aria-label={fmtDate(day, { weekday: true, year: true })}>{Number(day.slice(8))}</span>
                    {isToday && <span className="cal-today-tag">Today</span>}
                    {cal.can_manage && !out && (
                      <Link href={`/culture/events/new?date=${day}`} prefetch={false} className="cal-add" aria-label={`Add an event on ${fmtDate(day, { weekday: true })}`} title="Add an event">
                        <IconPlus size={13} />
                      </Link>
                    )}
                  </div>
                  {slots.length > 0 && (
                    <ul className="cal-chips">
                      {slots.map((it, i) => (it ? <Chip key={it.key} it={it} day={day} /> : <li key={`s${i}`} className="cal-slot" aria-hidden="true" />))}
                    </ul>
                  )}
                  {hidden > 0 && (
                    <details className="cal-more">
                      <summary>+{hidden} more</summary>
                      <div className="cal-more-pop" role="group" aria-label={fmtDate(day, { weekday: true })}>
                        <div className="cal-more-date">{fmtDate(day, { weekday: true })}</div>
                        <ul className="cal-chips">
                          {all.map((it) => <Chip key={it.key} it={it} day={day} />)}
                        </ul>
                      </div>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
