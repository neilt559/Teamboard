'use client';
import { useState, useRef, useLayoutEffect } from 'react';

// Simple line-based formatting for meeting notes, saved as plain text:
//   %t Title     → title (extra bold, dashed rule above and below)
//   %h Header    → header (bold)
//   - Bullet     → bullet with a hexagon; indent 2 spaces per sub-level
//   anything else→ regular text
// The editor below shows that formatting live while you type (no separate
// preview); the codes only exist in the saved text.

const INDENT = '  '; // one bullet level
const MAX_LEVEL = 4;

export function parseNotes(text) {
  return String(text || '').split('\n').map((line) => {
    let m;
    if ((m = /^\s*%t\s?(.*)$/i.exec(line))) return { type: 'title', text: m[1] };
    if ((m = /^\s*%h\s?(.*)$/i.exec(line))) return { type: 'header', text: m[1] };
    if ((m = /^([ \t]*)-\s+(.*)$/.exec(line))) {
      const width = m[1].replace(/\t/g, INDENT).length;
      return { type: 'bullet', text: m[2], level: Math.min(MAX_LEVEL, Math.floor(width / INDENT.length)) };
    }
    if (!line.trim()) return { type: 'gap' };
    return { type: 'text', text: line };
  });
}

// Class names shared by the read-only view and the editor, so a line looks
// exactly the same while you're writing it as after it's posted.
const blockClass = (type, level) => (type === 'title' ? 'fmt-title'
  : type === 'header' ? 'fmt-h'
    : type === 'bullet' ? `fmt-li lvl${level}`
      : 'fmt-p');

export function FormattedNotes({ text, empty = 'No notes yet' }) {
  if (!String(text || '').trim()) return <div className="fmt fmt-empty">{empty}</div>;
  return (
    <div className="fmt">
      {parseNotes(text).map((b, i) => (b.type === 'gap'
        ? <div key={i} className="fmt-gap" />
        : <div key={i} className={blockClass(b.type, b.level)} style={b.type === 'bullet' ? { '--lvl': b.level } : undefined}>{b.text}</div>))}
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
