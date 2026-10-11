'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  IconHome, IconCheck, IconFolder, IconList, IconChat, IconTrophy, IconBulb, IconUsers, IconMenu,
  IconSettings, IconKey, IconShield, IconLogOut, IconCaret,
} from '../icons';
import { Headshot } from './Headshot';
import { logout } from './api';

// The sticky 56 px header (design §2.2). Desktop: brand, tabs, user menu. Phone (<= 720 px): hamburger,
// brand, avatar; the tabs move to the bottom bar and the drawer.

// Every main section. `match` decides the active tab; offices and teams live under Projects.
export const TABS = [
  { key: 'home', href: '/', label: 'Home', Icon: IconHome, match: (p) => p === '/' },
  { key: 'my-work', href: '/my-work', label: 'My work', Icon: IconCheck },
  { key: 'projects', href: '/projects', label: 'Projects', Icon: IconFolder, also: ['/offices', '/teams'] },
  { key: 'tasks', href: '/tasks', label: 'All tasks', Icon: IconList },
  { key: 'threads', href: '/threads', label: 'Threads', Icon: IconChat },
  { key: 'culture', href: '/culture', label: 'Culture', Icon: IconTrophy },
  { key: 'suggestions', href: '/suggestions', label: 'Suggestions', Icon: IconBulb },
  { key: 'people', href: '/people', label: 'People', Icon: IconUsers },
];
const under = (pathname, href) => pathname === href || pathname.startsWith(`${href}/`);
export function tabFor(pathname) {
  const p = pathname || '/';
  for (const t of TABS) {
    if (t.match ? t.match(p) : [t.href, ...(t.also || [])].some((h) => under(p, h))) return t.key;
  }
  return null;
}

// Threads unread total from loadNav (null until Release 2 adds it).
export function unreadCount(nav) {
  const u = nav?.unread;
  if (typeof u === 'number') return u;
  if (u && typeof u.total === 'number') return u.total;
  return 0;
}
export const Badge = ({ n, label }) => (n > 0 ? <span className="tab-badge" aria-label={label ? `${n} ${label}` : undefined}>{n > 99 ? '99+' : n}</span> : null);

function UserMenu({ viewer, nav, pathname }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', down);
    document.addEventListener('touchstart', down, { passive: true });
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('touchstart', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const me = { ...viewer, avatar_v: nav?.me?.avatar_v ?? viewer.avatar_v };
  const dept = nav?.me?.department?.name || null;
  const pending = Number(nav?.admin_pending) || 0;
  const close = () => setOpen(false);
  return (
    <div className="user-menu-wrap" ref={wrap}>
      <button
        type="button"
        className="user-chip wi"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title={`Signed in as ${viewer.username}`}
      >
        <Headshot user={me} size={22} />
        <span className="user-chip-name">{viewer.name}</span>
        {dept && <span className="dept-chip">{dept}</span>}
        {viewer.is_admin && pending > 0 && <span className="tab-badge user-chip-badge" aria-label={`${pending} waiting for approval`}>{pending}</span>}
        <IconCaret size={13} className="user-chip-caret" />
      </button>
      {open && (
        <div className="user-menu" role="menu" aria-label="Account">
          <div className="user-menu-head">
            <b>{viewer.name}</b>
            <span>@{viewer.username}{dept ? ` · ${dept}` : ''}</span>
          </div>
          <Link role="menuitem" href="/settings" prefetch={false} onClick={close}><IconSettings size={15} /> Settings</Link>
          <Link role="menuitem" href="/settings?tab=password" prefetch={false} onClick={close}><IconKey size={15} /> Change password</Link>
          {viewer.is_admin && (
            <Link role="menuitem" href="/admin" prefetch={false} onClick={close}>
              <IconShield size={15} /> Admin <Badge n={pending} label="waiting for approval" />
            </Link>
          )}
          <button type="button" role="menuitem" onClick={() => { close(); logout(); }}><IconLogOut size={15} /> Log out</button>
        </div>
      )}
    </div>
  );
}

export default function Header({ viewer, nav, pathname, drawerOpen, onMenu }) {
  const router = useRouter();
  const active = tabFor(pathname);
  const clicks = useRef([]);
  const isAdmin = !!viewer?.is_admin;

  // Hidden Admin entrance (rule 43): five clicks on the brand within 2 s, or opening any page with #accounts.
  // Admins land on /admin; for everyone else it does nothing visible (the brand still goes Home).
  const onLogo = (e) => {
    const now = Date.now();
    clicks.current = [...clicks.current.filter((t) => now - t < 2000), now];
    if (clicks.current.length >= 5) {
      clicks.current = [];
      if (isAdmin) { e.preventDefault(); router.push('/admin'); }
    }
  };
  useEffect(() => {
    const check = () => {
      if (window.location.hash !== '#accounts') return;
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
      if (isAdmin) router.push('/admin');
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, [isAdmin, router]);

  const unread = unreadCount(nav);
  return (
    <header className="app-header shell-header">
      <div className="brand">
        <button
          type="button"
          className="menu-btn btn-ghost"
          onClick={onMenu}
          aria-label={drawerOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={!!drawerOpen}
          aria-controls="tb-drawer"
        >
          <IconMenu size={18} />
        </button>
        <Link href="/" prefetch={false} className="brand-home" onClick={onLogo} title="Home">
          <span className="dot" /> TeamBoard <small>shared project board</small>
        </Link>
      </div>
      <nav className="header-actions header-tabs" aria-label="Main">
        {TABS.map(({ key, href, label, Icon }) => (
          <Link
            key={key}
            href={href}
            prefetch={false}
            className={`btn btn-ghost wi${active === key ? ' tab-on' : ''}`}
            aria-current={active === key ? 'page' : undefined}
          >
            <Icon size={16} /> {label}
            {key === 'threads' && <Badge n={unread} label="unread" />}
          </Link>
        ))}
      </nav>
      <UserMenu viewer={viewer} nav={nav} pathname={pathname} />
    </header>
  );
}
