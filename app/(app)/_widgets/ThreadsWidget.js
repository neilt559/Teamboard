import Link from 'next/link';
import { tagUpdating } from '@/lib/viewer';
import { listSpaces, latestAnnouncements } from '@/lib/queries/spaces';
import { nowFromRequestContext } from '@/lib/clock';
import { IconChat, IconChevronRight } from '@/app/icons';
import { SpaceIcon, spaceUrl } from '../threads/_components/SpaceChrome';
import { excerpt, fmtWhen } from '../threads/_components/when';

// Home dashboard widget 'threads' (design-amendments A5.6): your spaces (CAGE, your offices, your teams) with
// their unread counts, other spaces only while they have something unread, and the latest announcements.
// An async Server Component that loads its own data: <ThreadsWidget viewer={viewer} />.
const MAX_ROWS = 8;

export default async function ThreadsWidget({ viewer, now: givenNow }) {
  if (!viewer) return null;
  let list;
  let latest;
  try {
    [list, latest] = await Promise.all([listSpaces(viewer), latestAnnouncements(viewer, 3)]);
  } catch (e) {
    throw tagUpdating(e);                         // the dashboard's WidgetBoundary shows "This card couldn't load"
  }
  const now = givenNow ?? nowFromRequestContext();
  const unreadOf = (s) => ['announcements', 'suggestions', 'chat'].reduce((n, k) => n + (Number(s.unread?.[k]) || 0), 0);
  // mine: CAGE, your home and extra offices, the teams whose roster you're on.
  const yours = list.spaces.filter((s) => s.scope === 'company' || s.mine);
  const others = list.spaces.filter((s) => !yours.includes(s) && unreadOf(s) > 0);
  const rows = [...yours, ...others].slice(0, MAX_ROWS);
  const hidden = yours.length + others.length - rows.length;
  const total = Number(list.unread_total) || 0;
  return (
    <section className="widget sp-widget" aria-labelledby="w-threads">
      <div className="widget-head">
        <h2 id="w-threads" className="widget-title wi-h">
          <IconChat size={18} /> Threads
          {total > 0 && <span className="tab-badge" aria-label={`${total} unread`}>{total > 99 ? '99+' : total}</span>}
        </h2>
        <Link href="/threads" prefetch={false} className="widget-more">All spaces →</Link>
      </div>
      <ul className="widget-list">
        {rows.map((s) => {
          const n = unreadOf(s);
          const meta = s.scope === 'company' ? 'Everyone at CAGE'
            : s.scope === 'team' ? (s.office_name ? `Team · ${s.office_name}` : 'Team') : 'Office';
          return (
            <li key={s.key} className="wl-item">
              <Link href={spaceUrl(s)} prefetch={false} className={`wl-row sp-wrow${n > 0 ? ' has-unread' : ''}`}>
                <span className="sp-wrow-icon"><SpaceIcon scope={s.scope} size={16} /></span>
                <span className="wl-main">
                  <span className="wl-name">{s.name}</span>
                  <span className="wl-meta">{meta}{s.archived ? ' · archived' : ''}</span>
                </span>
                {n > 0
                  ? <span className="sp-unread" aria-label={`${n} unread`}><span className="sp-dot" aria-hidden="true" />{n > 99 ? '99+' : n}</span>
                  : <IconChevronRight size={15} className="sp-row-go" />}
              </Link>
            </li>
          );
        })}
      </ul>
      {hidden > 0 && <Link href="/threads" prefetch={false} className="widget-foot">{`${hidden} more space${hidden === 1 ? '' : 's'} →`}</Link>}
      {latest.length > 0 && (
        <div className="sp-wlatest">
          <h3 className="sp-wlatest-h">Latest announcements</h3>
          <ul className="sp-wlatest-list">
            {latest.map((a) => (
              <li key={a.id}>
                <Link href={a.space_info?.href || '/threads'} prefetch={false} className="sp-wlatest-row">
                  <span className="sp-wlatest-text">{excerpt(a.body, 110)}</span>
                  <span className="sp-wlatest-meta">{a.space_info?.name} · {a.author?.name || 'Former member'} · {fmtWhen(a.created_at, viewer.tz, now)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
