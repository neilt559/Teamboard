'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { IconSearch, IconX } from '../icons';
import { api } from './api';
import { Headshot } from './Headshot';
import NameLabel from './NameLabel';
import DeptTag from './DeptTag';

// Pick signed-up people (design §5.2 wizard "Boss", §6 project Members "+ Add people", admin tools).
// Searches GET /api/users/search (public fields only: id, name, username, identity_verified, office,
// department, team, position, avatar_v; members first, with is_member, only when the viewer can see projectId).
//
//   single:   <UserPicker value={user|null} onChange={(user|null) => ...} noneLabel="Not listed yet" />
//   multiple: <UserPicker multiple value={users[]} onChange={(users[]) => ...} projectId={id} exclude={memberIds} />
//   static:   <UserPicker options={users} ... />   filters the given list in the browser instead of searching
//
// value objects only need { id, name | display_name | username }. exclude: ids never offered (e.g. current
// members, yourself). noneLabel (single mode): an extra first choice that sets null ("Not listed yet").
// defaultOpen: show the result list right away (the Members panel's Add people dialog) instead of on focus.
// officeId: list people whose home office it is first (the team roster's Add member); anyone can still be picked.
// already / alreadyLabel: ids still listed (after everyone else) but greyed out and not pickable, e.g. people
// already on the project, so a search for them explains itself instead of showing nothing.
// Keyboard: arrows move, Enter picks, Escape closes; rows are 44 px tall on phones. Nothing is highlighted until
// you type or use the arrows, so a highlighted row is never mistaken for a picked one.

const norm = (s) => String(s ?? '').toLowerCase();
const nameOf = (u) => (u ? u.name || u.display_name || u.username || '' : '');

export function filterUsers(list, q, exclude = []) {
  const ex = new Set(exclude.map(String));
  const n = norm(q).trim();
  const rows = (list || []).filter((u) => !ex.has(String(u.id)));
  if (!n) return rows;
  return rows
    .filter((u) => norm(nameOf(u)).includes(n) || norm(u.username).includes(n))
    .sort((a, b) => {
      const ap = norm(nameOf(a)).startsWith(n) || norm(a.username).startsWith(n) ? 0 : 1;
      const bp = norm(nameOf(b)).startsWith(n) || norm(b.username).startsWith(n) ? 0 : 1;
      return ap - bp || nameOf(a).localeCompare(nameOf(b));
    });
}

