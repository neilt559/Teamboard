import { addDays, daysBetween, weekdayOf } from '@/lib/time';
import { fmtTimeShort } from '@/lib/events';

// Shared by the calendar page, MonthGrid and Agenda (server components; plain module, no client code).

// The calendar URL for a month / view / office filter; defaults are left out so links stay short.
export function calHref({ m, view, office, hash } = {}) {
  const q = new URLSearchParams();
  if (m) q.set('m', m);
  if (view && view !== 'auto') q.set('view', view);
  if (office && office !== 'mine') q.set('office', office);
  const s = q.toString();
  return `/culture/calendar${s ? `?${s}` : ''}${hash ? `#${hash}` : ''}`;
}

// Everything the month shows, as one list of items: { key, kind: 'event' | 'challenge' | 'bracket', id, title,
// starts_on, ends_on, all_day, start_time, href, ... }.
export function calendarItems(cal) {
  return [
    ...cal.brackets,
    ...cal.challenges,
    ...cal.events,
  ];
}

// How an item looks on one day: bar position (multi-day items), the label to show and its time.
//   { multi, start, end, segStart (first day of this week's piece), label, time, round }
export function dayView(it, day) {
  const multi = it.ends_on !== it.starts_on;
  const start = day === it.starts_on;
  const end = day === it.ends_on;
  const segStart = start || weekdayOf(day) === 0;
  let label = it.title;
  let round = null;
  if (it.kind === 'bracket') {
    round = it.days?.[day] || null;
    label = round ? `${round}` : it.title;
  }
  const time = it.kind === 'event' && !it.all_day && it.start_time && start ? fmtTimeShort(it.start_time) : '';
  return { multi, start, end, segStart, label, time, round };
}

// "Day 2 of 3" for an item that spans several days, else ''.
export function dayOfSpan(it, day) {
  if (it.ends_on === it.starts_on) return '';
  return `Day ${daysBetween(it.starts_on, day) + 1} of ${daysBetween(it.starts_on, it.ends_on) + 1}`;
}

// The days of [a, b] as 'YYYY-MM-DD' strings.
export function daysOf(a, b) {
  const out = [];
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
  return out;
}

// One item's accessible name, e.g. "Pumpkin carving, Lisle office, cancelled".
export function itemTitle(it) {
  const bits = [it.title];
  if (it.kind === 'challenge') bits.unshift('Challenge:');
  if (it.kind === 'bracket') bits.unshift('Bracket:');
  if (it.kind === 'event' && it.when?.time && it.when.time !== 'All day') bits.push(`(${it.when.time})`);
  if (it.office_name) bits.push(`· ${it.office_name} office`);
  if (it.cancelled) bits.push('· Cancelled');
  return bits.join(' ');
}
