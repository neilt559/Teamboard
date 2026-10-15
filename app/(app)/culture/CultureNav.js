'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IconHome, IconTrophy, IconGlobe, IconMedal } from '@/app/icons';

// The Culture sub-nav. Active item: same gray with a lime underline (rule 42), like the header tabs.
// Release 3 (K1) adds Challenge (/culture/challenge).
// K1: Challenge opens this month's challenge (/culture/challenge redirects); it stays active on every
// /culture/challenge* page (list, one challenge, new, edit).
// K2's Calendar was taken out of the app (Neil, 2026-10-15: "I don't want the calendar"); its data is kept and its
// pages redirect to /culture.
const ITEMS = [
  { href: '/culture', label: 'Overview', Icon: IconHome, exact: true },
  { href: '/culture/challenge', label: 'Challenge', Icon: IconMedal, prefix: '/culture/challenge' },
  { href: '/culture/brackets', label: 'Brackets', Icon: IconTrophy },
  { href: '/culture/geoguessr', label: 'GeoGuessr', Icon: IconGlobe },
];

export default function CultureNav() {
  const p = usePathname() || '';
  const on = (it) => (it.exact ? p === it.href
    : it.prefix ? p.startsWith(it.prefix)
      : p === it.href || p.startsWith(`${it.href}/`) || (!!it.also && (p === it.also || p.startsWith(`${it.also}/`))));
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
