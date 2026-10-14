import Link from 'next/link';
import { tagUpdating } from '@/lib/viewer';
import { loadSpace, listPosts } from '@/lib/queries/spaces';
import { nowFromRequestContext } from '@/lib/clock';
import { IconChat, IconChevronRight, IconBell, IconBulb } from '@/app/icons';
import LatestList from './LatestList';
import { spaceUrl } from './SpaceChrome';

// The office or team space on the office and team pages (design-amendments A5.6): a link into the space with each
// section's unread count, and its latest announcements. Renders nothing when the viewer can't read the space
// (tb_can_read_space, through loadSpace). An async Server Component:
//   <ThreadPreview scope="office" officeId={id} viewer={viewer} />   <ThreadPreview scope="team" teamId={id} viewer={viewer} />
export default async function ThreadPreview({ scope, officeId = null, teamId = null, viewer }) {
  if (!viewer) return null;
  const key = scope === 'office' ? `office:${officeId}` : scope === 'team' ? `team:${teamId}` : null;
  if (!key) return null;
  let sp;
  let page;
  try {
    sp = await loadSpace(viewer, key);
    if (!sp) return null;
    page = await listPosts(viewer, sp, 'announcements', { limit: 3 });
  } catch (e) {
    if (tagUpdating(e)?.digest === 'TB_UPDATING') throw e;
    console.error('[ThreadPreview]', e);
    return null;
  }
  const u = sp.unread || {};
  const items = (page?.posts || []).filter((p) => !p.removed).slice(0, 3)
    .map((p) => ({ ...p, space_info: { key: sp.key, name: sp.name, href: spaceUrl(sp) } }));
  const sections = [
    { tab: 'announcements', label: 'Announcements', Icon: IconBell, n: u.announcements },
    { tab: 'suggestions', label: 'Suggestions', Icon: IconBulb, n: u.suggestions },
    { tab: 'chat', label: 'General chat', Icon: IconChat, n: u.chat },
  ];
  return (
    <section className="office-section office-block sp-preview" aria-labelledby={`sp-prev-${sp.key}`}>
      <div className="section-head">
        <h2 id={`sp-prev-${sp.key}`} className="section-title wi-h"><IconChat size={18} /> {sp.name} space</h2>
        <Link href={spaceUrl(sp)} prefetch={false} className="btn btn-plain btn-sm wi">Open <IconChevronRight size={14} /></Link>
      </div>
      <nav className="sp-preview-tabs" aria-label={`${sp.name} space sections`}>
        {sections.map(({ tab, label, Icon, n }) => (
          <Link key={tab} href={spaceUrl(sp, tab)} prefetch={false} className="sp-preview-tab wi">
            <Icon size={15} /> {label}
            {Number(n) > 0 && <span className="tab-badge" aria-label={`${n} unread in ${label}`}>{n > 99 ? '99+' : n}</span>}
          </Link>
        ))}
      </nav>
      {items.length ? (
        <LatestList items={items} tz={viewer.tz} now={nowFromRequestContext()} max={180} className="sp-latest-compact" />
      ) : (
        <p className="ov-empty sp-preview-empty">No announcements yet.</p>
      )}
    </section>
  );
}
