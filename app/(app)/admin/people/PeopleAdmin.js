'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/app/_ui/api';
import useServerState, { mergeById } from '@/app/_ui/useServerState';
import { useRefreshOnFocus } from '@/app/_ui/useRefresh';
import { useConfirm } from '@/app/_ui/ConfirmDialog';
import { initials } from '@/app/_ui/tasks';
import { IconUsers, IconSearch, IconCheck, IconRestore, IconArchive, IconUser, IconAlert } from '@/app/icons';
import { plural, same, useAct } from '../_parts/kit';

// Admin side of "Names on tasks" (design §2.1, §5.4): link a name to an account directly (the same statements
// as approving a "that's me" request: the account's own empty name is archived, task projects are added),
// unlink, person or group, archive and restore. tasks.assignee_id is never rewritten (rule 11).

const FILTERS = [
  { key: 'all', label: 'All', test: (p) => !p.archived_at },
  { key: 'unlinked', label: 'Not linked', test: (p) => !p.archived_at && p.kind === 'person' && !p.user_id },
  { key: 'linked', label: 'Linked', test: (p) => !p.archived_at && !!p.user_id },
  { key: 'groups', label: 'Groups', test: (p) => !p.archived_at && p.kind === 'group' },
  { key: 'archived', label: 'Archived', test: (p) => !!p.archived_at },
];

const words = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter(Boolean);
const squash = (s) => String(s || '').toLowerCase().split('@')[0].replace(/[^a-z0-9]+/g, '');

// The account that most likely belongs to this name: same display name, or a username/email like
// "khugg" or "kylerhugg" for Kyler Hugg. Only accounts that could take the link (no name of their own with tasks).
function suggestFor(person, users) {
  const t = words(person.name);
  if (t.length < 2) return null;
  const first = t[0], last = t[t.length - 1];
  const score = (u) => {
    if (u.disabled || u.test_account || (u.person_id && u.person_tasks > 0)) return 0;
    const dn = words(u.display_name);
    if (dn.length && dn.join(' ') === t.join(' ')) return 3;
    if (dn.length >= 2 && dn[0] === first && dn[dn.length - 1] === last) return 2;
    for (const s of [squash(u.username), squash(u.email)]) {
      if (!s) continue;
      if (s === first + last || s === first[0] + last) return 2;
      if (s.startsWith(first[0]) && s.endsWith(last) && s.length <= first.length + last.length + 2) return 1;
    }
    return 0;
  };
  let best = null, bestScore = 0, tie = false;
  for (const u of users) {
    const sc = score(u);
    if (sc > bestScore) { best = u; bestScore = sc; tie = false; } else if (sc && sc === bestScore) tie = true;
  }
  return bestScore && !tie ? best : null;
}

