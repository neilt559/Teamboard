import Link from 'next/link';
import { IconGlobe, IconBuilding } from '@/app/icons';

// The board switcher at the top of the Suggestions/Announcements pages (design-amendments A10.1): "CAGE", then the
// viewer's offices, then (Directors and up, admins) every other office, each with its unread count. Only boards
// the viewer can read are passed in (lib/queries/suggestions.js listBoards). No hooks: server or client.
//   <BoardSwitcher boards={[{ key, scope, name, href, mine, archived, unread }]} active="office:1" />
export default function BoardSwitcher({ boards, active }) {
  const list = boards || [];
  const firstOther = list.findIndex((b) => b.scope === 'office' && !b.mine);
  return (
    <nav className="sgb-switch" aria-label="Boards">
      {list.map((b, i) => {
        const on = b.key === active;
        const n = on ? 0 : Number(b.unread) || 0;
        return (
          <span key={b.key} className="sgb-switch-item">
            {i === firstOther && i > 0 && <span className="sgb-switch-sep" aria-hidden="true" />}
            <Link
              href={b.href}
              prefetch={false}
              className={`sgb-pill${on ? ' on' : ''}${b.mine ? ' mine' : ''}`}
              aria-current={on ? 'page' : undefined}
              aria-label={n > 0 ? `${b.name}, ${n} unread` : undefined}
            >
              {b.scope === 'company' ? <IconGlobe size={15} /> : <IconBuilding size={15} />}
              <span>{b.name}</span>
              {b.archived && <span className="sgb-tag">Archived</span>}
              {n > 0 && <span className="tab-badge" aria-hidden="true">{n > 99 ? '99+' : n}</span>}
            </Link>
          </span>
        );
      })}
    </nav>
  );
}
