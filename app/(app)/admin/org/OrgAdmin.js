'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/app/_ui/api';
import useServerState, { mergeById } from '@/app/_ui/useServerState';
import { useRefreshOnFocus } from '@/app/_ui/useRefresh';
import { useConfirm } from '@/app/_ui/ConfirmDialog';
import { ColorControl, PERSON_COLORS } from '@/app/_ui/people';
import {
  IconBuilding, IconUsers, IconTag, IconShield, IconArchive, IconRestore, IconTrash, IconChevronUp, IconCaret, IconCheck, IconGlobe,
} from '@/app/icons';
import { plural, same, useAct, DeptTag, InlineText, LEVELS } from '../_parts/kit';
import { TIME_ZONES, DEFAULT_TZ, localTime } from '../_parts/timezones';

// Organization (design §2.1 /admin/org). Replaces the old sidebar prompt()/confirm() office and team tools
// with forms, keeping every confirmation's wording and the two-step deletes (rule 18), and the GeoGuessr
// guard (rules 3-7): an office with scores or 5Ks can only be archived.
// Offices, departments and positions go through admin APIs; teams use /api/teams (B1), which admins pass.

const byPos = (a, b) => (Number(a.position) - Number(b.position)) || (Number(a.id) - Number(b.id));
const bySort = (a, b) => (Number(a.sort) - Number(b.sort)) || (Number(a.id) - Number(b.id));

function Arrows({ onUp, onDown, disabled, label }) {
  return (
    <span className="adm-arrows">
      <button type="button" className="adm-icon-btn" aria-label={`Move ${label} up`} title="Move up" disabled={disabled || !onUp} onClick={onUp}>
        <IconChevronUp size={15} />
      </button>
      <button type="button" className="adm-icon-btn" aria-label={`Move ${label} down`} title="Move down" disabled={disabled || !onDown} onClick={onDown}>
        <IconCaret size={15} />
      </button>
    </span>
  );
}

// ---------------------------------------------------------------- offices

