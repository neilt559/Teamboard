'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { IconUsers, IconSearch, IconTag } from '@/app/icons';
import { Headshot } from '@/app/_ui/Headshot';
import NameLabel from '@/app/_ui/NameLabel';
import { useRefreshOnFocus } from '@/app/_ui/useRefresh';
import { DeptTag, whereText } from './parts';

// The company directory (design §2.1 /people): search plus office / department / team / position filters,
// one card per person (photo, name, department tag, approved position, office, team, boss). Filtering is
// local (the whole company is a few hundred rows at most) and mirrored into the URL (?q=&office=&dept=
// &team=&position=), so a filtered view can be shared or linked from a profile tag.
const norm = (s) => String(s || '').toLowerCase();

export default function Directory({ data, initialFilters = {} }) {
  const { people, offices, departments, teams, positions } = data;
  const [q, setQ] = useState(initialFilters.q || '');
  const [office, setOffice] = useState(initialFilters.office || '');
  const [dept, setDept] = useState(initialFilters.dept || '');
  const [team, setTeam] = useState(initialFilters.team || '');
  const [position, setPosition] = useState(initialFilters.position || '');
  useRefreshOnFocus(30_000);

  // Keep the URL in step without a server round trip.
  useEffect(() => {
    const sp = new URLSearchParams();
    if (q.trim()) sp.set('q', q.trim());
    if (office) sp.set('office', office);
    if (dept) sp.set('dept', dept);
    if (team) sp.set('team', team);
    if (position) sp.set('position', position);
    const qs = sp.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      try { window.history.replaceState(null, '', next); } catch { /* ignore */ }
    }
  }, [q, office, dept, team, position]);

  // Teams: only the chosen office's, labelled with the office when all offices are shown (names repeat).
  const teamOptions = useMemo(() => teams.filter((t) => !office || t.office_id === office), [teams, office]);
  useEffect(() => {
    if (team && !teamOptions.some((t) => t.id === team)) setTeam('');
  }, [team, teamOptions]);

  const needle = norm(q.trim());
  const rows = people.filter((p) => {
    if (office && p.office?.id !== office) return false;
    if (dept && p.department?.id !== dept) return false;
    if (team && p.team?.id !== team) return false;
    if (position && p.position?.id !== position) return false;
    if (!needle) return true;
    const hay = [p.name, p.username, p.position?.name, p.department?.name, p.office?.name, p.team?.name, p.boss?.name]
      .map(norm).join(' ');
    return hay.includes(needle);
  });
  const filtered = !!(needle || office || dept || team || position);
  const clear = () => { setQ(''); setOffice(''); setDept(''); setTeam(''); setPosition(''); };

  return (
    <div className="dir-page">
      <div className="proj-head">
        <h1 className="wi-h"><IconUsers size={24} /> People</h1>
        <span className="dir-count">{filtered ? `${rows.length} of ${people.length}` : people.length} {people.length === 1 ? 'person' : 'people'}</span>
        <span className="dir-head-spacer" />
        <Link href="/people/names" prefetch={false} className="btn btn-plain btn-sm wi dir-names-link">
          <IconTag size={14} /> Names on tasks
        </Link>
      </div>

      <div className="dir-tools">
        <label className="sg-search dir-search">
          <IconSearch size={15} />
          <input
            type="search"
            placeholder="Search by name, position, office…"
            aria-label="Search people"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <select className="sg-select" value={office} onChange={(e) => setOffice(e.target.value)} aria-label="Filter by office">
          <option value="">All offices</option>
          {offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select className="sg-select" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Filter by department">
          <option value="">All departments</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select className="sg-select" value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Filter by team">
          <option value="">All teams</option>
          {teamOptions.map((t) => <option key={t.id} value={t.id}>{office ? t.name : `${t.name} · ${t.office_name}`}</option>)}
        </select>
        <select className="sg-select" value={position} onChange={(e) => setPosition(e.target.value)} aria-label="Filter by position">
          <option value="">All positions</option>
          {positions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {filtered && <button type="button" className="btn btn-plain btn-sm dir-clear" onClick={clear}>Clear filters</button>}
      </div>

      {rows.length === 0 ? (
        <div className="sg-empty">{people.length ? 'No one matches these filters.' : 'No one has signed up yet.'}</div>
      ) : (
        <div className="dir-grid">
          {rows.map((p) => {
            const where = whereText(p.office, p.team);
            return (
              <article key={p.id} className="dir-card">
                <Link href={`/people/${p.id}`} prefetch={false} className="dir-photo" tabIndex={-1} aria-hidden="true">
                  <Headshot user={p} size={52} />
                </Link>
                <div className="dir-main">
                  <div className="dir-name"><NameLabel user={p} link /></div>
                  {p.department && <div className="dir-tags"><DeptTag dept={p.department} /></div>}
                  <div className="dir-line dir-pos">{p.position ? p.position.name : <span className="dir-muted">No position yet</span>}</div>
                  {where && <div className="dir-line">{where}</div>}
                  {p.boss && (
                    <div className="dir-line dir-boss">
                      Reports to <Link href={`/people/${p.boss.id}`} prefetch={false}>{p.boss.name}</Link>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
