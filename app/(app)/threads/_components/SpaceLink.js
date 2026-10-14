import Link from 'next/link';
import { IconChat } from '@/app/icons';

// "Charlotte space" / "Team Potato space": the header link from an office or team page to its thread space
// (design-amendments A5.6), with the space's unread count. The page passes it only when the viewer can read the
// space. No hooks, so client and server components can render it.
//   <SpaceLink link={{ href: '/threads/office/1', name: 'Charlotte', unread: { announcements, suggestions, chat } }} />
export default function SpaceLink({ link }) {
  if (!link?.href) return null;
  const u = link.unread || {};
  const n = (Number(u.announcements) || 0) + (Number(u.suggestions) || 0) + (Number(u.chat) || 0);
  return (
    <Link href={link.href} prefetch={false} className="btn btn-plain btn-sm wi sp-space-link">
      <IconChat size={15} /> {`${link.name} space`}
      {n > 0 && <span className="tab-badge" aria-label={`${n} unread in ${link.name}`}>{n > 99 ? '99+' : n}</span>}
    </Link>
  );
}
