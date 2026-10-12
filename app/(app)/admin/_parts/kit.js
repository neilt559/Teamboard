'use client';
import { useCallback, useRef, useState } from 'react';

// Small helpers shared by the admin client components.

// Dates in an explicit zone (the viewer's office zone, viewer.tz; Central when not given). These components are
// rendered on the server (UTC on Vercel) and again in the browser: an unzoned format prints a different day or
// hour in each after about 7 PM US time, and React throws away the server HTML (hydration errors #418/#425).
const DEFAULT_TZ = 'America/Chicago';
// "Oct 12, 2026", or '—' (the Accounts page's old fallback).
export function fmtDay(v, tz) {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: tz || DEFAULT_TZ });
}
// "Oct 12, 3:04 PM"
export function fmtWhen(v, tz) {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d) ? '—' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz || DEFAULT_TZ });
}
export const plural = (n, one, many = `${one}s`) => `${n} ${Number(n) === 1 ? one : many}`;
export const same = (a, b) => a != null && b != null && String(a) === String(b);

// One action at a time per component: run(key, fn) marks `busy = key`, shows any error, and returns fn's
// result (undefined on error). msg/setMsg carry a success line.
export function useAct() {
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState(null);
  const running = useRef(false);
  const run = useCallback(async (key, fn) => {
    if (running.current) return undefined;
    running.current = true;
    setBusy(key);
    setErr('');
    try {
      return await fn();
    } catch (e) {
      setErr(e?.message || 'Something went wrong — please try again.');
      return undefined;
    } finally {
      running.current = false;
      setBusy(null);
    }
  }, []);
  return { busy, err, setErr, msg, setMsg, run };
}

// A department tag (same look as the header and directory tags).
export function DeptTag({ name, color }) {
  if (!name) return null;
  return <span className="adm-dept" style={{ '--c': color || '#5B5859' }}>{name}</span>;
}

// Text box that saves on Enter or blur when the text changed; Escape puts the stored value back.
// onSave(text, base) may throw (the error shows through the caller's useAct).
export function InlineText({ value, onSave, placeholder, maxLength = 200, className = '', label, disabled }) {
  const [text, setText] = useState(value ?? '');
  const [focus, setFocus] = useState(false);
  const base = useRef(value ?? '');
  const shown = focus ? text : (value ?? '');
  return (
    <input
      className={`field adm-inline ${className}`.trim()}
      value={shown}
      placeholder={placeholder}
      maxLength={maxLength}
      aria-label={label}
      disabled={disabled}
      onFocus={() => { setFocus(true); setText(value ?? ''); base.current = value ?? ''; }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setText(base.current); setTimeout(() => e.target.blur(), 0); }
      }}
      onBlur={() => {
        setFocus(false);
        if (text !== base.current) onSave(text, base.current);
      }}
    />
  );
}

// What each visibility level means (design §4.1), for position pickers.
export const LEVELS = {
  1: 'Sees projects they’re added to',
  2: 'Sees every project in their offices',
  3: 'Sees every project (PM)',
  4: 'Sees everything (leadership)',
};

// <option>s for a position picker, grouped by level; archived positions only when they are the current value.
export function PositionOptions({ positions, current }) {
  const groups = [1, 2, 3, 4].map((lvl) => ({
    lvl, list: positions.filter((p) => Number(p.level) === lvl && (!p.archived || same(p.id, current))),
  })).filter((g) => g.list.length);
  return groups.map((g) => (
    <optgroup key={g.lvl} label={`Level ${g.lvl}: ${LEVELS[g.lvl]}`}>
      {g.list.map((p) => <option key={p.id} value={p.id}>{p.name}{p.archived ? ' (archived)' : ''}</option>)}
    </optgroup>
  ));
}
