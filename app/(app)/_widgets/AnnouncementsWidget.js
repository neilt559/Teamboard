import Link from 'next/link';
import { tagUpdating } from '@/lib/viewer';
import { latestPosts } from '@/lib/queries/suggestions';
import { nowFromRequestContext } from '@/lib/clock';
import { IconMegaphone } from '@/app/icons';
import BoardLatest from '../suggestions/BoardLatest';

// Home dashboard widget 'announcements' (design-amendments A10.4): the newest announcements from every
// Suggestions/Announcements board the viewer can read (CAGE, their offices; tb_can_read_space in
// lib/queries/suggestions.js), each linking to its card on its board. An async Server Component that loads its own
// data: <AnnouncementsWidget viewer={viewer} />.
export default async function AnnouncementsWidget({ viewer, now: givenNow }) {
  if (!viewer) return null;
  let items;
  try {
    items = await latestPosts(viewer, { kind: 'announcement', limit: 5 });
  } catch (e) {
    throw tagUpdating(e);                         // the dashboard's WidgetBoundary shows "This card couldn't load"
  }
  const now = givenNow ?? nowFromRequestContext();
  return (
    <section className="widget sp-widget" aria-labelledby="w-announcements">
      <div className="widget-head">
        <h2 id="w-announcements" className="widget-title wi-h"><IconMegaphone size={18} /> Announcements</h2>
        <Link href="/suggestions" prefetch={false} className="widget-more">All posts →</Link>
      </div>
      {items.length === 0 ? (
        <p className="widget-empty">Nothing announced yet. Post one on <Link href="/suggestions" prefetch={false}>the CAGE board</Link> or your office’s.</p>
      ) : (
        <BoardLatest items={items} tz={viewer.tz} now={now} max={140} showKind={false} className="sp-latest-widget" />
      )}
    </section>
  );
}
