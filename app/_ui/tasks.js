// Shared task vocabulary and small task controls, extracted from the old single page (design §2.3) for the
// board, team overview, All Tasks, My work and task detail. No hooks and no 'use client', so server
// components can import the constants too; the controls take handlers, so they render inside client
// components. Task statuses are TASK_STATUSES here (suggestion statuses keep STATUSES in lib/suggestions.js).

// Stored keys never change (rule 40): not_started / working / stuck / done; stoplight '' means none.
export const TASK_STATUSES = {
  not_started: { label: 'Not Started', color: '#b6b6b7', text: '#6f6c6d' },
  working: { label: 'Working on it', color: '#fdab3d', text: '#b9760a' },
  stuck: { label: 'Stuck', color: '#e2445c', text: '#cf3350' },
  done: { label: 'Done', color: '#00c875', text: '#029457' },
};
export const STATUS_ORDER = ['not_started', 'working', 'stuck', 'done'];
export const STOPLIGHT_ORDER = ['red', 'yellow', 'green'];
export const STOPLIGHTS = { red: '#e5484d', yellow: '#f4be0d', green: '#2fb344' };
export const STOPLIGHT_TITLES = { red: 'Urgent', yellow: 'Priority', green: 'When there is time' };

// Offices and teams sort by position; projects by name, numeric-aware ("Project 2" before "Project 10").
export const byPos = (a, b) => (Number(a.position) - Number(b.position)) || (Number(a.id) - Number(b.id));
export const byName = (a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' });

export function initials(name) {
  if (!name) return '?';
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?';
}

// Compact "date added" label, e.g. 9/14/26 — deliberately small so it never
// competes with the target finish (Due) date.
export function fmtAdded(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
}

// A Date as the browser's local 'YYYY-MM-DD' (never toISOString(), which is UTC and flips to tomorrow in the evening).
export const localISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function isWebUrl(s) { return /^https?:\/\//i.test((s || '').trim()); }
// Local and UNC paths get a Copy button, because browsers can't open them (rule 47).
export function isFilePath(s) { const v = (s || '').trim(); return /^(\\\\|[a-zA-Z]:[\\/])/.test(v); }
export async function copyText(s) {
  try { await navigator.clipboard.writeText(s); return true; } catch { return false; }
}

const same = (a, b) => a != null && b != null && String(a) === String(b);
export const personById = (people, id) => (id == null ? null : (people || []).find((p) => same(p.id, id)) || null);

// The round initials avatar of a task owner (a "name on tasks", not a login account).
export function Avatar({ person, xs = false }) {
  const cls = xs ? 'avatar xs' : 'avatar';
  if (!person) return <span className={cls} style={{ background: '#dcdcdc', color: '#8a8788' }}>–</span>;
  return <span className={cls} style={{ background: person.color }} title={person.name}>{initials(person.name)}</span>;
}

// Owner picker. The last option opens "Names on tasks" (/people/names), where anyone can add a name.
// onManageNames defaults to a plain page load; pass () => router.push('/people/names') for a client navigation.
const MANAGE = '__manage_names__';
export function OwnerSelect({ value, people, onChange, onManageNames, className = 'owner-select', disabled, ...rest }) {
  return (
    <select
      {...rest}
      className={className}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => {
        const v = e.target.value;
        if (v === MANAGE) {
          if (onManageNames) onManageNames();
          else window.location.assign('/people/names');
          return;
        }
        onChange(v || null);
      }}
    >
      <option value="">Unassigned</option>
      {(people || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      <option value={MANAGE}>Manage names…</option>
    </select>
  );
}

// Status picker in the status's own colors. onChange gets the status key.
export function StatusSelect({ value, onChange, className = 'status-select', disabled, ...rest }) {
  const st = TASK_STATUSES[value] || TASK_STATUSES.not_started;
  return (
    <select
      {...rest}
      className={className}
      value={value || 'not_started'}
      disabled={disabled}
      style={{ background: '#fff', color: st.text, borderColor: st.color }}
      onChange={(e) => onChange(e.target.value)}
    >
      {STATUS_ORDER.map((s) => <option key={s} value={s}>{TASK_STATUSES[s].label}</option>)}
    </select>
  );
}

// Read-only status chip (archived rows, cards).
export function StatusPill({ value }) {
  const st = TASK_STATUSES[value] || TASK_STATUSES.not_started;
  return <span className="status-pill" style={{ background: st.color, color: value === 'not_started' ? '#3a3a3a' : '#fff' }}>{st.label}</span>;
}

// Stoplight priority: three hollow dots to pick from, or the one chosen (click it to clear).
// onChange gets 'red' | 'yellow' | 'green' | ''. Without onChange it renders read-only.
export function StoplightDots({ value, onChange, disabled }) {
  const on = value && STOPLIGHTS[value];
  if (!onChange) {
    return (
      <div className="stoplight">
        {on ? <span className="sl-dot on" style={{ '--sl': STOPLIGHTS[value] }} title={STOPLIGHT_TITLES[value]} /> : <span style={{ color: '#c4c4c4' }}>—</span>}
      </div>
    );
  }
  return (
    <div className="stoplight">
      {on ? (
        <button type="button" className="sl-dot on solo" style={{ '--sl': STOPLIGHTS[value] }} title="Click to clear priority" aria-label={`Priority: ${STOPLIGHT_TITLES[value]}. Clear`} disabled={disabled} onClick={() => onChange('')} />
      ) : (
        STOPLIGHT_ORDER.map((c) => (
          <button key={c} type="button" className="sl-dot" style={{ '--sl': STOPLIGHTS[c] }} title={STOPLIGHT_TITLES[c]} aria-label={`Set priority: ${STOPLIGHT_TITLES[c]}`} disabled={disabled} onClick={() => onChange(c)} />
        ))
      )}
    </div>
  );
}
