import Link from 'next/link';
import { tagUpdating } from '@/lib/viewer';
import { listBoards, latestPosts } from '@/lib/queries/suggestions';
import { nowFromRequestContext } from '@/lib/clock';
import { BOARD_LABEL } from '@/lib/suggestions';
import { IconMegaphone, IconGlobe, IconBuilding, IconChevronRight } from '@/app/icons';
import BoardLatest from '../suggestions/BoardLatest';

// Home dashboard widget 'threads' (the stored key; design-amendments A10.4 made it "Suggestions/Announcements"):
// your boards (CAGE and your offices) with their unread counts, other boards only while they have something
// unread, and the newest posts of either kind. An async Server Component that loads its own data:
// <PostsWidget viewer={viewer} />.
const MAX_ROWS = 6;

export default async function PostsWidget({ viewer, now: givenNow }) {
  if (!viewer) return null;
  let list;
  let latest;
  try {
    [list, latest] = await Promise.all([listBoards(viewer), latestPosts(viewer, { limit: 3 })]);
  } catch (e) {
    throw tagUpdating(e);                         // the dashboard's WidgetBoundary shows "This card couldn't load"
  }
  const now = givenNow ?? nowFromRequestContext();
  const yours = list.boards.filter((b) => b.mine);
  const others = list.boards.filter((b) => !b.mine && b.unread > 0);
  const rows = [...yours, ...others].slice(0, MAX_ROWS);
  const hidden = yours.length + others.length - rows.length;
  const total = Number(list.unread_total) || 0;
  return (
    <section className="widget sp-widget" aria-labelledby="w-posts">
      <div className="widget-head">
        <h2 id="w-posts" className="widget-title wi-h">
          <IconMegaphone size={18} /> {BOARD_LABEL}
          {total > 0 && <span className="tab-badge" aria-label={`${total} unread`}>{total > 99 ? '99+' : total}</span>}
        </h2>
        <Link href="/suggestions" prefetch={false} className="widget-more">Open →</Link>
      </div>
      <ul className="widget-list">
        {rows.map((b) => {
          const n = Number(b.unread) || 0;
          return (
            <li key={b.key} className="wl-item">
              <Link href={b.href} prefetch={false} className={`wl-row sp-wrow${n > 0 ? ' has-unread' : ''}`}>
                <span className="sp-wrow-icon">{b.scope === 'company' ? <IconGlobe size={16} /> : <IconBuilding size={16} />}</span>
                <span className="wl-main">
                  <span className="wl-name">{b.name}</span>
                  <span className="wl-meta">{b.scope === 'company' ? 'Everyone at CAGE' : 'Office'}{b.archived ? ' · archived' : ''}</span>
                </span>
                {n > 0
                  ? <span className="sp-unread" aria-label={`${n} unread on ${b.name}`}><span className="sp-dot" aria-hidden="true" />{n > 99 ? '99+' : n}</span>
                  : <IconChevronRight size={15} className="sp-row-go" />}
              </Link>
            </li>
          );
        })}
      </ul>
      {hidden > 0 && <Link href="/suggestions" prefetch={false} className="widget-foot">{`${hidden} more board${hidden === 1 ? '' : 's'} →`}</Link>}
      {latest.length > 0 && (
        <div className="sp-wlatest">
          <h3 className="sp-wlatest-h">Newest posts</h3>
          <BoardLatest items={latest} tz={viewer.tz} now={now} max={110} className="sp-latest-widget" />
        </div>
      )}
    </section>
  );
}
