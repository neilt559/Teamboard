// Suggestion box categories and statuses — shared by the API and the page.
// Since design-amendments A10 (Neil, 2026-10-14) the box is the "Suggestions/Announcements" board: CAGE and one
// per office, one feed where each post is a suggestion or an announcement. Import-free, so client components,
// routes and loaders share these.

// Kept deliberately broad. Anything filed under a retired category counts as Other.
export const CATEGORIES = [
  { key: 'culture', label: 'Culture', color: '#e2445c' },
  { key: 'operations', label: 'Operations', color: '#0086c0' },
  { key: 'ai', label: 'AI', color: '#a25ddc' },
  { key: 'cad', label: 'CAD', color: '#037f4c' },
  { key: 'clients', label: 'Marketing & Clients', color: '#c77c02' },
  { key: 'other', label: 'Other', color: '#8a8788' },
];
export const categoryKey = (k) => (CATEGORIES.some((c) => c.key === k) ? k : 'other');

export const STATUSES = [
  { key: 'new', label: 'New', color: '#8a8788' },
  { key: 'review', label: 'Under review', color: '#0086c0' },
  { key: 'planned', label: 'Planned', color: '#8f9100' },
  { key: 'done', label: 'Done', color: '#2fb344' },
  { key: 'declined', label: 'Not now', color: '#c4483e' },
];

export const categoryOf = (k) => CATEGORIES.find((c) => c.key === k) || CATEGORIES[CATEGORIES.length - 1];
export const statusOf = (k) => STATUSES.find((s) => s.key === k) || STATUSES[0];

// ---- the boards (A10) ----

export const BOARD_LABEL = 'Suggestions/Announcements';   // header tab, drawer, page titles
export const BOARD_SHORT = 'Posts';                         // the phone bottom bar
export const COMPANY_BOARD_NAME = 'CAGE';

// suggestions.kind (CHECK in lib/schema/threads.js).
export const KINDS = ['suggestion', 'announcement'];
export const isKind = (k) => KINDS.includes(k);
export const isAnnouncement = (s) => s?.kind === 'announcement';

export const TITLE_MAX = 160;                 // both kinds
export const DETAILS_MAX = 5000;              // a suggestion's details
export const ANNOUNCEMENT_MAX = 10000;        // an announcement's body (notes markup), as thread posts had
export const REPLY_MAX = 5000;

// Announcements this recent sit at the top of the feed, newest first, with an "Announcement" badge (A10.2);
// older ones fall into the date order with everything else.
export const TOP_DAYS = 14;
const DAY_MS = 24 * 3600 * 1000;
export const isRecentAnnouncement = (s, now) =>
  isAnnouncement(s) && Number.isFinite(Date.parse(s.created_at)) && Number(now) - Date.parse(s.created_at) < TOP_DAYS * DAY_MS;

// A board is named by 'company' (CAGE, everyone) or 'office:<id>' (canonical digits: no sign, no leading zero, at
// most 18 digits). Anything else, team keys included, is no board. -> { key, scope, office_id } or null.
const OFFICE_KEY = /^office:([1-9][0-9]{0,17})$/;
export function parseBoardKey(v) {
  if (v === 'company') return { key: 'company', scope: 'company', office_id: null };
  const m = typeof v === 'string' ? OFFICE_KEY.exec(v) : null;
  return m ? { key: `office:${m[1]}`, scope: 'office', office_id: m[1] } : null;
}
// The board page of a key: /suggestions (CAGE) or /suggestions/office/<id>.
export function boardHref(key) {
  const b = typeof key === 'string' ? parseBoardKey(key) : key;
  if (!b || b.scope === 'company') return '/suggestions';
  return `/suggestions/office/${b.office_id}`;
}
// A post's own link on its board (the card carries id="post-<id>").
export const postHref = (key, id) => `${boardHref(key)}#post-${id}`;

// Feed order (A10.2): announcements from the last TOP_DAYS days first (newest first), then everything else by
// date, newest first (or, sort 'top', by +1s then date). Returns a new array.
export function boardOrder(rows, now, sort = 'new') {
  const t = (s) => Date.parse(s.created_at) || 0;
  const newest = (a, b) => (t(b) - t(a)) || (Number(b.id) - Number(a.id));
  const top = rows.filter((s) => isRecentAnnouncement(s, now)).sort(newest);
  const rest = rows.filter((s) => !isRecentAnnouncement(s, now))
    .sort(sort === 'top' ? (a, b) => ((Number(b.votes) || 0) - (Number(a.votes) || 0)) || newest(a, b) : newest);
  return [...top, ...rest];
}
