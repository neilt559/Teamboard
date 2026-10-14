'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { IconCaret, IconPin, IconArchive, IconChevronRight } from '../icons';
import { projectTitle } from '@/lib/projects';

// Left navigation (design §2.2): pinned projects, the "My offices" tree (home, extra and followed offices ->
// active teams -> visible projects with open counts), "All projects", "Archived". Navigation only: adding,
// renaming, archiving and deleting moved to the office, team and project pages. Everything here comes from
// lib/queries/nav.js loadNav(), which only returns what the viewer may see.
// The tree is shared with the phone drawer (Drawer.js renders <NavTree>).

const WIDTH_KEY = 'tb_sidebar_w';
const TREE_KEY = 'tb_tree_collapsed';
const MIN_W = 180;
const MAX_W = 600;
const DEFAULT_W = 250;

const same = (a, b) => a != null && b != null && String(a) === String(b);
const under = (pathname, href) => pathname === href || pathname.startsWith(`${href}/`);

function readCollapsed() {
  try {
    const v = JSON.parse(localStorage.getItem(TREE_KEY) || 'null');
    return { o: Array.isArray(v?.o) ? v.o.map(String) : [], t: Array.isArray(v?.t) ? v.t.map(String) : [] };
  } catch {
    return { o: [], t: [] };
  }
}

