// "Customize view" preferences (design §11), stored in users.prefs JSONB. Isomorphic and import-free:
// the server sanitizes with it before every write (PATCH /api/prefs) and on read; Settings uses the lists.
// Preferences only change what is SHOWN: followed offices and pins grant no access, and pins are
// re-filtered through tb_visible_project_ids on read.

// 'threads' keeps its stored key; since design-amendments A10 it lands on the Suggestions/Announcements board.
export const LANDINGS = {
  home: '/', 'my-work': '/my-work', projects: '/projects', tasks: '/tasks', threads: '/suggestions', culture: '/culture',
};
export const WIDGET_KEYS = ['my_tasks', 'pinned_projects', 'my_projects', 'announcements', 'threads', 'challenge',
  'events', 'bracket', 'geo', 'admin_queue'];
export const ADMIN_WIDGETS = ['admin_queue'];
export const DENSITIES = ['comfortable', 'compact'];
export const CALENDAR_VIEWS = ['month', 'agenda'];
export const MY_WORK_GROUPS = ['due', 'project'];
export const MAX_FOLLOWED = 10;
export const MAX_PINNED = 30;

// calendar_view null = the device default (agenda on phones, month on desktop).
export const DEFAULT_PREFS = Object.freeze({
  landing: 'home', density: 'comfortable', calendar_view: null, my_work_group: 'due',
  followed_office_ids: [], pinned_project_ids: [], position_notice_seen_at: null, dismissed: [],
});

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const oneOf = (list) => (v) => (list.includes(v) ? v : undefined);
const ids = (max) => (v) => {
  if (!Array.isArray(v)) return undefined;
  const out = [];
  for (const x of v) {
    const s = String(x ?? '');
    if (/^[0-9]{1,18}$/.test(s) && !out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
};
function widgets(v, { isAdmin }) {
  if (!Array.isArray(v)) return undefined;
  const out = [];
  for (const w of v) {
    const key = isObj(w) ? w.key : w;
    if (!WIDGET_KEYS.includes(key) || out.some((x) => x.key === key)) continue;   // unknown keys dropped
    if (ADMIN_WIDGETS.includes(key) && !isAdmin) continue;
    out.push({ key, on: isObj(w) ? w.on !== false : true });
  }
  return out;
}
function isoTime(v) {
  if (typeof v !== 'string' && typeof v !== 'number') return undefined;
  const t = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}
function dismissed(v) {
  if (!Array.isArray(v)) return undefined;
  const out = [];
  for (const x of v) if (typeof x === 'string' && /^[a-z0-9_]{1,40}$/.test(x) && !out.includes(x) && out.length < 50) out.push(x);
  return out;
}

const RULES = {
  landing: oneOf(Object.keys(LANDINGS)),
  widgets,
  followed_office_ids: ids(MAX_FOLLOWED),
  pinned_project_ids: ids(MAX_PINNED),
  density: oneOf(DENSITIES),
  calendar_view: oneOf(CALENDAR_VIEWS),
  my_work_group: oneOf(MY_WORK_GROUPS),
  position_notice_seen_at: isoTime,
  dismissed,
};

// The storable subset of raw: known keys with valid values only (anything else is dropped).
export function sanitizePrefs(raw, { isAdmin = false } = {}) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [k, rule] of Object.entries(RULES)) {
    if (!(k in raw)) continue;
    const v = rule(raw[k], { isAdmin });
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// PATCH semantics: keys in patch replace stored ones; a key set to null goes back to its default.
export function mergePrefs(current, patch, opts = {}) {
  const merged = { ...sanitizePrefs(current, opts) };
  if (isObj(patch)) {
    for (const k of Object.keys(RULES)) {
      if (!(k in patch)) continue;
      if (patch[k] === null) delete merged[k];
      else merged[k] = patch[k];
    }
  }
  return sanitizePrefs(merged, opts);
}

// Everything a page needs, defaults filled in. Widgets keep the saved order; new or missing widget keys are
// appended (switched on), so a release that adds a widget shows it without anyone re-saving.
export function withDefaults(raw, { isAdmin = false } = {}) {
  const p = { ...DEFAULT_PREFS, ...sanitizePrefs(raw, { isAdmin }) };
  const saved = widgets(p.widgets || [], { isAdmin }) || [];
  for (const key of WIDGET_KEYS) {
    if (ADMIN_WIDGETS.includes(key) && !isAdmin) continue;
    if (!saved.some((w) => w.key === key)) saved.push({ key, on: true });
  }
  return { ...p, widgets: saved, followed_office_ids: [...p.followed_office_ids], pinned_project_ids: [...p.pinned_project_ids],
    dismissed: [...p.dismissed] };
}

export const landingPath = (prefs) => LANDINGS[prefs?.landing] || '/';
