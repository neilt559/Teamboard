import Link from 'next/link';
import { IconShield, IconCheck, IconKey, IconBuilding, IconUsers } from '@/app/icons';

// Sub-navigation shared by every admin page. Same tab look as the header (rule 42): the current page keeps
// the gray text and gets a lime underline. Scrolls sideways on a phone.
const TABS = [
  { key: 'home', href: '/admin', label: 'Overview', Icon: IconShield },
  { key: 'approvals', href: '/admin/approvals', label: 'Approvals', Icon: IconCheck },
  { key: 'users', href: '/admin/users', label: 'Accounts', Icon: IconKey },
  { key: 'org', href: '/admin/org', label: 'Organization', Icon: IconBuilding },
  { key: 'people', href: '/admin/people', label: 'Names on tasks', Icon: IconUsers },
];

export default function AdminNav({ active, pending = 0 }) {
  return (
    <nav className="admin-nav" aria-label="Admin">
      {TABS.map(({ key, href, label, Icon }) => (
        <Link
          key={key}
          href={href}
          prefetch={false}
          className={`admin-tab${active === key ? ' on' : ''}`}
          aria-current={active === key ? 'page' : undefined}
        >
          <Icon size={15} /> {label}
          {key === 'approvals' && pending > 0 && (
            <span className="tab-badge" aria-label={`${pending} waiting`}>{pending > 99 ? '99+' : pending}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}
