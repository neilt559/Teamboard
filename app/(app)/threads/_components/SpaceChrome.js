import Link from 'next/link';
import { IconGlobe, IconBuilding, IconUsers, IconChat, IconBulb, IconBell, IconChevronRight, IconArchive } from '@/app/icons';
import Crumbs from '@/app/_ui/Crumbs';

// The parts of the thread pages that need no browser state (design-amendments A5.6): the space list (desktop left
// column, phone list page), the space header with its breadcrumb, and the section tabs. No hooks, so these
// render on the server.

export const SECTION_TABS = [
  { key: 'announcements', label: 'Announcements', short: 'Announcements', Icon: IconBell },
  { key: 'suggestions', label: 'Suggestions', short: 'Suggestions', Icon: IconBulb },
  { key: 'chat', label: 'General chat', short: 'Chat', Icon: IconChat },
];

export function spaceUrl(s, tab = null) {
  const base = s.scope === 'company' ? '/threads/cage'
    : s.scope === 'office' ? `/threads/office/${s.office_id}` : `/threads/team/${s.team_id}`;
  return tab && tab !== 'announcements' ? `${base}?tab=${tab}` : base;
}

export function SpaceIcon({ scope, size = 16 }) {
  if (scope === 'company') return <IconGlobe size={size} />;
  if (scope === 'office') return <IconBuilding size={size} />;
  return <IconUsers size={size} />;
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Unread count shown for a space: the section being opened right now is being marked read, so it shows 0.
export function shownUnread(s, activeKey = null, activeSection = null) {
  const u = s.unread || {};
  let n = 0;
  for (const k of ['announcements', 'suggestions', 'chat']) {
    if (s.key === activeKey && k === activeSection) continue;
    n += Number(u[k]) || 0;
  }
  return n;
}

// Groups for the list (lib/queries/spaces.js listSpaces order): CAGE; your offices, each followed by its teams;
// the other offices with theirs (L4 and admins); last, a roster team in an office you can't open (parent_key null),
// under a plain label with its office's name.
function groupSpaces(spaces) {
  const mineN = spaces.filter((s) => s.scope === 'office' && s.mine).length;
  const groups = {
    company: { key: 'company', title: null, rows: [] },
    mine: { key: 'mine', title: mineN > 1 ? 'Your offices' : 'Your office', rows: [] },
    other: { key: 'other', title: mineN ? 'Other offices' : 'Offices', rows: [] },
  };
  const officeGroup = new Map();
  let lastLabel = null;
  for (const s of spaces) {
    if (s.scope === 'company') { groups.company.rows.push(s); continue; }
    if (s.scope === 'office') {
      const g = s.mine ? groups.mine : groups.other;
      officeGroup.set(s.key, g);
      g.rows.push(s);
      lastLabel = null;
      continue;
    }
    const g = (s.parent_key && officeGroup.get(s.parent_key)) || groups.other;
    if (!s.parent_key) {
      const label = `label:${s.office_id || s.office_name || ''}`;
      if (lastLabel !== label) {
        g.rows.push({ label: true, key: `${label}:${s.key}`, name: s.office_name || 'Another office' });
        lastLabel = label;
      }
    }
    g.rows.push({ ...s, nested: true });
  }
  return [groups.company, groups.mine, groups.other].filter((g) => g.rows.length);
}

export function SpaceList({ spaces, activeKey = null, activeSection = null, className = '' }) {
  const groups = groupSpaces(spaces || []);
  return (
    <nav className={`sp-list${className ? ` ${className}` : ''}`} aria-label="Thread spaces">
      {groups.map((g) => (
        <div key={g.key} className="sp-group">
          {g.title && <h2 className="sp-group-h">{g.title}</h2>}
          <ul className="sp-rows">
            {g.rows.map((s) => {
              if (s.label) {
                return <li key={s.key} className="sp-row-label"><IconBuilding size={14} /> <span>{s.name}</span></li>;
              }
              const n = shownUnread(s, activeKey, activeSection);
              const on = s.key === activeKey;
              return (
                <li key={s.key}>
                  <Link
                    href={spaceUrl(s)}
                    prefetch={false}
                    className={`sp-row sp-row-${s.scope}${s.nested ? ' nested' : ''}${on ? ' on' : ''}${n > 0 ? ' has-unread' : ''}`}
                    aria-current={on ? 'page' : undefined}
                  >
                    <span className="sp-row-icon"><SpaceIcon scope={s.scope} size={s.scope === 'team' ? 15 : 17} /></span>
                    <span className="sp-row-name">{s.name}</span>
                    {s.archived && <span className="sp-tag">Archived</span>}
                    {n > 0 && (
                      <span className="sp-unread" aria-label={`${n} unread`}>
                        <span className="sp-dot" aria-hidden="true" />{n > 99 ? '99+' : n}
                      </span>
                    )}
                    <IconChevronRight size={15} className="sp-row-go" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

// Header of one space: breadcrumb (Threads > Office > Team), name, archived note and a link to the office or
// team page.
export function SpaceHeader({ space, spaces }) {
  const keys = new Set((spaces || []).map((s) => s.key));
  const officeKey = space.scope === 'team' && space.office_id ? `office:${space.office_id}` : null;
  const crumbs = [{ label: 'Threads', href: '/threads' }];
  if (officeKey) {
    crumbs.push({ label: space.office_name || 'Office', href: keys.has(officeKey) ? `/threads/office/${space.office_id}` : null });
  }
  crumbs.push({ label: space.name });
  const page = space.scope === 'office' ? { href: `/offices/${space.office_id}`, label: 'Office page' }
    : space.scope === 'team' ? { href: `/teams/${space.team_id}`, label: 'Team page' } : null;
  return (
    <>
      <div className="sp-crumbs"><Crumbs items={crumbs} /></div>
      <Link href="/threads" prefetch={false} className="sp-back wi"><IconChevronRight size={15} className="sp-back-icon" /> All spaces</Link>
      <div className="proj-head sp-head">
        <h1 className="wi-h">
          <span className={`sp-head-icon sp-head-${space.scope}`}><SpaceIcon scope={space.scope} size={22} /></span>
          <span className="sp-head-name">{space.name}</span>
        </h1>
        {space.scope === 'team' && space.office_name && <span className="sp-head-sub">{space.office_name}</span>}
        {space.scope === 'company' && <span className="sp-head-sub">Everyone at CAGE</span>}
        {space.archived && <span className="sp-tag sp-tag-lg wi"><IconArchive size={13} /> Archived</span>}
        <div className="spacer" />
        {page && <Link href={page.href} prefetch={false} className="btn btn-plain btn-sm wi sp-page-link">{page.label} <IconChevronRight size={14} /></Link>}
      </div>
      {space.archived && (
        <div className="banner setup sp-archived" role="status">
          <IconArchive size={16} />
          <span>{space.can_post ? 'This space is archived. Only admins can post here.' : 'This space is archived. It’s read-only.'}</span>
        </div>
      )}
    </>
  );
}

// Announcements / Suggestions / General chat, each with its unread count (the open one is being read).
export function SpaceTabs({ space, unread, active }) {
  return (
    <nav className="sp-tabs" aria-label="Sections">
      {SECTION_TABS.map(({ key, label, short, Icon }) => {
        const on = key === active;
        const n = on ? 0 : Number(unread?.[key]) || 0;
        return (
          <Link
            key={key}
            href={spaceUrl(space, key)}
            prefetch={false}
            scroll={false}
            className={`sp-tab${on ? ' on' : ''}`}
            aria-current={on ? 'page' : undefined}
            data-tab={key}
          >
            <Icon size={16} />
            <span className="sp-tab-label"><span className="sp-tab-long">{label}</span><span className="sp-tab-short">{short}</span></span>
            {n > 0 && <span className="tab-badge" aria-label={`${n} unread`}>{n > 99 ? '99+' : n}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