export default function UserPicker({
  value = null, onChange, multiple = false, projectId = null, officeId = null, exclude = [], options = null,
  placeholder = 'Search by name', noneLabel = '', autoFocus = false, defaultOpen = false, disabled = false, label = 'Search people',
  limit = 20, className = '', already = [], alreadyLabel = 'Already added',
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(!!defaultOpen);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [active, setActive] = useState(0);
  const wrap = useRef(null);
  const input = useRef(null);
  const seq = useRef(0);

  const selected = multiple ? (Array.isArray(value) ? value : []) : value;
  // A string, so a fresh [] from the parent on every render doesn't re-run the search.
  const hiddenKey = [
    ...(exclude || []).map(String),
    ...(multiple ? selected.map((u) => String(u.id)) : []),
  ].join(',');
  const hidden = useMemo(() => (hiddenKey ? hiddenKey.split(',') : []), [hiddenKey]);

  // Static list: filter here. Otherwise ask the server (debounced; stale answers are dropped).
  useEffect(() => {
    if (!open) return undefined;
    if (options) { setRows(filterUsers(options, q, hidden).slice(0, 200)); setLoading(false); return undefined; }
    const my = ++seq.current;
    setLoading(true);
    setErr('');
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: q.trim(), limit: String(limit) });
        if (projectId != null) params.set('project_id', String(projectId));
        if (officeId != null) params.set('office_id', String(officeId));
        const r = await api(`/api/users/search?${params}`, { quiet: true });
        if (my !== seq.current) return;
        const ex = new Set(hidden);
        setRows((Array.isArray(r.users) ? r.users : []).filter((u) => !ex.has(String(u.id))));
      } catch (e) {
        if (my === seq.current) { setRows([]); setErr(e.message || 'Couldn’t search right now.'); }
      } finally {
        if (my === seq.current) setLoading(false);
      }
    }, q ? 200 : 0);
    return () => clearTimeout(t);
  }, [q, open, options, projectId, officeId, limit, hidden]);

  // Close when focus or a click leaves the picker.
  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', down);
    document.addEventListener('touchstart', down, { passive: true });
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('touchstart', down);
    };
  }, [open]);

  const alreadyKey = (already || []).map(String).join(',');
  const alreadySet = useMemo(() => new Set(alreadyKey ? alreadyKey.split(',') : []), [alreadyKey]);
  const isAlready = (u) => !u.none && alreadySet.has(String(u.id));
  // People you can pick first, then the greyed-out ones.
  const sorted = alreadySet.size ? [...rows.filter((u) => !isAlready(u)), ...rows.filter(isAlready)] : rows;
  const choices = [...(!multiple && noneLabel ? [{ none: true }] : []), ...sorted];
  const firstPickable = choices.findIndex((u) => !isAlready(u));
  useEffect(() => { setActive(q.trim() ? firstPickable : -1); }, [q, rows.length, firstPickable]);

  const pick = (u) => {
    if (isAlready(u)) return;
    if (multiple) {
      if (u.none) return;
      onChange([...selected, u]);
      setQ('');
      input.current?.focus();
    } else {
      onChange(u.none ? null : u);
      setQ('');
      setOpen(false);
    }
  };
  const unpick = (u) => {
    if (multiple) onChange(selected.filter((x) => String(x.id) !== String(u.id)));
    else onChange(null);
  };

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, Math.max(0, choices.length - 1))); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') {
      if (open && active >= 0 && choices[active]) { e.preventDefault(); pick(choices[active]); }
    } else if (e.key === 'Escape') {
      if (open) { e.stopPropagation(); setOpen(false); }
    } else if (e.key === 'Backspace' && multiple && !q && selected.length) {
      unpick(selected[selected.length - 1]);
    }
  };

  const optId = (i) => `${id}-opt-${i}`;
  return (
    <div className={`user-picker${className ? ` ${className}` : ''}`} ref={wrap}>
      {multiple && selected.length > 0 && (
        <div className="up-chips">
          {selected.map((u) => (
            <span key={u.id} className="up-chip">
              <Headshot user={u} size={20} />
              <span className="up-chip-name">{nameOf(u)}</span>
              <button type="button" className="up-chip-x" onClick={() => unpick(u)} aria-label={`Remove ${nameOf(u)}`} disabled={disabled}>
                <IconX size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {!multiple && selected && !open ? (
        <div className="up-selected">
          <Headshot user={selected} size={24} />
          <NameLabel user={selected} />
          <span className="spacer" />
          <button type="button" className="btn btn-plain btn-sm" disabled={disabled}
            onClick={() => { setOpen(true); setTimeout(() => input.current?.focus(), 0); }}>Change</button>
          <button type="button" className="btn btn-plain btn-sm" disabled={disabled} onClick={() => unpick(selected)}>Clear</button>
        </div>
      ) : (
        <div className="up-input-wrap">
          <IconSearch size={15} className="up-search-icon" />
          <input
            ref={input}
            className="field up-input"
            type="search"
            role="combobox"
            aria-label={label}
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && active >= 0 && choices[active] ? optId(active) : undefined}
            placeholder={placeholder}
            value={q}
            autoFocus={autoFocus}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            maxLength={80}
            onChange={(e) => { setQ(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKey}
          />
        </div>
      )}
      {open && (
        <ul className="up-list" id={listId} role="listbox" aria-label={label}>
          {choices.map((u, i) => (
            <li
              key={u.none ? 'none' : u.id}
              id={optId(i)}
              role="option"
              aria-selected={i === active}
              aria-disabled={isAlready(u) || undefined}
              className={`up-opt${i === active ? ' on' : ''}${u.none ? ' none' : ''}${isAlready(u) ? ' already' : ''}`}
              onMouseEnter={() => { if (!isAlready(u)) setActive(i); }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(u)}
            >
              {u.none ? <span className="up-none">{noneLabel}</span> : (
                <>
                  <Headshot user={u} size={28} />
                  <span className="up-opt-main">
                    <NameLabel user={u} />
                    <span className="up-opt-meta">
                      {u.department && <DeptTag dept={u.department} />}
                      {[u.position, u.office, u.team].filter(Boolean).join(' · ')}
                      {isAlready(u)
                        ? <span className="up-member">{alreadyLabel}</span>
                        : u.is_member && <span className="up-member">On this project</span>}
                    </span>
                  </span>
                </>
              )}
            </li>
          ))}
          {!loading && !err && rows.length === 0 && (
            <li className="up-empty" aria-disabled="true">{q ? `No one matches “${q}”.` : 'No one to show.'}</li>
          )}
          {loading && rows.length === 0 && <li className="up-empty" aria-disabled="true">Searching…</li>}
          {err && <li className="up-empty up-err" aria-disabled="true">{err}</li>}
        </ul>
      )}
    </div>
  );
}

export { UserPicker };
