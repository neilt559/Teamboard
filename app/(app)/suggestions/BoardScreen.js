import { notFound } from 'next/navigation';
import { tagUpdating, requirePageViewer } from '@/lib/viewer';
import { loadBoard, listBoards } from '@/lib/queries/suggestions';
import { nowFromRequestContext } from '@/lib/clock';
import { BOARD_LABEL } from '@/lib/suggestions';
import MarkBoardRead from './MarkBoardRead';
import SuggestionsClient from './SuggestionsClient';

// One Suggestions/Announcements board (design-amendments A10): /suggestions (CAGE) and /suggestions/office/[id].
// One feed per board: the composer posts a Suggestion or an Announcement; recent announcements sit on top. A
// board the viewer can't read is the same 404 as a missing one (loadBoard answers null for both). Each page.js
// calls requirePageViewer() itself and passes the viewer here. Data: lib/queries/suggestions.js, the same loaders
// as GET /api/suggestions?space=.

const guard = async (fn) => {
  try {
    return await fn();
  } catch (e) {
    throw tagUpdating(e);
  }
};

// generateMetadata for the board pages: "Suggestions/Announcements" (CAGE), "Charlotte · Suggestions/Announcements".
export async function boardMetadata(key) {
  try {
    const viewer = await requirePageViewer();
    const data = await loadBoard(viewer, key);
    if (!data || data.board.scope === 'company') return { title: BOARD_LABEL };
    return { title: `${data.board.name} · ${BOARD_LABEL}` };
  } catch {
    return { title: BOARD_LABEL };              // the page itself redirects or reports the error
  }
}

export default async function BoardScreen({ viewer, boardKey }) {
  const data = await guard(() => loadBoard(viewer, boardKey));
  if (!data) notFound();
  const list = await guard(() => listBoards(viewer));
  const current = list.boards.find((b) => b.key === data.board.key);
  return (
    <>
      <MarkBoardRead board={data.board.key} unread={Number(current?.unread) || 0} />
      <SuggestionsClient
        key={data.board.key}
        initial={data}
        boards={list.boards}
        tz={viewer.tz}
        now={nowFromRequestContext()}
      />
    </>
  );
}
