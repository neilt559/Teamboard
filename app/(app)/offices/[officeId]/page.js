import { notFound } from 'next/navigation';
import { requirePageViewer, publicViewer, tagUpdating } from '@/lib/viewer';
import { loadOffice } from '@/lib/queries/offices';
import { canManageTeamsIn } from '@/lib/access';
import { nowFromRequestContext } from '@/lib/clock';
import ThreadPreview from '../../threads/_components/ThreadPreview';
import OfficeView from './OfficeView';

// One office (design §2.1): public part for everyone (teams with visible project names, people); the
// office-internal part (meetings, office thread) for home and extra-office members at any level, PMs and up
// (L3+) and admins (tb_can_see_office, amendment A1); others see "<Office> office members only".
// An archived office is a 404, except for admins, who get a Restore banner.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

const validId = (v) => /^[0-9]{1,18}$/.test(String(v ?? ''));

async function load(viewer, id) {
  try {
    return await loadOffice(viewer, id);
  } catch (e) {
    throw tagUpdating(e);
  }
}

export async function generateMetadata({ params }) {
  if (!validId(params.officeId)) return { title: 'Office' };
  try {
    const viewer = await requirePageViewer();
    const data = await load(viewer, params.officeId);
    return { title: data ? data.office.name : 'Office' };
  } catch {
    return { title: 'Office' };              // the page itself redirects or reports the error
  }
}

export default async function OfficePage({ params }) {
  const viewer = await requirePageViewer();
  if (!validId(params.officeId)) notFound();
  const loaded = await load(viewer, params.officeId);
  if (!loaded) notFound();
  // Archived teams are listed (with Restore) only for people who manage teams here; nobody else gets them.
  const data = canManageTeamsIn(viewer, loaded.office.id) ? loaded : { ...loaded, archived_teams: [] };
  const pv = publicViewer(viewer);
  return (
    <OfficeView
      viewer={pv}
      data={data}
      now={nowFromRequestContext()}
      threadSlot={data.internal ? <ThreadPreview scope="office" officeId={data.office.id} viewer={pv} /> : null}
    />
  );
}
