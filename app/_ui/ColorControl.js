'use client';
import { useState, useEffect, useRef } from 'react';
import { normHex, toHex } from './people';

// Color picker plus hex box (design §2.3). Import it from app/_ui/people.js, which re-exports it. It lives in
// its own client module so people.js stays importable from route handlers and server components.

// Previews instantly while dragging and saves once the choice settles.
export function ColorControl({ value, onChange }) {
  const [local, setLocal] = useState(toHex(value));
  const timer = useRef(null);
  const pending = useRef(null);
  const save = useRef(onChange);
  save.current = onChange;
  useEffect(() => { setLocal(toHex(value)); }, [value]);
  // Closing the modal mid-drag still saves the last color picked.
  useEffect(() => () => {
    if (timer.current) { clearTimeout(timer.current); if (pending.current) save.current(pending.current); }
  }, []);
  const pick = (c) => {
    setLocal(c); // instant preview while dragging
    pending.current = c;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; pending.current = null; save.current(c); }, 250); // save once they settle
  };
  return (
    <div className="color-control">
      <input type="color" className="color-picker" value={local} onChange={(e) => pick(e.target.value)} title="Pick a color" aria-label="Pick a color" />
      <input
        type="text"
        className="hex-input"
        key={value}
        defaultValue={value}
        maxLength={7}
        placeholder="#5B5859"
        aria-label="Color hex code"
        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
        onBlur={(e) => { const v = normHex(e.target.value); if (v && v !== normHex(value)) onChange(v); else e.target.value = value; }}
      />
    </div>
  );
}