// Collapsed offices and teams, remembered on this device.
function useCollapsed() {
  const [c, setC] = useState({ o: [], t: [] });
  useEffect(() => { setC(readCollapsed()); }, []);
  const toggle = useCallback((kind, id) => {
    setC((cur) => {
      const key = String(id);
      const list = cur[kind].includes(key) ? cur[kind].filter((x) => x !== key) : [...cur[kind], key];
      const next = { ...cur, [kind]: list };
      try { localStorage.setItem(TREE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);
  return [c, toggle];
}

function Caret({ collapsed, onClick, label }) {
  return (
    <button type="button" className="team-caret tree-caret" onClick={onClick} aria-expanded={!collapsed} aria-label={label}>
      <IconCaret size={14} className={collapsed ? 'caret-collapsed' : undefined} />
    </button>
  );
}

function ProjectRow({ p, pathname, onNavigate, pin = false }) {
  const href = `/projects/${p.id}`;
  return (
    <Link
      href={href}
      prefetch={false}
      className={`proj${under(pathname, href) ? ' active' : ''}${p.archived ? ' proj-archived' : ''}`}
      aria-current={pathname === href ? 'page' : undefined}
      onClick={onNavigate}
      title={projectTitle(p)}
    >
      {pin && <IconPin size={13} className="proj-pin" />}
      <span className="name">{projectTitle(p)}</span>
      {p.archived ? <span className="count">archived</span> : <span className="count">{p.open_count}</span>}
    </Link>
  );
}

export function NavTree({ nav, pathname, onNavigate }) {
  const [collapsed, toggle] = useCollapsed();
  const offices = nav?.offices || [];
  const teams = nav?.teams || [];
  const projects = nav?.projects || [];
  const officeById = new Map(offices.map((o) => [String(o.id), o]));
  const treeOffices = (nav?.tree_office_ids || []).map((id) => officeById.get(String(id))).filter(Boolean);
  const projectById = new Map(projects.map((p) => [String(p.id), p]));
  const pinned = (nav?.pinned || []).map((id) => projectById.get(String(id))).filter(Boolean);

  return (
    <div className="nav-tree">
      {pinned.length > 0 && (
        <section className="nav-section" aria-label="Pinned projects">
          <h2 className="nav-h">Pinned</h2>
          {pinned.map((p) => <ProjectRow key={p.id} p={p} pathname={pathname} onNavigate={onNavigate} pin />)}
        </section>
      )}

      <section className="nav-section" aria-label="My offices">
        <h2 className="nav-h">My offices</h2>
        {treeOffices.length === 0 && (
          <p className="team-empty nav-empty">No offices here yet. <Link href="/offices" prefetch={false} onClick={onNavigate}>Browse offices</Link> to follow one.</p>
        )}
        {treeOffices.map((office) => {
          const oCollapsed = collapsed.o.includes(String(office.id));
          const officeHref = `/offices/${office.id}`;
          const officeTeams = teams.filter((t) => same(t.office_id, office.id));
          return (
            <div key={office.id} className="office">
              <div className={`office-head${pathname === officeHref ? ' viewing' : ''}`}>
                <Caret collapsed={oCollapsed} onClick={() => toggle('o', office.id)} label={`${oCollapsed ? 'Expand' : 'Collapse'} ${office.name}`} />
                <Link
                  href={officeHref}
                  prefetch={false}
                  className="office-name"
                  aria-current={pathname === officeHref ? 'page' : undefined}
                  onClick={onNavigate}
                  title={office.followed && !office.mine ? `${office.name} (following)` : office.name}
                >
                  {office.name}
                </Link>
                {office.followed && !office.mine && <span className="nav-follow">Following</span>}
              </div>
              {!oCollapsed && (
                <div className="office-teams">
                  {officeTeams.map((team) => {
                    const tCollapsed = collapsed.t.includes(String(team.id));
                    const teamHref = `/teams/${team.id}`;
                    const teamProjects = projects.filter((p) => same(p.team_id, team.id) && !p.archived);
                    return (
                      <div key={team.id} className="team">
                        <div className={`team-head${pathname === teamHref ? ' viewing' : ''}`}>
                          <Caret collapsed={tCollapsed} onClick={() => toggle('t', team.id)} label={`${tCollapsed ? 'Expand' : 'Collapse'} ${team.name}`} />
                          <Link
                            href={teamHref}
                            prefetch={false}
                            className="team-name"
                            aria-current={pathname === teamHref ? 'page' : undefined}
                            onClick={onNavigate}
                            title={team.name}
                          >
                            {team.name}
                          </Link>
                        </div>
                        {!tCollapsed && teamProjects.map((p) => <ProjectRow key={p.id} p={p} pathname={pathname} onNavigate={onNavigate} />)}
                        {!tCollapsed && teamProjects.length === 0 && <p className="team-empty">No projects to show.</p>}
                      </div>
                    );
                  })}
                  {officeTeams.length === 0 && <p className="team-empty">No teams yet.</p>}
                </div>
              )}
            </div>
          );
        })}
      </section>

      <div className="nav-section nav-more">
        <Link href="/projects" prefetch={false} className="side-link" onClick={onNavigate}>All projects <IconChevronRight size={14} /></Link>
        <Link href="/offices" prefetch={false} className="side-link" onClick={onNavigate}>All offices <IconChevronRight size={14} /></Link>
        <Link href="/reports" prefetch={false} className="side-link" onClick={onNavigate}>Weekly reports <IconChevronRight size={14} /></Link>
        {nav?.archived_count > 0 && (
          <Link href="/projects?archived=1" prefetch={false} className="archived-toggle side-archived" onClick={onNavigate}>
            <IconArchive size={14} /> Archived ({nav.archived_count})
          </Link>
        )}
      </div>
    </div>
  );
}

// Desktop sidebar: sticky, scrolls on its own, resizable 180-600 px (width remembered in tb_sidebar_w).
// Hidden at 720 px and below, where the drawer takes over.
export default function Sidebar({ nav, pathname }) {
  const [width, setWidth] = useState(DEFAULT_W);
  const widthRef = useRef(DEFAULT_W);
  widthRef.current = width;

  useEffect(() => {
    let saved = NaN;
    try { saved = Number(localStorage.getItem(WIDTH_KEY)); } catch {}
    if (saved >= MIN_W && saved <= MAX_W) setWidth(saved);
  }, []);

  const startResize = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = widthRef.current;
    const onMove = (ev) => setWidth(Math.min(MAX_W, Math.max(MIN_W, startW + (ev.clientX - startX))));
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      try { localStorage.setItem(WIDTH_KEY, String(Math.round(widthRef.current))); } catch {}
    };
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="shell-side" style={{ width, flex: `0 0 ${width}px` }}>
      <aside className="sidebar" aria-label="Offices and projects">
        <NavTree nav={nav} pathname={pathname} />
      </aside>
      <div className="sidebar-resizer" onMouseDown={startResize} title="Drag to resize" aria-hidden="true" />
    </div>
  );
}
