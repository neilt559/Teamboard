'use client';
import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { IconList, IconUsers, IconSettings, IconShield, IconLogOut } from '../icons';
import { NavTree } from './Sidebar';
import { Badge } from './Header';
import { logout } from './api';

// Phone slide-in menu (<= 720 px, design §2.2): backdrop, and never wider than min(86vw, 360px) whatever the
// saved desktop sidebar width. Holds the office tree plus All tasks, People, Settings, Admin and Log out (Threads,
// with its unread badge, is in the bottom bar; suggestions live in the thread spaces since Release 2). Closes on
// the backdrop, Escape, or any link.
const under = (pathname, href) => pathname === href || pathname.startsWith(`${href}/`);

function Item({ href, Icon, label, pathname, onClose, children }) {
  const on = under(pathname, href);
  return (
    <Link href={href} prefetch={false} className={`drawer-link${on ? ' on' : ''}`} aria-current={on ? 'page' : undefined} onClick={onClose}>
      <Icon size={17} /> <span>{label}</span>{children}
    </Link>
  );
}

export default function Drawer({ open, onClose, viewer, nav, pathname }) {
  const panel = useRef(null);
  useEffect(() => {
    if (!open) {
      // Closed (often by tapping a link inside): don't leave focus in a hidden panel.
      if (panel.current && panel.current.contains(document.activeElement)) document.activeElement.blur();
      return undefined;
    }
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', key);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const pending = Number(nav?.admin_pending) || 0;
  return (
    <div className={`drawer${open ? ' open' : ''}`} aria-hidden={!open}>
      <div className="drawer-backdrop" onClick={onClose} />
      <nav className="drawer-panel" id="tb-drawer" aria-label="Menu" ref={panel}>
        <div className="drawer-links">
          <Item href="/tasks" Icon={IconList} label="All tasks" pathname={pathname} onClose={onClose} />
          <Item href="/people" Icon={IconUsers} label="People" pathname={pathname} onClose={onClose} />
        </div>
        <NavTree nav={nav} pathname={pathname} onNavigate={onClose} />
        <div className="drawer-links drawer-account">
          <Item href="/settings" Icon={IconSettings} label="Settings" pathname={pathname} onClose={onClose} />
          {viewer?.is_admin && (
            <Item href="/admin" Icon={IconShield} label="Admin" pathname={pathname} onClose={onClose}>
              <Badge n={pending} label="waiting for approval" />
            </Item>
          )}
          <button type="button" className="drawer-link" onClick={() => { onClose(); logout(); }}>
            <IconLogOut size={17} /> <span>Log out</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
