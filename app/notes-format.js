'use client';
import { useEffect, useState, useRef, useLayoutEffect } from 'react';
import { parseNotes } from './notes-parse';

// Simple line-based formatting for meeting notes, saved as plain text:
//   %t Title     → title (extra bold, dashed rule above and below)
//   %h Header    → header (bold)
//   - Bullet     → bullet with a hexagon; indent 2 spaces per sub-level
//   anything else→ regular text
// The editor below shows that formatting live while you type (no separate
// preview); the codes only exist in the saved text.

// The parser lives in a plain module (notes-parse.js) so Server Components (the A11 owner report) can call it too.
const INDENT = '  '; // one bullet level
const MAX_LEVEL = 4;
export { parseNotes };

// Class names shared by the read-only view and the editor, so a line looks
// exactly the same while you're writing it as after it's posted.
const blockClass = (type, level) => (type === 'title' ? 'fmt-title'
  : type === 'header' ? 'fmt-h'
    : type === 'bullet' ? `fmt-li lvl${level}`
      : 'fmt-p');

// Opt-in (threads, events): web links in the text become clickable. Only
// http(s) links, so a pasted "javascript:" never turns into a link; trailing
// punctuation stays text ("see https://x.com." links https://x.com).
const URL_RE = /https?:\/\/[^\s<>"]+/gi;
const TRAIL_RE = /[.,;:!?)\]}'"]+$/;
export function linkify(s) {
  const str = String(s ?? '');
  const out = [];
  let last = 0;
  for (const m of str.matchAll(URL_RE)) {
    const url = m[0].replace(TRAIL_RE, '');
    if (!url || url.length <= 8) continue;
    if (m.index > last) out.push(str.slice(last, m.index));
    out.push(<a key={m.index} href={url} target="_blank" rel="noopener noreferrer" className="fmt-link">{url}</a>);
    last = m.index + url.length;
  }
  if (!out.length) return str;
  if (last < str.length) out.push(str.slice(last));
  return out;
}

export function FormattedNotes({ text, empty = 'No notes yet', linkify: links = false }) {
  if (!String(text || '').trim()) return <div className="fmt fmt-empty">{empty}</div>;
  const show = links ? linkify : (s) => s;
  return (
    <div className="fmt">
      {parseNotes(text).map((b, i) => (b.type === 'gap'
        ? <div key={i} className="fmt-gap" />
        : <div key={i} className={blockClass(b.type, b.level)} style={b.type === 'bullet' ? { '--lvl': b.level } : undefined}>{show(b.text)}</div>))}
    </div>
  );
}

// ---- the editor: one block (line) per row, each styled as it will appear ----

let seq = 0;
const newId = () => `nb${++seq}`;
const toBlocks = (text) => {
  const bs = parseNotes(text).map((b) => ({ id: newId(), type: b.type === 'gap' ? 'text' : b.type, level: b.level || 0, text: b.text || '' }));
  return bs.length ? bs : [{ id: newId(), type: 'text', level: 0, text: '' }];
};
const serialize = (bs) => bs.map((b) => (b.type === 'title' ? `%t ${b.text}`
  : b.type === 'header' ? `%h ${b.text}`
    : b.type === 'bullet' ? `${INDENT.repeat(b.level)}- ${b.text}`
      : b.text)).join('\n');
// Typing a code at the start of a line turns the line into that kind.
const SHORTCUT = /^(%t|%h|-)\s/i;
const kindOf = (code) => (code.toLowerCase() === '%t' ? 'title' : code.toLowerCase() === '%h' ? 'header' : 'bullet');