function Offices({ data, setData, act, busy, ask }) {
  const [name, setName] = useState('');
  const [tz, setTz] = useState(DEFAULT_TZ);
  const active = data.offices.filter((o) => !o.archived).sort(byPos);
  const archived = data.offices.filter((o) => o.archived).sort(byPos);
  const zones = (cur) => (cur && !TIME_ZONES.some((z) => z.tz === cur) ? [...TIME_ZONES, { tz: cur, label: cur }] : TIME_ZONES);

  const patch = (o, body, key) => act(key || `office-${o.id}`, async () => {
    const r = await api(`/api/offices/${o.id}`, { method: 'PATCH', body });
    if (r.row) setData((d) => ({ ...d, offices: mergeById(d.offices, r.row) }));
  });
  const move = (o, dir) => act(`move-${o.id}`, async () => {
    const list = active.slice();
    const i = list.findIndex((x) => same(x.id, o.id));
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    const pi = list[j].position, pj = list[i].position;      // optimistic swap, like the old ▲/▼
    setData((d) => ({ ...d, offices: d.offices.map((x) => (same(x.id, list[i].id) ? { ...x, position: pi } : same(x.id, list[j].id) ? { ...x, position: pj } : x)) }));
    await api('/api/offices/reorder', { method: 'POST', body: { ids: list.map((x) => x.id) } });
  });
  const rename = (o, text, base) => {
    if (!text.trim() || text.trim() === o.name) return;
    patch(o, { name: text, base: { name: base } });
  };
  const remove = async (o) => {
    const scores = Number(o.geo_scores) || 0, fivek = Number(o.fivek) || 0;
    if (scores || fivek) {
      const ok = await ask({
        title: `“${o.name}” has GeoGuessr history (${scores} score${scores === 1 ? '' : 's'}, ${fivek} 5Ks), so it can’t be deleted — that data is kept for good.`,
        lines: ['Use the archive button instead to hide it from the sidebar.'],
        confirmLabel: o.archived ? 'OK' : 'Archive it', cancelLabel: 'Close',
      });
      if (ok && !o.archived) patch(o, { archived: true });
      return;
    }
    if (Number(o.people) > 0) {
      const ok = await ask({
        title: `${plural(o.people, 'person has', 'people have')} “${o.name}” as their home office, so it can’t be deleted.`,
        lines: ['Move them to another office on the Accounts page first, or archive the office instead.'],
        confirmLabel: o.archived ? 'OK' : 'Archive it', cancelLabel: 'Close',
      });
      if (ok && !o.archived) patch(o, { archived: true });
      return;
    }
    const teams = Number(o.team_count) || 0;
    const extra = teams ? ` and its ${teams} team${teams > 1 ? 's' : ''} (and everything in them)` : '';
    if (!(await ask({ title: `Delete office “${o.name}”${extra}? This can’t be undone.`, confirmLabel: 'Delete', danger: true }))) return;
    if (!(await ask({ title: `Are you REALLY really sure? “${o.name}” and everything in it will be gone for good.`, confirmLabel: 'Delete for good', danger: true }))) return;
    await act(`del-${o.id}`, async () => {
      setData((d) => ({ ...d, offices: d.offices.filter((x) => !same(x.id, o.id)), teams: d.teams.filter((t) => !same(t.office_id, o.id)) }));
      await api(`/api/offices/${o.id}`, { method: 'DELETE' });
    });
  };
  const add = () => act('add-office', async () => {
    const n = name.trim();
    if (!n) throw new Error('Type the new office’s name first.');
    await api('/api/offices', { method: 'POST', body: { name: n, tz } });
    setName('');
  });

  const row = (o, i, list) => (
    <div key={o.id} className={`adm-row-card${o.archived ? ' archived' : ''}`}>
      <div className="adm-row-main">
        <div className="adm-row-title">
          <IconBuilding size={16} />
          <InlineText value={o.name} label={`${o.name} name`} maxLength={200} onSave={(t, base) => rename(o, t, base)} disabled={!!busy} />
        </div>
        <div className="adm-row-meta">
          {plural(o.active_teams, 'team')}{o.team_count > o.active_teams ? ` (+${o.team_count - o.active_teams} archived)` : ''}
          {' · '}{plural(o.people, 'person', 'people')}{o.extra_people ? ` (+${o.extra_people} extra)` : ''}
          {' · '}{plural(o.project_count, 'project')}
          {o.geo_on && <> · <span className="wi"><IconGlobe size={12} /> GeoGuessr: {plural(o.geo_scores, 'score')}, {o.fivek} 5Ks</span></>}
        </div>
      </div>
      <div className="adm-row-controls">
        <label className="adm-tz">
          <span className="sr-only">Time zone for {o.name}</span>
          <select className="field" value={o.tz || DEFAULT_TZ} disabled={!!busy}
            onChange={(e) => patch(o, { tz: e.target.value }, `tz-${o.id}`)}>
            {zones(o.tz).map((z) => <option key={z.tz} value={z.tz}>{z.label}</option>)}
          </select>
          <span className="muted adm-time">{localTime(o.tz)}</span>
        </label>
        {!o.archived && (
          <Arrows label={o.name} disabled={!!busy} onUp={i > 0 ? () => move(o, -1) : null} onDown={i < list.length - 1 ? () => move(o, 1) : null} />
        )}
        <button type="button" className="adm-icon-btn" title={o.archived ? 'Restore' : 'Archive'} aria-label={`${o.archived ? 'Restore' : 'Archive'} ${o.name}`}
          disabled={!!busy} onClick={() => patch(o, { archived: !o.archived })}>
          {o.archived ? <IconRestore size={15} /> : <IconArchive size={15} />}
        </button>
        <button type="button" className="adm-icon-btn danger" title="Delete" aria-label={`Delete ${o.name}`} disabled={!!busy} onClick={() => remove(o)}>
          <IconTrash size={15} />
        </button>
      </div>
    </div>
  );

  return (
    <section className="adm-card adm-section" id="offices">
      <div className="adm-card-head"><h2 className="wi"><IconBuilding size={18} /> Offices</h2></div>
      <p className="adm-hint">Office names, teams and people are visible to everyone. Order here is the order everywhere, GeoGuessr included.</p>
      <div className="adm-rows">{active.map(row)}</div>
      {archived.length > 0 && (
        <>
          <h3 className="adm-subhead">Archived</h3>
          <div className="adm-rows">{archived.map(row)}</div>
        </>
      )}
      <div className="adm-add">
        <input className="field" value={name} maxLength={200} placeholder="New office name" aria-label="New office name"
          onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
        <select className="field" value={tz} onChange={(e) => setTz(e.target.value)} aria-label="Time zone">
          {TIME_ZONES.map((z) => <option key={z.tz} value={z.tz}>{z.label}</option>)}
        </select>
        <button type="button" className="btn btn-ink" disabled={!!busy} onClick={add}>{busy === 'add-office' ? 'Adding…' : 'Add office'}</button>
      </div>
      <p className="adm-hint">New offices don’t join GeoGuessr; GeoGuessr’s own “Add office” does that.</p>
    </section>
  );
}

