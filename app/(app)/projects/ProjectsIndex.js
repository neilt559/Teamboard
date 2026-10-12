'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { IconFolder, IconSearch, IconPin, IconChevronRight, IconArchive } from '@/app/icons';
import { byName } from '@/app/_ui/tasks';
import { api } from '@/app/_ui/api';
import { useRefreshOnFocus } from '@/app/_ui/useRefresh';
import { withDefaults, MAX_PINNED } from '@/lib/prefs';
import { ErrorBanner, FilterToggle } from '../tasks/task-list-ui';
import '../tasks/lists.css';

// /projects (design §2.1): every project the viewer can see, from lib/queries/projects-list.js (already
// permission-filtered, so filtering here in the browser can't show anything new). Search, Office -> Team
// filter, tabs Mine / My offices / All I can see, pin toggles (users.prefs.pinned_project_ids through
// PATCH /api/prefs; pins only change what is shown), "Show archived" (?archived=1, a server reload), and an
// "All tasks" link. The search, tab and filters live in the URL (?q=&tab=&office=&team=), so Back and a shared
// link come back to the same view.

const TABS = [
  { key: 'mine', label: 'Mine', hint: 'Projects you’re on, own tasks in, or that belong to your team.' },
  { key: 'offices', label: 'My offices', hint: 'Projects you can see in your offices and the offices you follow.' },
  { key: 'all', label: 'All I can see', hint: 'Every project you have access to.' },
];
const PAGE = 200;
const same = (a, b) => a != null && b != null && String(a) === String(b);
const byPosition = (a, b) => (a.position - b.position) || (Number(a.id) - Number(b.id));
const isArchivedRow = (p) => p.archived || p.team_archived || p.office_archived;

function urlFor({ q, tab, office, team, archived }) {
  const sp = new URLSearchParams();
  if (q) sp.set('q', q);
  if (tab) sp.set('tab', tab);
  if (office && office !== 'all') sp.set('office', office);
  if (team && team !== 'all') sp.set('team', team);
  if (archived) sp.set('archived', '1');
  const s = sp.toString();
  return s ? `/projects?${s}` : '/projects';
}

function ProjectRow({ p, pinned, onPin, pinBusy }) {
  const pct = p.total_count ? Math.round((p.done_count / p.total_count) * 100) : 0;
  const archived = isArchivedRow(p);
  return (
    <li className={`lt-prow${archived ? ' is-archived' : ''}`}>
      <button
        type="button"
        className={`lt-pin${pinned ? ' on' : ''}`}
        aria-pressed={pinned}
        aria-label={pinned ? `Unpin ${p.name}` : `Pin ${p.name}`}
        title={pinned ? 'Unpin from the sidebar' : 'Pin to the sidebar'}
        disabled={pinBusy}
        onClick={() => onPin(p)}
      >
        <IconPin size={16} />
      </button>
      <div className="lt-prow-main">
        <Link href={`/projects/${p.id}`} prefetch={false} className="lt-prow-name">{p.name || 'Untitled project'}</Link>
        <div className="lt-prow-where">
          {p.office_archived ? <span>{p.office_name}</span> : <Link href={`/offices/${p.office_id}`} prefetch={false}>{p.office_name}</Link>}
          <IconChevronRight size={11} />
          {p.team_archived ? <span>{p.team_name}</span> : <Link href={`/teams/${p.team_id}`} prefetch={false}>{p.team_name}</Link>}
          {p.archived && <span className="lt-chip">Archived</span>}
          {!p.archived && p.team_archived && <span className="lt-chip">Team archived</span>}
          {!p.archived && !p.team_archived && p.office_archived && <span className="lt-chip">Office archived</span>}
        </div>
      </div>
      <div className="lt-prow-stats">
        <span className="lt-stat"><b>{p.open_count}</b> open</span>
        {p.my_open > 0 && <span className="lt-stat lt-stat-mine"><b>{p.my_open}</b> mine</span>}
        <span className="lt-prog" title={`${pct}% done`}>
          <span className="lt-progress"><span style={{ width: `${pct}%` }} /></span>
          <span className="progress-label">{p.done_count}/{p.total_count} done</span>
        </span>
      </div>
    </li>
  );
}

