'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IconHome, IconTrophy, IconGlobe } from '@/app/icons';

// The Culture sub-nav. Active item: same gray with a lime underline (rule 42), like the header tabs.
// Release 3 (K1, K2) adds Challenge (/culture/challenge) and Calendar (/culture/calendar).
const ITEMS = [
  { href: '/culture', label: 'Overview', Icon: IconHome, exact: true },
  { href: '/culture/brackets', label: 'Brackets', Icon: IconTrophy },
  { href: '/culture/geoguessr', label: 'GeoGuessr', Icon: IconGlobe },
];

export default function CultureNav() {
  const p = usePathname() || '';
  const on = (it) => (it.exact ? p === it.href : p === it.href || p.startsWith(`${it.href}/`));
  return (
    <nav className="culture-nav" aria-label="Culture">
      {ITEMS.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          prefetch={false}
          className={`culture-tab${on(it) ? ' on' : ''}`}
          aria-current={on(it) ? 'page' : undefined}
        >
          <it.Icon size={15} /> {it.label}
        </Link>
      ))}
    </nav>
  );
}
