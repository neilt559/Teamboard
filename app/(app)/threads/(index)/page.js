import { requirePageViewer, tagUpdating } from '@/lib/viewer';
import { listSpaces, latestAnnouncements } from '@/lib/queries/spaces';
import { nowFromRequestContext } from '@/lib/clock';
import { IconChat, IconBell } from '@/app/icons';
import { SpaceList } from '../_components/SpaceChrome';
import LatestList from '../_components/LatestList';
import RefreshOnFocus from '../_components/RefreshOnFocus';

// /threads (design-amendments A5.6): every space the viewer can read, CAGE first, then their offices with their
// teams indented (L4 and admins: the other offices too), each with its unread count. Desktop: the list on the
// left and the latest announcements beside it; phones: the list is the page, the announcements follow.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Threads' };

export default async function ThreadsPage() {
  const viewer = await requirePageViewer();
  let list;
  let latest;
  try {
    [list, latest] = await Promise.all([listSpaces(viewer), latestAnnouncements(viewer, 8)]);
  } catch (e) {
    throw tagUpdating(e);
  }
  const now = nowFromRequestContext();
  const total = Number(list.unread_total) || 0;
  return (
    <div className="sp-wrap sp-index">
      <RefreshOnFocus />
      <div className="proj-head sp-index-head">
        <h1 className="wi-h"><IconChat size={24} /> Threads</h1>
        <span className="sp-head-sub">{total > 0 ? `${total} unread` : 'All caught up'}</span>
      </div>
      <p className="sp-index-intro">
        Every space has announcements, suggestions and a general chat. CAGE is for everyone; your office and your teams have their own.
      </p>
      <div className="sp-layout">
        <aside className="sp-side sp-side-index" aria-label="Spaces">
          <h2 className="sp-side-h">Spaces</h2>
          <SpaceList spaces={list.spaces} />
        </aside>
        <section className="sp-main sp-overview" aria-labelledby="sp-latest-h">
          <h2 id="sp-latest-h" className="sp-overview-h wi-h"><IconBell size={18} /> Latest announcements</h2>
          {latest.length === 0 ? (
            <div className="sp-empty">
              <IconBell size={22} />
              <b>No announcements yet</b>
              <span>Open a space and post the first one.</span>
            </div>
          ) : (
            <LatestList items={latest} tz={viewer.tz} now={now} max={220} />
          )}
        </section>
      </div>
    </div>
  );
}
