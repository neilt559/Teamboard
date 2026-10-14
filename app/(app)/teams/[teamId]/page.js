import { notFound } from 'next/navigation';
import { requirePageViewer, publicViewer, tagUpdating } from '@/lib/viewer';
import { loadTeam } from '@/lib/queries/teams';
import { canManageTeamsIn } from '@/lib/access';
import { loadProjectFieldOptions } from '@/lib/queries/project';
import { canCreateProjectIn } from '@/lib/policy';
import TeamOverview from './TeamOverview';

// Team overview (design §2.1): team names and the viewer's visible projects are for everyone. Teams have no thread
// space any more (design-amendments A10: posts live on the CAGE and office Suggestions/Announcements boards). An
// archived team (or a team in an archived office) is a 404 except for the people who could restore it, who see it
// with a banner.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

const validId = (v) => /^[0-9]{1,18}$/.test(String(v ?? ''));

async function load(viewer, id) {
  let data;
  try {
    data = await loadTeam(viewer, id);
  } catch (e) {
    throw tagUpdating(e);
  }
  if (!data) return null;
  if (data.team.archived && !canManageTeamsIn(viewer, data.team.office_id)) return null;
  if (data.office?.archived && !viewer.is_admin) return null;
  return data;
}

export async function generateMetadata({ params }) {
  if (!validId(params.teamId)) return { title: 'Team' };
  try {
    const viewer = await requirePageViewer();
    const data = await load(viewer, params.teamId);
    return { title: data ? data.team.name : 'Team' };
  } catch {
    return { title: 'Team' };                // the page itself redirects or reports the error
  }
}

export default async function TeamPage({ params }) {
  const viewer = await requirePageViewer();
  if (!validId(params.teamId)) notFound();
  const data = await load(viewer, params.teamId);
  if (!data) notFound();
  const pv = publicViewer(viewer);
  // The New project dialog's owner / jurisdiction suggestions (A6.4), only for people who may add one here.
  let createOptions = null;
  try {
    if (canCreateProjectIn(viewer, data.team) && !data.team.archived) createOptions = await loadProjectFieldOptions(viewer);
  } catch (e) {
    throw tagUpdating(e);
  }
  return <TeamOverview viewer={pv} data={data} createOptions={createOptions} />;
}
