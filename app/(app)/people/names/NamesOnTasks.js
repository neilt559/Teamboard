'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SyncedField } from '@/app/synced';
import { IconTag, IconArchive, IconAlert, IconSettings, IconShield, IconUsers } from '@/app/icons';
import { api, ConflictError } from '@/app/_ui/api';
import { ColorControl, PERSON_COLORS, normHex } from '@/app/_ui/people';
import { initials } from '@/app/_ui/tasks';
import NameLabel from '@/app/_ui/NameLabel';
import ConflictNotice from '@/app/_ui/ConflictNotice';
import { useConfirm } from '@/app/_ui/ConfirmDialog';
import useServerState, { mergeById } from '@/app/_ui/useServerState';
import { useRefreshOnFocus } from '@/app/_ui/useRefresh';

// "Names on tasks" (design §2.1 /people/names): today's People modal (inventory §1.11) for everyone. The
// names and groups tasks can be assigned to (the `people` table, separate from login accounts).
//   - Anyone can add a name or a group, rename and recolor unlinked names and groups, and archive them
//     (with a confirm; tasks keep their owner, and an admin can restore the name on /admin/people).
//   - A name linked to an account is read-only here ("Linked to Kyler Hugg"): its owner changes it in
//     Settings, admins on /admin/people.
// Writes go to /api/people (agent I2's routes, design §8.2): POST {name, color, kind}; PATCH {name, base}
// or {color}; DELETE archives.

const rowFrom = (r) => (r && r.row ? r.row : r);
const listKey = (kind) => (kind === 'group' ? 'groups' : 'people');

function EditableRow({ p, conflict, onRename, onColor, onArchive, onKeepMine, onDismissConflict }) {
  const [mine, setMine] = useState('');
  return (
    <div className="person-row-wrap">
      <div className="person-row">
        <span className="avatar" style={{ background: p.color }} aria-hidden="true">{initials(p.name)}</span>
        <SyncedField
          className="person-name-input"
          value={p.name}
          aria-label={`Name for ${p.name}`}
          maxLength={120}
          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
          onSave={(v, base) => {
            const n = v.trim();
            if (!n) return false;                         // a blank name is rejected and snaps back
            setMine(n);
            return onRename(p, n, base);
          }}
        />
        <ColorControl value={p.color} onChange={(c) => onColor(p, c)} />
        <button type="button" className="names-archive" title="Archive this name" aria-label={`Archive ${p.name}`} onClick={() => onArchive(p)}>
          <IconArchive size={16} />
        </button>
      </div>
      {conflict && (
        <ConflictNotice
          conflict={conflict}
          field="name"
          mine={mine}
          onKeepMine={(theirs) => onKeepMine(p, mine, theirs)}
          onUseTheirs={() => onDismissConflict(p)}
        />
      )}
    </div>
  );
}

function LinkedRow({ p, isAdmin }) {
  return (
    <div className="person-row person-row-linked">
      <span className="avatar" style={{ background: p.color }} aria-hidden="true">{initials(p.name)}</span>
      <div className="names-linked-main">
        <span className="names-linked-name">{p.name}</span>
        <span className="names-linked-who">
          Linked to <NameLabel user={p.linked} link />
          {p.mine && <span className="acct-tag you">You</span>}
        </span>
      </div>
      {p.mine
        ? <Link href="/settings?tab=names" prefetch={false} className="btn btn-plain btn-xs wi names-linked-act"><IconSettings size={13} /> Change in Settings</Link>
        : isAdmin
          ? <Link href="/admin/people" prefetch={false} className="btn btn-plain btn-xs wi names-linked-act"><IconShield size={13} /> Manage in Admin</Link>
          : null}
    </div>
  );
}

