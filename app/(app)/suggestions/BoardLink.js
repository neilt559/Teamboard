import Link from 'next/link';
import { IconMegaphone } from '@/app/icons';
import { BOARD_LABEL } from '@/lib/suggestions';

// The office page's header link to that office's Suggestions/Announcements board (design-amendments A10.4), with
// its unread count. The page passes it only when the viewer can read the board. No hooks: client or server.
//   <BoardLink link={{ href: '/suggestions/office/1', name: 'Charlotte', unread: 3 }} />
export default function BoardLink({ link }) {
  if (!link?.href) return null;
  const n = Number(link.unread) || 0;
  return (
    <Link href={link.href} prefetch={false} className="btn btn-plain btn-sm wi sp-space-link" title={`${link.name} ${BOARD_LABEL}`}>
      <IconMegaphone size={15} /> {BOARD_LABEL}
      {n > 0 && <span className="tab-badge" aria-label={`${n} unread`}>{n > 99 ? '99+' : n}</span>}
    </Link>
  );
}
