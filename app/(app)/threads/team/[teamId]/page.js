import { redirect } from 'next/navigation';
import { requirePageViewer, tagUpdating } from '@/lib/viewer';
import { teamBoardKey } from '@/lib/queries/suggestions';
import { boardHref } from '@/lib/suggestions';

// /threads/team/[teamId]: team spaces are gone (design-amendments A10.1); an old link goes to the team's office
// board (a team without an office, or a missing team: the CAGE board). The board page decides who reads it.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

const validId = (v) => /^[1-9][0-9]{0,17}$/.test(String(v ?? ''));

export default async function TeamSpacePage({ params }) {
  await requirePageViewer();
  let key = null;
  if (validId(params.teamId)) {
    try {
      key = await teamBoardKey(params.teamId);
    } catch (e) {
      throw tagUpdating(e);
    }
  }
  redirect(boardHref(key || 'company'));
}
