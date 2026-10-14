import Link from 'next/link';
import { tagUpdating } from '@/lib/viewer';
import { latestAnnouncements } from '@/lib/queries/spaces';
import { nowFromRequestContext } from '@/lib/clock';
import { IconBell } from '@/app/icons';
import LatestList from '../threads/_components/LatestList';

// Home dashboard widget 'announcements' (design-amendments A5.6): the newest announcements from every space the
// viewer can read (CAGE, their office, their teams; tb_can_read_space in lib/queries/spaces.js), each linking into
// its space. An async Server Component that loads its own data: <AnnouncementsWidget viewer={viewer} />.
export default async function AnnouncementsWidget({ viewer, now: givenNow }) {
  if (!viewer) return null;
  let items;
  try {
    items = await latestAnnouncements(viewer, 5);
  } catch (e) {
    throw tagUpdating(e);                         // the dashboard's WidgetBoundary shows "This card couldn't load"
  }
  const now = givenNow ?? nowFromRequestContext();
  return (
    <section className="widget sp-widget" aria-labelledby="w-announcements">
      <div className="widget-head">
        <h2 id="w-announcements" className="widget-title wi-h"><IconBell size={18} /> Announcements</h2>
        <Link href="/threads" prefetch={false} className="widget-more">Threads →</Link>
      </div>
      {items.length === 0 ? (
        <p className="widget-empty">Nothing announced yet. Post one in <Link href="/threads/cage" prefetch={false}>CAGE</Link> or your office’s space.</p>
      ) : (
        <LatestList items={items} tz={viewer.tz} now={now} max={140} className="sp-latest-widget" />
      )}
    </section>
  );
}
