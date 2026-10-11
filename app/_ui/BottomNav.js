'use client';
import Link from 'next/link';
import { TABS, tabFor, unreadCount, Badge } from './Header';

// Phone tab bar (<= 720 px, design §2.2): fixed, 58 px plus the safe-area inset. Active item = lime underline.
// All tasks, Suggestions and People are in the drawer.
const KEYS = ['home', 'my-work', 'projects', 'threads', 'culture'];
const ITEMS = KEYS.map((k) => TABS.find((t) => t.key === k));

export default function BottomNav({ nav, pathname }) {
  const active = tabFor(pathname);
  const unread = unreadCount(nav);
  return (
    <nav className="bottom-nav" aria-label="Main">
      {ITEMS.map(({ key, href, label, Icon }) => (
        <Link
          key={key}
          href={href}
          prefetch={false}
          className={`bn-item${active === key ? ' on' : ''}`}
          aria-current={active === key ? 'page' : undefined}
        >
          <span className="bn-icon"><Icon size={20} />{key === 'threads' && <Badge n={unread} label="unread" />}</span>
          <span className="bn-label">{label}</span>
        </Link>
      ))}
    </nav>
  );
}