// ---------------------------------------------------------------- teams (all offices)

function Teams({ data, setData, act, busy, ask }) {
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState({});
  const offices = [...data.offices.filter((o) => !o.archived).sort(byPos), ...data.offices.filter((o) => o.archived).sort(byPos)];
  const activeOffices = data.offices.filter((o) => !o.archived).sort(byPos);

  const patch = (t, body, key) => act(key || `team-${t.id}`, async () => {
    setData((d) => ({ ...d, teams: d.teams.map((x) => (same(x.id, t.id) ? { ...x, ...Object.fromEntries(Object.entries(body).filter(([k]) => k !== 'base')) } : x)) }));
    const r = await api(`/api/teams/${t.id}`, { method: 'PATCH', body });
    // A move clears the team of members who don't work in the new office (design §4.3).
    const n = Number(r?.team_cleared) || 0;
    if (n > 0) {
      const to = data.offices.find((o) => same(o.id, body.office_id))?.name || 'the new office';
      return { flash: `${t.name} moved. ${n} ${n === 1 ? 'member doesn’t' : 'members don’t'} work in ${to}, so their team was cleared.` };
    }
    return null;
  });
  const move = (t, list, dir) => act(`tmove-${t.id}`, async () => {
    const order = list.slice();
    const i = order.findIndex((x) => same(x.id, t.id));
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    const pi = order[j].position, pj = order[i].position;
    setData((d) => ({ ...d, teams: d.teams.map((x) => (same(x.id, order[i].id) ? { ...x, position: pi } : same(x.id, order[j].id) ? { ...x, position: pj } : x)) }));
    await api('/api/teams/reorder', { method: 'POST', body: { office_id: t.office_id, ids: order.map((x) => x.id) } });
  });
  const remove = async (t) => {
    const n = Number(t.project_count) || 0;
    const extra = n ? ` and its ${n} project${n > 1 ? 's' : ''} (and all their tasks)` : '';
    if (!(await ask({ title: `Delete team “${t.name}”${extra}? This can’t be undone.`, confirmLabel: 'Delete', danger: true }))) return;
    if (!(await ask({ title: `Are you REALLY really sure? “${t.name}” and everything in it will be gone for good.`, confirmLabel: 'Delete for good', danger: true }))) return;
    await act(`tdel-${t.id}`, async () => {
      setData((d) => ({ ...d, teams: d.teams.filter((x) => !same(x.id, t.id)) }));
      await api(`/api/teams/${t.id}`, { method: 'DELETE' });
    });
  };
  const grant = async (t) => {
    const ok = await ask({
      title: `Give everyone who picked “${t.name}” all ${plural(t.project_count, 'project')} of the team?`,
      lines: [`${plural(t.members, 'person', 'people')} who chose this team in their profile become members of each of the team’s projects (archived ones too). Nobody is removed. People on the roster already get the team’s projects.`],
      confirmLabel: 'Give access',
    });
    if (!ok) return;
    await act(`grant-${t.id}`, async () => {
      const r = await api(`/api/admin/teams/${t.id}/grant-projects`, { method: 'POST' });
      return { flash: r.added ? `Added ${plural(r.added, 'membership')} for ${plural(r.people, 'person', 'people')} on “${t.name}”.` : `Everyone who picked “${t.name}” already had all of its projects.` };
    });
  };
  const add = (o) => act(`tadd-${o.id}`, async () => {
    const n = (adding[o.id] || '').trim();
    if (!n) throw new Error('Type the new team’s name first.');
    await api('/api/teams', { method: 'POST', body: { name: n, office_id: o.id } });
    setAdding((a) => ({ ...a, [o.id]: '' }));
  });

  return (
    <section className="adm-card adm-section" id="teams">
      <div className="adm-card-head">
        <h2 className="wi"><IconUsers size={18} /> Teams</h2>
        <label className="adm-check"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived teams</label>
      </div>
      {offices.map((o) => {
        const all = data.teams.filter((t) => same(t.office_id, o.id)).sort(byPos);
        const activeTeams = all.filter((t) => !t.archived);
        const shown = showArchived ? all : activeTeams;
        if (o.archived && !shown.length) return null;
        return (
          <div key={o.id} className="adm-group">
            <h3 className="adm-subhead">{o.name}{o.archived ? ' (archived office)' : ''}</h3>
            {!shown.length && <p className="ov-empty">No teams yet.</p>}
            <div className="adm-rows">
              {shown.map((t) => {
                const i = activeTeams.findIndex((x) => same(x.id, t.id));
                return (
                  <div key={t.id} className={`adm-row-card${t.archived ? ' archived' : ''}`}>
                    <div className="adm-row-main">
                      <div className="adm-row-title">
                        <IconUsers size={15} />
                        <InlineText value={t.name} label={`${t.name} name`} maxLength={200} disabled={!!busy}
                          onSave={(text, base) => { if (text.trim() && text.trim() !== t.name) patch(t, { name: text, base: { name: base } }); }} />
                      </div>
                      <div className="adm-row-meta">
                        {plural(t.active_projects, 'project')}{t.project_count > t.active_projects ? ` (+${t.project_count - t.active_projects} archived)` : ''}
                        {' · '}<Link href={`/teams/${t.id}#roster`} prefetch={false} className="adm-roster-link">{plural(t.roster || 0, 'person', 'people')} on the roster{t.roster_pms ? ` (${plural(t.roster_pms, 'PM')})` : ''}</Link>
                        {' · '}{plural(t.members, 'person', 'people')} picked it in their profile
                      </div>
                    </div>
                    <div className="adm-row-controls">
                      <select className="field adm-move" value={t.office_id || ''} disabled={!!busy} aria-label={`Office for ${t.name}`}
                        onChange={(e) => e.target.value && patch(t, { office_id: e.target.value }, `tmv-${t.id}`)}>
                        {!activeOffices.some((x) => same(x.id, t.office_id)) && <option value={t.office_id || ''}>{o.name} (archived)</option>}
                        {activeOffices.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </select>
                      {!t.archived && (
                        <Arrows label={t.name} disabled={!!busy}
                          onUp={i > 0 ? () => move(t, activeTeams, -1) : null}
                          onDown={i >= 0 && i < activeTeams.length - 1 ? () => move(t, activeTeams, 1) : null} />
                      )}
                      <button type="button" className="btn btn-plain btn-sm" disabled={!!busy || !t.members || !t.project_count} onClick={() => grant(t)}
                        title="Give everyone who picked this team in their profile all of its projects">
                        {busy === `grant-${t.id}` ? 'Adding…' : 'Give profile picks its projects'}
                      </button>
                      <button type="button" className="adm-icon-btn" title={t.archived ? 'Restore' : 'Archive'} aria-label={`${t.archived ? 'Restore' : 'Archive'} ${t.name}`}
                        disabled={!!busy} onClick={() => patch(t, { archived: !t.archived })}>
                        {t.archived ? <IconRestore size={15} /> : <IconArchive size={15} />}
                      </button>
                      <button type="button" className="adm-icon-btn danger" title="Delete" aria-label={`Delete ${t.name}`} disabled={!!busy} onClick={() => remove(t)}>
                        <IconTrash size={15} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {!o.archived && (
              <div className="adm-add">
                <input className="field" value={adding[o.id] || ''} maxLength={200} placeholder={`New team in ${o.name}`} aria-label={`New team in ${o.name}`}
                  onChange={(e) => setAdding((a) => ({ ...a, [o.id]: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') add(o); }} />
                <button type="button" className="btn btn-plain" disabled={!!busy} onClick={() => add(o)}>{busy === `tadd-${o.id}` ? 'Adding…' : 'Add team'}</button>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

// ---------------------------------------------------------------- departments and positions (sort + archive)

function makeReorder(act, setData, listKey, path) {
  return (list, item, dir) => act(`sort-${item.id}`, async () => {
    const order = list.slice();
    const i = order.findIndex((x) => same(x.id, item.id));
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    const changes = order.map((x, k) => ({ x, sort: (k + 1) * 10 })).filter(({ x, sort }) => Number(x.sort) !== sort);
    setData((d) => ({ ...d, [listKey]: d[listKey].map((r) => { const c = changes.find((y) => same(y.x.id, r.id)); return c ? { ...r, sort: c.sort } : r; }) }));
    for (const c of changes) await api(`${path}/${c.x.id}`, { method: 'PATCH', body: { sort: c.sort } });
  });
}

function Departments({ data, setData, act, busy, ask }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(PERSON_COLORS[2]);
  const active = data.departments.filter((d) => !d.archived).sort(bySort);
  const archived = data.departments.filter((d) => d.archived).sort(bySort);
  const reorder = makeReorder(act, setData, 'departments', '/api/admin/departments');
  const patch = (d, body) => act(`dept-${d.id}`, async () => {
    const r = await api(`/api/admin/departments/${d.id}`, { method: 'PATCH', body });
    if (r.row) setData((x) => ({ ...x, departments: mergeById(x.departments, r.row) }));
  });
  const archive = async (d) => {
    if (!d.archived && d.members > 0) {
      const ok = await ask({
        title: `Archive “${d.name}”?`,
        lines: [`The ${plural(d.members, 'person', 'people')} in it keep the tag, but nobody can pick it any more.`],
        confirmLabel: 'Archive',
      });
      if (!ok) return;
    }
    patch(d, { archived: !d.archived });
  };
  const add = () => act('add-dept', async () => {
    const n = name.trim();
    if (!n) throw new Error('Type the new department’s name first.');
    await api('/api/admin/departments', { method: 'POST', body: { name: n, color } });
    setName('');
  });
  const row = (d, i, list) => (
    <div key={d.id} className={`adm-row-card${d.archived ? ' archived' : ''}`}>
      <div className="adm-row-main">
        <div className="adm-row-title">
          <DeptTag name={d.name} color={d.color} />
          <InlineText value={d.name} label={`${d.name} name`} maxLength={80} disabled={!!busy}
            onSave={(t) => { if (t.trim() && t.trim() !== d.name) patch(d, { name: t }); }} />
        </div>
        <div className="adm-row-meta">{plural(d.members, 'person', 'people')}</div>
      </div>
      <div className="adm-row-controls">
        <ColorControl value={d.color} onChange={(c) => patch(d, { color: c })} />
        {!d.archived && <Arrows label={d.name} disabled={!!busy} onUp={i > 0 ? () => reorder(list, d, -1) : null} onDown={i < list.length - 1 ? () => reorder(list, d, 1) : null} />}
        <button type="button" className="adm-icon-btn" title={d.archived ? 'Restore' : 'Archive'} aria-label={`${d.archived ? 'Restore' : 'Archive'} ${d.name}`}
          disabled={!!busy} onClick={() => archive(d)}>
          {d.archived ? <IconRestore size={15} /> : <IconArchive size={15} />}
        </button>
      </div>
    </div>
  );
  return (
    <section className="adm-card adm-section" id="departments">
      <div className="adm-card-head"><h2 className="wi"><IconTag size={18} /> Departments</h2></div>
      <p className="adm-hint">Shown as a colored tag next to people’s names. Departments are never deleted, only archived.</p>
      <div className="adm-rows">{active.map(row)}</div>
      {archived.length > 0 && <><h3 className="adm-subhead">Archived</h3><div className="adm-rows">{archived.map(row)}</div></>}
      <div className="adm-add">
        <input className="field" value={name} maxLength={80} placeholder="New department" aria-label="New department name"
          onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
        <ColorControl value={color} onChange={setColor} />
        <DeptTag name={name.trim() || 'Preview'} color={color} />
        <button type="button" className="btn btn-ink" disabled={!!busy} onClick={add}>{busy === 'add-dept' ? 'Adding…' : 'Add department'}</button>
      </div>
    </section>
  );
}

function Positions({ data, setData, act, busy, ask }) {
  const [name, setName] = useState('');
  const [level, setLevel] = useState('1');
  const active = data.positions.filter((p) => !p.archived).sort(bySort);
  const archived = data.positions.filter((p) => p.archived).sort(bySort);
  const reorder = makeReorder(act, setData, 'positions', '/api/admin/positions');
  const patch = (p, body) => act(`pos-${p.id}`, async () => {
    const r = await api(`/api/admin/positions/${p.id}`, { method: 'PATCH', body });
    if (r.row) setData((x) => ({ ...x, positions: mergeById(x.positions, r.row) }));
  });
  const relevel = async (p, lvl) => {
    if (Number(lvl) === Number(p.level)) return;
    if (p.holders > 0) {
      const ok = await ask({
        title: `Change “${p.name}” to level ${lvl}?`,
        lines: [`The ${plural(p.holders, 'person', 'people')} approved as ${p.name} would at once: ${LEVELS[lvl].toLowerCase()}.`],
        confirmLabel: 'Change level',
        danger: Number(lvl) > Number(p.level),
      });
      if (!ok) return;
    }
    patch(p, { level: Number(lvl) });
  };
  const archive = async (p) => {
    if (!p.archived && (p.holders > 0 || p.pending > 0)) {
      const ok = await ask({
        title: `Archive “${p.name}”?`,
        lines: [`The ${plural(p.holders + p.pending, 'person', 'people')} who hold or asked for it keep it, but nobody can pick it any more.`],
        confirmLabel: 'Archive',
      });
      if (!ok) return;
    }
    patch(p, { archived: !p.archived });
  };
  const add = () => act('add-pos', async () => {
    const n = name.trim();
    if (!n) throw new Error('Type the new position’s name first.');
    await api('/api/admin/positions', { method: 'POST', body: { name: n, level: Number(level) } });
    setName('');
  });
  const row = (p, i, list) => (
    <div key={p.id} className={`adm-row-card${p.archived ? ' archived' : ''}`}>
      <div className="adm-row-main">
        <div className="adm-row-title">
          <IconShield size={15} />
          <InlineText value={p.name} label={`${p.name} name`} maxLength={80} disabled={!!busy}
            onSave={(t) => { if (t.trim() && t.trim() !== p.name) patch(p, { name: t }); }} />
        </div>
        <div className="adm-row-meta">{plural(p.holders, 'person', 'people')} approved{p.pending ? ` · ${p.pending} asking` : ''}</div>
      </div>
      <div className="adm-row-controls">
        <select className="field adm-level" value={String(p.level)} disabled={!!busy} aria-label={`Level for ${p.name}`}
          onChange={(e) => relevel(p, e.target.value)}>
          {[1, 2, 3, 4].map((l) => <option key={l} value={l}>{l} · {LEVELS[l]}</option>)}
        </select>
        {!p.archived && <Arrows label={p.name} disabled={!!busy} onUp={i > 0 ? () => reorder(list, p, -1) : null} onDown={i < list.length - 1 ? () => reorder(list, p, 1) : null} />}
        <button type="button" className="adm-icon-btn" title={p.archived ? 'Restore' : 'Archive'} aria-label={`${p.archived ? 'Restore' : 'Archive'} ${p.name}`}
          disabled={!!busy} onClick={() => archive(p)}>
          {p.archived ? <IconRestore size={15} /> : <IconArchive size={15} />}
        </button>
      </div>
    </div>
  );
  return (
    <section className="adm-card adm-section" id="positions">
      <div className="adm-card-head"><h2 className="wi"><IconShield size={18} /> Positions</h2></div>
      <p className="adm-hint">
        A position’s level decides what the people approved for it see. Picking a level-1 position applies at once;
        anything higher waits for an admin. Positions are never deleted, only archived.
      </p>
      <div className="adm-rows">{active.map(row)}</div>
      {archived.length > 0 && <><h3 className="adm-subhead">Archived</h3><div className="adm-rows">{archived.map(row)}</div></>}
      <div className="adm-add">
        <input className="field" value={name} maxLength={80} placeholder="New position" aria-label="New position name"
          onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
        <select className="field adm-level" value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Level">
          {[1, 2, 3, 4].map((l) => <option key={l} value={l}>{l} · {LEVELS[l]}</option>)}
        </select>
        <button type="button" className="btn btn-ink" disabled={!!busy} onClick={add}>{busy === 'add-pos' ? 'Adding…' : 'Add position'}</button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- page

export default function OrgAdmin({ initial }) {
  const router = useRouter();
  useRefreshOnFocus(30_000);
  const [data, setData] = useServerState(initial);
  const [confirmUI, ask] = useConfirm();
  const { busy, err, msg, setMsg, run } = useAct();
  // Every change: optimistic where it's simple, then a server refresh (counts, order, new ids).
  const act = (key, fn) => run(key, async () => {
    setMsg(null);
    try {
      const r = await fn();
      if (r?.flash) setMsg({ text: r.flash });
    } finally {
      router.refresh();
    }
  });
  const props = { data, setData, act, busy, ask };
  return (
    <>
      <div className="proj-head">
        <h1 className="wi-h"><IconBuilding size={24} /> Organization</h1>
        <nav className="adm-jump" aria-label="Sections">
          <a href="#offices">Offices</a><a href="#teams">Teams</a><a href="#departments">Departments</a><a href="#positions">Positions</a>
        </nav>
      </div>
      {confirmUI}
      {err && <div className="bk-err adm-sticky-msg" role="alert">{err}</div>}
      {msg && <div className="adm-flash adm-sticky-msg" role="status"><IconCheck size={14} /> <span>{msg.text}</span></div>}
      <Offices {...props} />
      <Teams {...props} />
      <Departments {...props} />
      <Positions {...props} />
    </>
  );
}
