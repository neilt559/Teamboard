'use client';
import { useRef, useLayoutEffect } from 'react';

// Simple line-based formatting for meeting notes:
//   %t Title     → title (extra bold, dashed rule above and below)
//   %h Header    → header (bold)
//   - Bullet     → bullet with a hexagon; indent with spaces/Tab for sub-bullets
//   anything else→ regular text; a blank line adds a little space.

const INDENT = '  '; // one bullet level

export function parseNotes(text) {
  return String(text || '').split('\n').map((line) => {
    let m;
    if ((m = /^\s*%t\s?(.*)$/i.exec(line))) return { type: 'title', text: m[1] };
    if ((m = /^\s*%h\s?(.*)$/i.exec(line))) return { type: 'header', text: m[1] };
    if ((m = /^([ \t]*)-\s+(.*)$/.exec(line))) {
      const width = m[1].replace(/\t/g, INDENT).length;
      return { type: 'bullet', text: m[2], level: Math.min(4, Math.floor(width / INDENT.length)) };
    }
    if (!line.trim()) return { type: 'gap' };
    return { type: 'text', text: line };
  });
}

export function FormattedNotes({ text, empty = 'No notes yet' }) {
  if (!String(text || '').trim()) return <div className="fmt fmt-empty">{empty}</div>;
  const blocks = parseNotes(text);
  return (
    <div className="fmt">
      {blocks.map((b, i) => {
        if (b.type === 'title') return <div key={i} className="fmt-title">{b.text}</div>;
        if (b.type === 'header') return <div key={i} className="fmt-h">{b.text}</div>;
        if (b.type === 'bullet') return <div key={i} className={`fmt-li lvl${b.level}`} style={{ '--lvl': b.level }}>{b.text}</div>;
        if (b.type === 'gap') return <div key={i} className="fmt-gap" />;
        return <p key={i} className="fmt-p">{b.text}</p>;
      })}
    </div>
  );
}

const IS = {
  title: (l) => /^\s*%t\s?/i.test(l),
  header: (l) => /^\s*%h\s?/i.test(l),
  bullet: (l) => /^[ \t]*-\s+/.test(l),
};
// A line with any formatting code removed (bullets keep their indent).
const plain = (l) => l.replace(/^\s*%[th]\s?/i, '').replace(/^([ \t]*)-\s+/, '$1');

// Textarea with Title / Header / Bullet buttons and a live preview.
export function NotesEditor({ value, onChange, placeholder }) {
  const ref = useRef(null);
  const pending = useRef(null); // caret position to restore after we rewrite the text

  useLayoutEffect(() => {
    if (pending.current && ref.current) {
      const [s, e] = pending.current;
      ref.current.setSelectionRange(s, e);
      pending.current = null;
    }
  }, [value]);

  const write = (next, s, e = s) => { pending.current = [s, e]; onChange(next); };

  // Start/end of the full lines the selection touches.
  const lineSpan = (v, s, e) => {
    const a = v.lastIndexOf('\n', s - 1) + 1;
    let b = v.indexOf('\n', e);
    if (b === -1) b = v.length;
    return [a, b];
  };

  // Turn the selected lines into (or back out of) a title, header or bullet.
  const toggle = (kind) => {
    const ta = ref.current;
    const v = value || '';
    const [a, b] = lineSpan(v, ta.selectionStart, ta.selectionEnd);
    const lines = v.slice(a, b).split('\n');
    const filled = lines.filter((l) => l.trim());
    const allOn = filled.length > 0 && filled.every(IS[kind]);
    const out = lines.map((l) => {
      if (!l.trim() && lines.length > 1) return l;
      const base = plain(l);
      if (allOn) return base;
      if (kind === 'bullet') return base.replace(/^([ \t]*)/, '$1- ');
      return (kind === 'title' ? '%t ' : '%h ') + base.trimStart();
    }).join('\n');
    write(v.slice(0, a) + out + v.slice(b), a + out.length);
    ta.focus();
  };

  const onKeyDown = (e) => {
    const ta = e.target;
    const v = value || '';
    const pos = ta.selectionStart;
    if (pos !== ta.selectionEnd) return;
    const ls = v.lastIndexOf('\n', pos - 1) + 1;
    let le = v.indexOf('\n', pos);
    if (le === -1) le = v.length;
    const line = v.slice(ls, le);
    const m = /^([ \t]*)-\s+(.*)$/.exec(line);
    if (!m) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!m[2].trim()) {
        // Enter on an empty bullet ends the list.
        write(v.slice(0, ls) + v.slice(le), ls);
      } else {
        const ins = `\n${m[1]}- `;
        write(v.slice(0, pos) + ins + v.slice(pos), pos + ins.length);
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        const cut = m[1].startsWith('\t') ? 1 : Math.min(INDENT.length, m[1].length - m[1].trimStart().length);
        if (!cut) return;
        write(v.slice(0, ls) + line.slice(cut) + v.slice(le), Math.max(ls, pos - cut));
      } else {
        write(v.slice(0, ls) + INDENT + line + v.slice(le), pos + INDENT.length);
      }
    }
  };

  // Toolbar buttons mustn't steal focus (that would lose the caret position).
  const keep = (e) => e.preventDefault();
  return (
    <div className="notes-ed">
      <div className="notes-ed-bar">
        <button type="button" onMouseDown={keep} onClick={() => toggle('title')} title="Title — start a line with %t">Title</button>
        <button type="button" onMouseDown={keep} onClick={() => toggle('header')} title="Header — start a line with %h"><b>Header</b></button>
        <button type="button" onMouseDown={keep} onClick={() => toggle('bullet')} title="Bullet — start a line with - (Tab indents)"><span className="hex" aria-hidden="true" /> Bullet</button>
        <span className="notes-ed-hint">or type <code>%t</code> title · <code>%h</code> header · <code>-</code> bullet</span>
      </div>
      <textarea ref={ref} className="pm-notes" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} />
      {String(value || '').trim() && (
        <div className="notes-ed-preview">
          <div className="pm-label">Preview</div>
          <FormattedNotes text={value} />
        </div>
      )}
    </div>
  );
}
