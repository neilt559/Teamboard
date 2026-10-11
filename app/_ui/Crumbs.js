import { Fragment } from 'react';
import Link from 'next/link';
import { IconChevronRight } from '../icons';

// "Offices › Lisle › Land Dev › 230021 - Randall Commons". Every step but the last is a link; a step the
// viewer can't open (no href) renders as plain text, and missing steps (null) are skipped.
//   <Crumbs items={[{ label: 'Offices', href: '/offices' }, { label: office.name, href: `/offices/${office.id}` }, { label: team.name }]} />
export default function Crumbs({ items }) {
  const list = (items || []).filter(Boolean);
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {list.map((it, i) => (
        <Fragment key={i}>
          {i > 0 && <IconChevronRight size={13} />}
          {i === list.length - 1
            ? <span aria-current="page">{it.label}</span>
            : it.href
              ? <Link href={it.href} prefetch={false}>{it.label}</Link>
              : <span>{it.label}</span>}
        </Fragment>
      ))}
    </nav>
  );
}