export default function NamesOnTasks({ initial, isAdmin = false }) {
  const router = useRouter();
  const [data, setData] = useServerState(initial);
  const [error, setError] = useState(null);
  const [conflicts, setConflicts] = useState({});           // id -> ConflictError for that row's name
  const [name, setName] = useState('');
  const [kind, setKind] = useState('person');
  const [color, setColor] = useState(PERSON_COLORS[0]);
  const [adding, setAdding] = useState(false);
  const [confirmUI, ask] = useConfirm();
  useRefreshOnFocus(30_000);

  const fail = (e, reload = true) => {
    setError(e?.message || 'Something went wrong — please try again.');
    if (reload) router.refresh();
  };
  const update = (p, patch) => setData((d) => {
    const k = listKey(p.kind);
    return { ...d, [k]: d[k].map((x) => (x.id === p.id ? { ...x, ...patch } : x)) };
  });
  const adopt = (p, row) => {
    if (!row || row.id == null) return;
    const k = listKey(p.kind);
    setData((d) => ({ ...d, [k]: mergeById(d[k], { id: String(row.id), name: row.name ?? p.name, color: row.color ?? p.color }) }));
  };
  const setConflict = (id, c) => setConflicts((m) => {
    const next = { ...m };
    if (c) next[id] = c; else delete next[id];
    return next;
  });

  // Rename: optimistic, base-compared (design §7.4). Resolves to the stored name, which the field adopts.
  async function rename(p, n, base) {
    update(p, { name: n });
    setConflict(p.id, null);
    try {
      const r = rowFrom(await api(`/api/people/${p.id}`, { method: 'PATCH', body: { name: n, base: { name: base } } }));
      adopt(p, r);
      setError(null);
      return r?.name ?? n;
    } catch (e) {
      if (e instanceof ConflictError) {
        if (e.current) update(p, { name: e.current.name ?? p.name });
        setConflict(p.id, e);
        throw e;
      }
      fail(e);
      throw e;
    }
  }
  async function keepMine(p, n, theirs) {
    try { await rename(p, n, theirs); } catch { /* the notice or banner already shows it */ }
  }
  async function recolor(p, c) {
    update(p, { color: c });
    try {
      adopt(p, rowFrom(await api(`/api/people/${p.id}`, { method: 'PATCH', body: { color: c } })));
      setError(null);
    } catch (e) { fail(e); }
  }
  async function archive(p) {
    const ok = await ask({
      title: `Archive “${p.name}”?`,
      lines: [
        'It comes off the owner lists. Tasks already assigned to it keep it.',
        'An admin can restore it later.',
      ],
      confirmLabel: 'Archive',
      danger: true,
    });
    if (!ok) return;
    const k = listKey(p.kind);
    setData((d) => ({ ...d, [k]: d[k].filter((x) => x.id !== p.id) }));
    try {
      await api(`/api/people/${p.id}`, { method: 'DELETE' });
      setError(null);
      router.refresh();
    } catch (e) { fail(e); }
  }
  async function add() {
    const n = name.trim();
    if (!n || adding) return;
    setAdding(true);
    try {
      const r = rowFrom(await api('/api/people', { method: 'POST', body: { name: n, color, kind } }));
      if (r && r.id != null) {
        const row = { id: String(r.id), name: r.name ?? n, color: r.color ?? color, kind, linked: null, mine: false };
        const k = listKey(kind);
        setData((d) => ({ ...d, [k]: [...d[k].filter((x) => x.id !== row.id), row] }));
      }
      setName('');
      setColor(PERSON_COLORS[Math.floor(Math.random() * PERSON_COLORS.length)]);
      setError(null);
      router.refresh();
    } catch (e) { fail(e, false); }
    setAdding(false);
  }

  const sortRows = (rows) => [...rows].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || (Number(a.id) - Number(b.id)));
  const people = sortRows(data.people);
  const groups = sortRows(data.groups);
  const renderRow = (p) => (p.linked
    ? <LinkedRow key={p.id} p={p} isAdmin={isAdmin} />
    : (
      <EditableRow
        key={p.id}
        p={p}
        conflict={conflicts[p.id]}
        onRename={rename}
        onColor={recolor}
        onArchive={archive}
        onKeepMine={keepMine}
        onDismissConflict={(x) => setConflict(x.id, null)}
      />
    ));

  return (
    <div className="names-page">
      <div className="proj-head">
        <h1 className="wi-h"><IconTag size={24} /> Names on tasks</h1>
        <span className="dir-head-spacer" />
        <Link href="/people" prefetch={false} className="btn btn-plain btn-sm wi"><IconUsers size={14} /> People</Link>
      </div>
      <p className="sg-intro names-intro">
        The names and groups tasks can be assigned to. Anyone can add one, rename or recolor it, or archive it.
        Names linked to someone’s account change in that person’s Settings.
      </p>
      {error && (
        <div className="banner names-banner" role="alert">
          <IconAlert size={16} />
          <span>{error}</span>
          <span className="spacer" />
          <button type="button" className="btn btn-plain btn-sm" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <section className="names-card">
        <h2 className="names-h">People</h2>
        {people.map(renderRow)}
        {!people.length && <p className="names-empty">No names yet. Add someone below.</p>}

        <h2 className="names-h names-h-groups">Groups</h2>
        {groups.map(renderRow)}
        {!groups.length && <p className="names-empty">No groups yet.</p>}

        <div className="add-person">
          <label className="add-person-label" htmlFor="names-new">Add a name</label>
          <div className="names-add-line">
            <input
              id="names-new"
              className="field"
              placeholder={kind === 'group' ? 'Group name, e.g. Team Beaver' : 'Full name'}
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            />
            <select className="sg-select names-kind" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Person or group">
              <option value="person">Person</option>
              <option value="group">Group</option>
            </select>
          </div>
          <div className="add-person-color">
            <ColorControl value={color} onChange={setColor} />
            <div className="swatches">
              {PERSON_COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  className={`sw ${normHex(c) === normHex(color) ? 'sel' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  title={c}
                  aria-label={`Color ${c}`}
                  aria-pressed={normHex(c) === normHex(color)}
                />
              ))}
            </div>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ink" onClick={add} disabled={adding || !name.trim()}>
              {adding ? 'Adding…' : kind === 'group' ? 'Add group' : 'Add person'}
            </button>
          </div>
        </div>
      </section>
      {confirmUI}
    </div>
  );
}