export default function ProjectsIndex({ data, viewer, initial, archived }) {
  const router = useRouter();
  useRefreshOnFocus(30_000);
  const all = data.projects || [];
  const prefs = withDefaults(viewer?.prefs, { isAdmin: !!viewer?.is_admin });

  // ---- pins (optimistic; requests go one after another so the last toggle always wins) ----
  const [pins, setPins] = useState(() => prefs.pinned_project_ids.map(String));
  const pinsRef = useRef(pins);
  const inFlight = useRef(0);
  const serverPins = prefs.pinned_project_ids.join(',');
  const serverPinsRef = useRef(serverPins);
  serverPinsRef.current = serverPins;
  // Adopt the saved pins after a refresh, unless a save is still on its way (it refreshes again when done).
  useEffect(() => {
    if (inFlight.current > 0) return;
    const next = serverPins ? serverPins.split(',') : [];
    pinsRef.current = next;
    setPins(next);
  }, [serverPins]);
  const chain = useRef(Promise.resolve());
  const [error, setError] = useState(null);
  const togglePin = useCallback((p) => {
    const id = String(p.id);
    const cur = pinsRef.current;
    const on = cur.includes(id);
    if (!on && cur.length >= MAX_PINNED) {
      setError(`You can pin up to ${MAX_PINNED} projects. Unpin one first.`);
      return;
    }
    const next = on ? cur.filter((x) => x !== id) : [...cur, id];
    pinsRef.current = next;
    setPins(next);
    setError(null);
    inFlight.current += 1;
    chain.current = chain.current.then(async () => {
      try {
        await api('/api/prefs', { method: 'PATCH', body: { pinned_project_ids: pinsRef.current } });
      } catch (e) {
        setError(e?.message || 'Couldn’t save your pins — please try again.');
        // Back to the last saved pins.
        const saved = serverPinsRef.current ? serverPinsRef.current.split(',') : [];
        pinsRef.current = saved;
        setPins(saved);
      } finally {
        inFlight.current -= 1;
        // The sidebar's Pinned section comes from the layout; on an error this also puts the saved pins back.
        if (inFlight.current === 0) router.refresh();
      }
    });
  }, [router]);
  const pinSet = useMemo(() => new Set(pins), [pins]);

  // ---- my offices: home + extra offices, then followed ones (the sidebar's "My offices") ----
  const myOffices = useMemo(() => new Set([...(viewer?.office_ids || []).map(String), ...prefs.followed_office_ids.map(String)]),
    [viewer?.office_ids, prefs.followed_office_ids.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- filters (URL-backed: read from the live URL, so Back to a filtered view restores it) ----
  const sp = useSearchParams();
  const fromUrl = (k, dflt) => { const v = sp?.get(k); return typeof v === 'string' && v ? v : (initial?.[k] || dflt); };
  const [q, setQ] = useState(() => fromUrl('q', '').slice(0, 200));
  const [office, setOffice] = useState(() => fromUrl('office', 'all'));
  const [team, setTeam] = useState(() => fromUrl('team', 'all'));
  const activeRows = all.filter((p) => !isArchivedRow(p));
  const counts = {
    mine: activeRows.filter((p) => p.mine).length,
    offices: activeRows.filter((p) => myOffices.has(String(p.office_id))).length,
    all: activeRows.length,
  };
  const defaultTab = counts.mine ? 'mine' : counts.offices ? 'offices' : 'all';
  const [tab, setTab] = useState(() => { const t = fromUrl('tab', null); return TABS.some((x) => x.key === t) ? t : null; });
  const tabNow = tab || defaultTab;

  const officeChoices = useMemo(() => {
    const m = new Map();
    for (const p of all) if (!m.has(String(p.office_id))) m.set(String(p.office_id), { id: String(p.office_id), name: p.office_name, position: p.office_position });
    return [...m.values()].sort(byPosition);
  }, [all]);
  const officeNow = office !== 'all' && officeChoices.some((o) => same(o.id, office)) ? office : 'all';
  const teamChoices = useMemo(() => {
    const m = new Map();
    for (const p of all) {
      if (officeNow !== 'all' && !same(p.office_id, officeNow)) continue;
      if (!m.has(String(p.team_id))) m.set(String(p.team_id), { id: String(p.team_id), name: p.team_name });
    }
    return [...m.values()].sort(byName);
  }, [all, officeNow]);
  const teamNow = team !== 'all' && teamChoices.some((t) => same(t.id, team)) ? team : 'all';

  // Keep the URL in step without a server round trip (Next 14.2 syncs history.replaceState with the router).
  useEffect(() => {
    const href = urlFor({ q: q.trim(), tab, office: officeNow, team: teamNow, archived });
    if (typeof window !== 'undefined' && window.location.pathname + window.location.search !== href) {
      window.history.replaceState(null, '', href);
    }
  }, [q, tab, officeNow, teamNow, archived]);

  const needle = q.trim().toLowerCase();
  // Search, office and team narrow both lists; the tab (Mine / My offices / All) only narrows the active list.
  // The archived section is the way back to every archived project you can see (the old Archived drawer, rules
  // 13-14), so the sidebar's "Archived (N)" link must land on all N whichever tab is the default.
  const matchesFilters = (p) => {
    if (officeNow !== 'all' && !same(p.office_id, officeNow)) return false;
    if (teamNow !== 'all' && !same(p.team_id, teamNow)) return false;
    if (needle && !`${p.name} ${p.team_name} ${p.office_name}`.toLowerCase().includes(needle)) return false;
    return true;
  };
  const matches = (p) => {
    if (tabNow === 'mine' && !p.mine) return false;
    if (tabNow === 'offices' && !myOffices.has(String(p.office_id))) return false;
    return matchesFilters(p);
  };
  const rows = activeRows.filter(matches);
  const archivedRows = archived ? all.filter((p) => isArchivedRow(p)).filter(matchesFilters) : [];
  const filtering = !!needle || officeNow !== 'all' || teamNow !== 'all';
  const clear = () => { setQ(''); setOffice('all'); setTeam('all'); };

  const [showFilters, setShowFilters] = useState(false);
  // Long lists draw in batches; a new tab, search or filter starts again from the first one.
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => { setLimit(PAGE); }, [tabNow, needle, officeNow, teamNow]);
  const toggleArchived = (on) => {
    router.replace(urlFor({ q: q.trim(), tab, office: officeNow, team: teamNow, archived: on }), { scroll: false });
  };

  const tabInfo = TABS.find((t) => t.key === tabNow);

  return (
    <div className="lt-page">
      <div className="proj-head">
        <h1 className="wi-h"><IconFolder size={24} /> Projects</h1>
        <span className="progress-label" aria-live="polite">
          {rows.length} project{rows.length !== 1 ? 's' : ''}{filtering ? (rows.length === 1 ? ' matches' : ' match') : ''}
          {archived ? ` · ${archivedRows.length} archived` : ''}
        </span>
        <span className="spacer" />
        <Link href="/tasks" prefetch={false} className="lt-head-link">All tasks <IconChevronRight size={14} /></Link>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      <div className="lt-tabs" role="tablist" aria-label="Which projects">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tabNow === t.key}
            className={`lt-tab${tabNow === t.key ? ' on' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label} <span className="lt-tab-n">{counts[t.key]}</span>
          </button>
        ))}
      </div>
      <p className="lt-tab-hint">{tabInfo.hint}</p>

      <div className={`filters lt-filters${showFilters ? ' open' : ''}`}>
        <label className="filter-search">
          <IconSearch size={15} />
          <input placeholder="Search projects" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" maxLength={200} />
        </label>
        <FilterToggle open={showFilters} onToggle={() => setShowFilters((v) => !v)} count={(officeNow !== 'all') + (teamNow !== 'all') + (archived ? 1 : 0)} />
        <label>Office
          <select value={officeNow} onChange={(e) => { setOffice(e.target.value); setTeam('all'); }}>
            <option value="all">All offices</option>
            {officeChoices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <label>Team
          <select value={teamNow} onChange={(e) => setTeam(e.target.value)}>
            <option value="all">All teams</option>
            {teamChoices.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="lt-check">
          <input type="checkbox" checked={!!archived} onChange={(e) => toggleArchived(e.target.checked)} />
          Show archived
        </label>
        {filtering && <button type="button" className="btn btn-plain btn-sm filters-clear" onClick={clear}>Clear filters</button>}
      </div>

      {archived && archivedRows.length > 0 && (
        <p className="lt-archived-note">
          <IconArchive size={14} /> <a href="#archived-projects">{archivedRows.length} archived project{archivedRows.length !== 1 ? 's' : ''}</a> below the active ones.
        </p>
      )}

      {rows.length > 0 ? (
        <>
          <ul className="lt-plist" aria-label="Projects">
            {rows.slice(0, limit).map((p) => <ProjectRow key={p.id} p={p} pinned={pinSet.has(String(p.id))} onPin={togglePin} />)}
          </ul>
          {rows.length > limit && (
            <div className="lt-more">
              <button type="button" className="btn btn-plain" onClick={() => setLimit((n) => n + PAGE)}>
                Show {Math.min(PAGE, rows.length - limit)} more
              </button>
              <span className="muted">Showing {limit} of {rows.length}</span>
            </div>
          )}
        </>
      ) : (
        <div className="empty lt-empty">
          {all.length === 0 ? (
            <>
              <h3>No projects to show yet</h3>
              <p>Projects you’re added to show up here. Anyone on a project can add you to it.</p>
            </>
          ) : filtering ? (
            <>
              <h3>No projects match</h3>
              <p>Try another search, or clear the filters.</p>
              <button type="button" className="btn btn-plain" onClick={clear}>Clear filters</button>
            </>
          ) : tabNow === 'offices' && myOffices.size === 0 ? (
            <>
              <h3>No offices yet</h3>
              <p>Pick your office in Settings, or follow an office from the Offices page.</p>
              <Link href="/offices" prefetch={false} className="btn btn-plain">Browse offices</Link>
            </>
          ) : (
            <>
              <h3>Nothing here</h3>
              <p>{tabNow === 'mine' ? 'You aren’t on any active projects yet.' : 'No active projects you can see in your offices.'}</p>
              <button type="button" className="btn btn-plain" onClick={() => setTab('all')}>Show all I can see</button>
            </>
          )}
        </div>
      )}

      {archived && (
        <section className="lt-archived" id="archived-projects" aria-label="Archived projects">
          <h2 className="lt-section-h"><IconArchive size={16} /> Archived ({archivedRows.length})</h2>
          {archivedRows.length > 0 ? (
            <ul className="lt-plist">
              {archivedRows.map((p) => <ProjectRow key={p.id} p={p} pinned={pinSet.has(String(p.id))} onPin={togglePin} />)}
            </ul>
          ) : (
            <p className="muted lt-none">No archived projects{filtering ? ' match' : ''}.</p>
          )}
        </section>
      )}
    </div>
  );
}
