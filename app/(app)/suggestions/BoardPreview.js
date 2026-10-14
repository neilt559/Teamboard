import Link from 'next/link';
import { tagUpdating } from '@/lib/viewer';
import { latestPosts } from '@/lib/queries/suggestions';
import { nowFromRequestContext } from '@/lib/clock';
import { boardHref } from '@/lib/suggestions';
import { IconMegaphone, IconChevronRight } from '@/app/icons';
import BoardLatest from './BoardLatest';

// An office's Suggestions/Announcements board on its office page (design-amendments A10.4): the newest posts, each
// linking to its card on the board, and an Open link. The page renders it only for viewers who can read the board
// (latestPosts filters with tb_can_read_space as well). An async Server Component:
//   <BoardPreview officeId={id} name="Charlotte" viewer={viewer} />
export default async function BoardPreview({ officeId, name, viewer }) {
  if (!viewer || officeId == null) return null;
  const key = `office:${officeId}`;
  let items;
  try {
    items = await latestPosts(viewer, { board: key, limit: 3 });
  } catch (e) {
    if (tagUpdating(e)?.digest === 'TB_UPDATING') throw e;
    console.error('[BoardPreview]', e);
    return null;
  }
  return (
    <section className="office-section office-block sp-preview" aria-labelledby={`sgb-prev-${officeId}`}>
      <div className="section-head">
        <h2 id={`sgb-prev-${officeId}`} className="section-title wi-h"><IconMegaphone size={18} /> {name} suggestions &amp; announcements</h2>
        <Link href={boardHref(key)} prefetch={false} className="btn btn-plain btn-sm wi">Open <IconChevronRight size={14} /></Link>
      </div>
      {items.length ? (
        <BoardLatest items={items} tz={viewer.tz} now={nowFromRequestContext()} max={180} compact />
      ) : (
        <p className="ov-empty sp-preview-empty">Nothing posted yet.</p>
      )}
    </section>
  );
}