function LinkPicker({ person, users, suggestion, busy, onLink, onCancel }) {
  const [uid, setUid] = useState(suggestion?.id || '');
  const sorted = useMemo(() => {
    const list = users.filter((u) => !u.test_account || same(u.id, uid)).slice();
    return list.sort((a, b) => (same(b.id, suggestion?.id) - same(a.id, suggestion?.id))
      || String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }));
  }, [users, suggestion, uid]);
  const chosen = users.find((u) => same(u.id, uid));
  let note = null;
  if (chosen?.person_id && chosen.person_tasks > 0) {
    note = <p className="adm-warn"><IconAlert size={14} /> {chosen.name} already has the name “{chosen.person_name}” with {plural(chosen.person_tasks, 'task')}. Unlink that name first.</p>;
  } else if (chosen?.person_id) {
    note = <p className="adm-hint">{chosen.name}’s own name “{chosen.person_name}” has no tasks; it will be archived.</p>;
  }
  return (
    <div className="adm-inline-panel">
      <label className="atm-label" htmlFor={`link-${person.id}`}>Link “{person.name}” to an account</label>
      <div className="adm-row">
        <select id={`link-${person.id}`} className="field" value={uid} onChange={(e) => setUid(e.target.value)}>
          <option value="">Pick an account…</option>
          {sorted.map((u) => (
            <option key={u.id} value={u.id} disabled={!!(u.person_id && u.person_tasks > 0)}>
              {same(u.id, suggestion?.id) ? 'Suggested: ' : ''}{u.name}{u.name !== u.username ? ` (@${u.username})` : ''}
              {u.disabled ? ' (disabled)' : ''}{u.person_id ? ` · has “${u.person_name}”` : ''}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-ink" disabled={!uid || !!busy || !!(chosen?.person_id && chosen.person_tasks > 0)}
          onClick={() => onLink(uid)}>{busy ? 'Linking…' : 'Link'}</button>
        <button type="button" className="btn btn-plain" disabled={!!busy} onClick={onCancel}>Cancel</button>
      </div>
      {note}
      <p className="adm-hint">Tasks already assigned to “{person.name}” become theirs, and they’re added to those projects.</p>
    </div>
  );
}

export default function PeopleAdmin({ initial }) {
  const router = useRouter();
  useRefreshOnFocus(30_000);
  const [data, setData] = useServerState(initial);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [linking, setLinking] = useState(null);
  const [confirmUI, ask] = useConfirm();
  const { busy, err, msg, setMsg, run } = useAct();

  const act = (key, fn) => run(key, async () => {
    setMsg(null);
    try {
      const r = await fn();
      if (r?.flash) setMsg({ text: r.flash });
    } finally {
      router.refresh();
    }
  });
  const patch = async (p, body) => {
    const r = await api(`/api/people/${p.id}`, { method: 'PATCH', body });
    if (r.row) setData((d) => ({ ...d, people: mergeById(d.people, r.row) }));
    return r;
  };
  const link = (p, uid) => act(`link-${p.id}`, async () => {
    const r = await patch(p, { user_id: uid });
    setLinking(null);
    const u = data.users.find((x) => same(x.id, uid));
    return { flash: `Linked “${p.name}” to ${u ? u.name : 'the account'}${r.projects_added ? `; added ${plural(r.projects_added, 'project')}` : ''}.` };
  });
  const unlink = async (p) => {
    const ok = await ask({
      title: `Unlink “${p.name}” from ${p.user_name}?`,
      lines: ['Its tasks stay on this name. They keep the projects they’re already on.'],
      confirmLabel: 'Unlink', danger: true,
    });
    if (ok) act(`unlink-${p.id}`, async () => { await patch(p, { user_id: null }); return { flash: `Unlinked “${p.name}”.` }; });
  };
  const archive = async (p) => {
    const ok = await ask({
      title: `Archive “${p.name}”?`,
      lines: [
        `It disappears from owner pickers; its ${plural(p.task_count, 'task')} keep this name. You can restore it here.`,
        p.user_id ? `It stays linked to ${p.user_name}.` : '',
      ],
      confirmLabel: 'Archive',
    });
    if (ok) act(`arch-${p.id}`, async () => { await patch(p, { archived: true }); });
  };

  const suggestions = useMemo(() => {
    const out = new Map();
    for (const p of data.people) {
      if (p.archived_at || p.user_id || p.kind !== 'person') continue;
      const s = suggestFor(p, data.users);
      if (s) out.set(String(p.id), s);
    }
    return out;
  }, [data]);

  const f = FILTERS.find((x) => x.key === filter) || FILTERS[0];
  const needle = q.trim().toLowerCase();
  const list = data.people.filter(f.test).filter((p) => !needle
    || [p.name, p.user_name, p.user_username].some((x) => x && String(x).toLowerCase().includes(needle)));

  return (
    <>
      <div className="proj-head">
        <h1 className="wi-h"><IconUsers size={24} /> Names on tasks (admin)</h1>
        <span className="progress-label">Add, rename and recolor names on <Link href="/people/names" prefetch={false}>Names on tasks</Link>.</span>
      </div>
      {confirmUI}
      {err && <div className="bk-err" role="alert">{err}</div>}
      {msg && <div className="adm-flash" role="status"><IconCheck size={14} /> <span>{msg.text}</span></div>}

      {suggestions.size > 0 && (
        <section className="adm-card adm-suggest">
          <div className="adm-card-head"><h2>Suggested links</h2></div>
          <ul className="adm-suggest-list">
            {[...suggestions.entries()].map(([pid, u]) => {
              const p = data.people.find((x) => same(x.id, pid));
              return (
                <li key={pid}>
                  <span className="avatar xs" style={{ background: p.color }}>{initials(p.name)}</span>
                  <b>{p.name}</b> <span className="muted">is probably</span> <b>{u.name}</b>
                  {u.name !== u.username && <span className="muted">@{u.username}</span>}
                  <button type="button" className="btn btn-lime btn-sm" disabled={!!busy} onClick={() => link(p, u.id)}>
                    {busy === `link-${p.id}` ? 'Linking…' : 'Link'}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="adm-toolbar">
        <div className="adm-chips" role="group" aria-label="Show">
          {FILTERS.map((x) => (
            <button key={x.key} type="button" className={`adm-chip${filter === x.key ? ' on' : ''}`} aria-pressed={filter === x.key}
              onClick={() => setFilter(x.key)}>
              {x.label} <span className="adm-chip-n">{data.people.filter(x.test).length}</span>
            </button>
          ))}
        </div>
        <label className="adm-search">
          <IconSearch size={15} />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search names" aria-label="Search names" />
        </label>
      </div>

      {list.length === 0 && <p className="ov-empty">No names here.</p>}
      <div className="adm-rows">
        {list.map((p) => (
          <div key={p.id} className={`adm-row-card${p.archived_at ? ' archived' : ''}`}>
            <span className="avatar" style={{ background: p.color }}>{initials(p.name)}</span>
            <div className="adm-row-main">
              <div className="adm-row-title">
                <b>{p.name}</b>
                {p.kind === 'group' && <span className="acct-tag you">Group</span>}
                {p.archived_at && <span className="acct-tag test">Archived</span>}
              </div>
              <div className="adm-row-meta">
                {p.user_id
                  ? <span className="wi"><IconUser size={12} /> Linked to <b>{p.user_name}</b>{p.user_name !== p.user_username ? ` (@${p.user_username})` : ''}{p.user_disabled ? ' (disabled)' : ''}</span>
                  : p.kind === 'group' ? 'Group (can’t be linked)' : 'Not linked to an account'}
                {' · '}{plural(p.task_count, 'task')}{p.task_count ? ` (${p.open_tasks} open) in ${plural(p.project_count, 'project')}` : ''}
              </div>
              {p.requests.length > 0 && (
                <div className="adm-row-meta">
                  Asked for by {p.requests.map((r) => r.name).join(', ')} · <Link href="/admin/approvals" prefetch={false}>Review in Approvals</Link>
                </div>
              )}
            </div>
            <div className="adm-row-controls">
              {!p.archived_at && p.kind === 'person' && !p.user_id && (
                <button type="button" className="btn btn-ink btn-sm" disabled={!!busy} onClick={() => setLinking(linking === p.id ? null : p.id)}>Link…</button>
              )}
              {p.user_id && <button type="button" className="btn btn-plain btn-sm" disabled={!!busy} onClick={() => unlink(p)}>Unlink</button>}
              {!p.archived_at && !p.user_id && (
                <button type="button" className="btn btn-plain btn-sm" disabled={!!busy}
                  onClick={() => act(`kind-${p.id}`, () => patch(p, { kind: p.kind === 'group' ? 'person' : 'group' }))}>
                  {p.kind === 'group' ? 'Make it a person' : 'Make it a group'}
                </button>
              )}
              {p.archived_at
                ? <button type="button" className="btn btn-plain btn-sm wi" disabled={!!busy} onClick={() => act(`rest-${p.id}`, () => patch(p, { archived: false }))}><IconRestore size={13} /> Restore</button>
                : <button type="button" className="adm-icon-btn" title="Archive" aria-label={`Archive ${p.name}`} disabled={!!busy} onClick={() => archive(p)}><IconArchive size={15} /></button>}
            </div>
            {linking === p.id && (
              <LinkPicker person={p} users={data.users} suggestion={suggestions.get(String(p.id))} busy={busy === `link-${p.id}`}
                onLink={(uid) => link(p, uid)} onCancel={() => setLinking(null)} />
            )}
          </div>
        ))}
      </div>
    </>
  );
}
