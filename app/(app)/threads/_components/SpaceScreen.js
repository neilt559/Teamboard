import { notFound } from 'next/navigation';
import { publicViewer, tagUpdating, requirePageViewer } from '@/lib/viewer';
import { loadSpace, listSpaces, listPosts } from '@/lib/queries/spaces';
import { loadSuggestions } from '@/lib/queries/suggestions';
import { nowFromRequestContext } from '@/lib/clock';
import { SpaceList, SpaceHeader, SpaceTabs, SECTION_TABS } from './SpaceChrome';
import MarkRead from './MarkRead';
import AnnouncementsTab from './AnnouncementsTab';
import ChatTab from './ChatTab';
import SuggestionsClient from '../../suggestions/SuggestionsClient';

// One thread space (design-amendments A5.6): /threads/cage, /threads/office/[officeId], /threads/team/[teamId],
// with the tabs Announcements / Suggestions / General chat (?tab=, default announcements). Desktop: the space
// list on the left; phones: the list is /threads and this page links back to it. A space the viewer can't read
// is the same 404 as a missing one (loadSpace answers null for both). Each page.js calls requirePageViewer()
// itself and passes the viewer here. Data: lib/queries/spaces.js (the same loaders as the A5.5 API).

const TABS = SECTION_TABS.map((t) => t.key);
export const tabOf = (searchParams) => (TABS.includes(searchParams?.tab) ? searchParams.tab : 'announcements');

const guard = async (fn) => {
  try {
    return await fn();
  } catch (e) {
    throw tagUpdating(e);
  }
};

// generateMetadata for the three space pages: "Charlotte space", "CAGE space".
export async function spaceMetadata(key) {
  try {
    const viewer = await requirePageViewer();
    const sp = await loadSpace(viewer, key);
    return { title: sp ? `${sp.name} space` : 'Threads' };
  } catch {
    return { title: 'Threads' };                // the page itself redirects or reports the error
  }
}

export default async function SpaceScreen({ viewer, spaceKey, searchParams }) {
  const tab = tabOf(searchParams);
  const space = await guard(() => loadSpace(viewer, spaceKey));
  if (!space) notFound();
  const [list, page, suggestions] = await guard(() => Promise.all([
    listSpaces(viewer),
    tab === 'suggestions' ? null : listPosts(viewer, space, tab, {}),
    tab === 'suggestions' ? loadSuggestions(viewer, space.key) : null,
  ]));
  if (tab === 'suggestions' && !suggestions) notFound();          // lost access in between: the same 404
  const pv = publicViewer(viewer);
  const now = nowFromRequestContext();
  const unread = space.unread || { announcements: 0, suggestions: 0, chat: 0 };
  const initial = page ? { posts: page.posts || [], has_more: !!page.has_more, server_time: page.server_time || null } : null;
  return (
    <div className="sp-wrap">
      <div className="sp-layout">
        <aside className="sp-side" aria-label="Spaces">
          <h2 className="sp-side-h">Spaces</h2>
          <SpaceList spaces={list.spaces} activeKey={space.key} activeSection={tab} />
        </aside>
        <div className={`sp-main sp-main-${tab}`}>
          <SpaceHeader space={space} spaces={list.spaces} />
          <SpaceTabs space={space} unread={unread} active={tab} />
          <MarkRead key={`${space.key}:${tab}`} space={space.key} section={tab} unread={Number(unread[tab]) || 0} />
          {tab === 'announcements' && (
            <AnnouncementsTab
              key={space.key}
              space={space}
              initial={initial}
              unread={Number(unread.announcements) || 0}
              viewer={pv}
              tz={viewer.tz}
              serverNow={now}
            />
          )}
          {tab === 'chat' && (
            <ChatTab
              key={space.key}
              space={space}
              initial={initial}
              unread={Number(unread.chat) || 0}
              viewer={pv}
              tz={viewer.tz}
              serverNow={now}
            />
          )}
          {tab === 'suggestions' && (
            <div className="sp-panel sp-sugg">
              <SuggestionsClient
                key={space.key}
                initial={suggestions}
                tz={viewer.tz}
                space={space.key}
                embedded
                canPost={suggestions?.canPost ?? !!space.can_post}
                intro={space.scope === 'company'
                  ? 'Ideas to make CAGE better. Anyone can post one, +1 the ideas they like, and follow what happens with them.'
                  : `Ideas for ${space.name}. Everyone who can see this space can post one, +1 the ideas they like, and follow what happens with them.`}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