export function NotesEditor({ value, onChange, placeholder }) {
  const [blocks, setBlocks] = useState(() => toBlocks(value));
  const [current, setCurrent] = useState(null); // id of the block being typed in
  const refs = useRef({});
  const pending = useRef(null); // { id, pos } to focus after the next render

  // Grow each line to fit its text, and put the caret where it belongs.
  useLayoutEffect(() => {
    Object.values(refs.current).forEach((el) => {
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    });
    if (pending.current) {
      const { id, pos } = pending.current;
      pending.current = null;
      const el = refs.current[id];
      if (el) {
        el.focus();
        const p = pos === 'end' ? el.value.length : Math.min(pos, el.value.length);
        el.setSelectionRange(p, p);
      }
    }
  });

  const commit = (next, focus) => {
    if (focus) pending.current = focus;
    setBlocks(next);
    onChange(serialize(next));
  };
  const replace = (i, patch, focus) => commit(blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)), focus);
  const focusAt = (i, pos) => {
    const el = refs.current[blocks[i].id];
    if (!el) return;
    el.focus();
    const p = pos === 'end' ? el.value.length : pos;
    el.setSelectionRange(p, p);
  };

  const onText = (i, e) => {
    const b = blocks[i];
    const v = e.target.value;
    const m = SHORTCUT.exec(v);
    if (m) {
      const type = kindOf(m[1]);
      replace(i, { type, level: type === 'bullet' && b.type === 'bullet' ? b.level : 0, text: v.slice(m[0].length) },
        { id: b.id, pos: Math.max(0, e.target.selectionStart - m[0].length) });
      return;
    }
    replace(i, { text: v.replace(/\n/g, ' ') });
  };

  const onKey = (i, e) => {
    const b = blocks[i];
    const el = e.target;
    const s = el.selectionStart;
    const end = el.selectionEnd;
    const atStart = s === 0 && end === 0;
    const atEnd = s === b.text.length && end === s;

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (b.type === 'bullet' && !b.text.trim()) { replace(i, { type: 'text', level: 0, text: '' }, { id: b.id, pos: 0 }); return; }
      const nb = { id: newId(), type: b.type === 'bullet' ? 'bullet' : 'text', level: b.type === 'bullet' ? b.level : 0, text: b.text.slice(end) };
      commit([...blocks.slice(0, i), { ...b, text: b.text.slice(0, s) }, nb, ...blocks.slice(i + 1)], { id: nb.id, pos: 0 });
    } else if (e.key === 'Backspace' && atStart) {
      // Peel formatting off first (sub-bullet → bullet → text), then join lines.
      if (b.type === 'bullet' && b.level > 0) { e.preventDefault(); replace(i, { level: b.level - 1 }, { id: b.id, pos: 0 }); }
      else if (b.type !== 'text') { e.preventDefault(); replace(i, { type: 'text', level: 0 }, { id: b.id, pos: 0 }); }
      else if (i > 0) {
        e.preventDefault();
        const prev = blocks[i - 1];
        commit([...blocks.slice(0, i - 1), { ...prev, text: prev.text + b.text }, ...blocks.slice(i + 1)], { id: prev.id, pos: prev.text.length });
      }
    } else if (e.key === 'Delete' && atEnd && i < blocks.length - 1) {
      e.preventDefault();
      const nx = blocks[i + 1];
      commit([...blocks.slice(0, i), { ...b, text: b.text + nx.text }, ...blocks.slice(i + 2)], { id: b.id, pos: s });
    } else if (e.key === 'Tab' && b.type === 'bullet') {
      e.preventDefault();
      replace(i, { level: Math.max(0, Math.min(MAX_LEVEL, b.level + (e.shiftKey ? -1 : 1))) }, { id: b.id, pos: s });
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowLeft') && atStart && i > 0) {
      e.preventDefault();
      focusAt(i - 1, 'end');
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowRight') && atEnd && i < blocks.length - 1) {
      e.preventDefault();
      focusAt(i + 1, 0);
    }
  };

  // Pasting several lines formats each one (their codes are honoured).
  const onPaste = (i, e) => {
    const t = e.clipboardData.getData('text/plain');
    if (!t.includes('\n')) return;
    e.preventDefault();
    const b = blocks[i];
    const el = e.target;
    const before = b.text.slice(0, el.selectionStart);
    const after = b.text.slice(el.selectionEnd);
    const parsed = toBlocks(t.replace(/\r/g, ''));
    const first = parsed[0];
    const head = before
      ? { ...b, text: before + first.text }
      : { ...b, type: first.type, level: first.level, text: first.text };
    if (parsed.length === 1) {
      commit([...blocks.slice(0, i), { ...head, text: head.text + after }, ...blocks.slice(i + 1)], { id: b.id, pos: head.text.length });
      return;
    }
    const last = parsed[parsed.length - 1];
    const tail = { ...last, text: last.text + after };
    commit([...blocks.slice(0, i), head, ...parsed.slice(1, -1), tail, ...blocks.slice(i + 1)], { id: tail.id, pos: last.text.length });
  };

  // Title / Header / Bullet buttons switch the line you're on (again = plain).
  const toggle = (kind) => {
    let i = blocks.findIndex((b) => b.id === current);
    if (i < 0) i = blocks.length - 1;
    const b = blocks[i];
    const el = refs.current[b.id];
    const pos = el && document.activeElement === el ? el.selectionStart : 'end';
    replace(i, b.type === kind ? { type: 'text', level: 0 } : { type: kind, level: 0 }, { id: b.id, pos });
  };
  const curType = (blocks.find((b) => b.id === current) || {}).type;
  const keep = (e) => e.preventDefault(); // buttons mustn't steal the caret

  return (
    <div className="notes-ed">
      <div className="notes-ed-bar">
        <button type="button" className={curType === 'title' ? 'on' : ''} onMouseDown={keep} onClick={() => toggle('title')} title="Title (or type %t at the start of a line)">Title</button>
        <button type="button" className={curType === 'header' ? 'on' : ''} onMouseDown={keep} onClick={() => toggle('header')} title="Header (or type %h at the start of a line)"><b>Header</b></button>
        <button type="button" className={curType === 'bullet' ? 'on' : ''} onMouseDown={keep} onClick={() => toggle('bullet')} title="Bullet (or type - at the start of a line). Tab indents."><span className="hex" aria-hidden="true" /> Bullet</button>
        <span className="notes-ed-hint">or start a line with <code>%t</code> <code>%h</code> <code>-</code> · Tab indents a bullet</span>
      </div>
      <div
        className="fmt notes-ed-box"
        onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); focusAt(blocks.length - 1, 'end'); } }}
      >
        {blocks.map((b, i) => (
          <div key={b.id} className={`${blockClass(b.type, b.level)} nb${b.id === current ? ' cur' : ''}`} style={b.type === 'bullet' ? { '--lvl': b.level } : undefined}>
            <textarea
              ref={(el) => { if (el) refs.current[b.id] = el; else delete refs.current[b.id]; }}
              rows={1}
              value={b.text}
              placeholder={blocks.length === 1 && !b.text ? placeholder : undefined}
              onChange={(e) => onText(i, e)}
              onKeyDown={(e) => onKey(i, e)}
              onPaste={(e) => onPaste(i, e)}
              onFocus={() => setCurrent(b.id)}
              aria-label={b.type === 'title' ? 'Title line' : b.type === 'header' ? 'Header line' : b.type === 'bullet' ? 'Bullet' : 'Notes line'}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// The live-formatted editor for shared text (the project's Status Report, design-amendments A11: Neil rejected a
// plain textarea with %t / %h codes). It keeps SyncedField's rules (app/synced.js): other people's changes show as
// they arrive, except while you are in the editor; it saves when the focus leaves the editor (moving between its
// lines does not count) and only when you changed the text since you came in; onSave(text, base) gets the value
// the editor held when you came in, and may return false (snap back) or a promise of the stored value.
export function SyncedNotesEditor({ value, onSave, placeholder, ...rest }) {
  const latest = value == null ? '' : String(value);
  const [text, setText] = useState(latest);
  const [gen, setGen] = useState(0);              // a new editor when someone else's text replaces yours
  const focused = useRef(false);
  const atFocus = useRef(latest);
  const known = useRef(latest);
  const textNow = useRef(latest);
  textNow.current = text;
  const show = (t) => { if (t !== textNow.current) { setText(t); setGen((g) => g + 1); } };

  useEffect(() => {
    known.current = latest;
    if (!focused.current) show(latest);
  }, [latest]); // eslint-disable-line react-hooks/exhaustive-deps

  const adopt = (stored) => {
    if (stored === false) { if (!focused.current) show(known.current); return; }
    if (stored == null || typeof stored === 'boolean') return;
    known.current = String(stored);
    if (!focused.current) show(known.current);
  };

  return (
    <div
      {...rest}
      className={`notes-synced${rest.className ? ` ${rest.className}` : ''}`}
      onFocus={() => {
        if (focused.current) return;
        focused.current = true;
        atFocus.current = textNow.current;
      }}
      onBlur={(e) => {
        if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;   // another line of the editor
        focused.current = false;
        const t = textNow.current;
        if (t !== atFocus.current) {
          const r = onSave(t, atFocus.current);
          if (r === false) show(known.current);
          else if (r && typeof r.then === 'function') r.then(adopt, () => {});
        } else if (t !== known.current) {
          show(known.current);                    // someone else changed it while you were in here
        }
      }}
    >
      <NotesEditor key={gen} value={text} onChange={(t) => { textNow.current = t; setText(t); }} placeholder={placeholder} />
    </div>
  );
}
