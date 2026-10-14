import { requirePageViewer, publicViewer, tagUpdating } from '@/lib/viewer';
import { listVisibleProjects, loadCreateProjectOptions } from '@/lib/queries/projects-list';
import ProjectsIndex from './ProjectsIndex';

// /projects (design §2.1): every project the viewer can see, with search, the Office -> Team filter, the tabs
// Mine / My offices / All I can see, pin toggles and "Show archived" (?archived=1, which the sidebar's
// "Archived (N)" link opens). A6: "+ New project" (the create dialog, for anyone who may create in some team) and
// "Weekly reports" (/reports).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Projects' };

const one = (v) => (Array.isArray(v) ? v[0] : v);
const idOrAll = (v) => (typeof v === 'string' && /^[0-9]{1,18}$/.test(v) ? v : 'all');

export default async function ProjectsPage({ searchParams }) {
  const viewer = await requirePageViewer();
  const archived = one(searchParams?.archived) === '1';
  let data;
  let createOptions;
  try {
    // The New project dialog (A6.4): the teams this viewer may create in, and the owner / jurisdiction suggestions.
    [data, createOptions] = await Promise.all([listVisibleProjects(viewer, { archived }), loadCreateProjectOptions(viewer)]);
  } catch (e) {
    throw tagUpdating(e);
  }
  const tab = one(searchParams?.tab);
  const q = one(searchParams?.q);
  const initial = {
    q: typeof q === 'string' ? q.slice(0, 200) : '',
    tab: ['mine', 'offices', 'all'].includes(tab) ? tab : null,
    office: idOrAll(one(searchParams?.office)),
    team: idOrAll(one(searchParams?.team)),
  };
  return <ProjectsIndex data={data} viewer={publicViewer(viewer)} initial={initial} archived={archived} createOptions={createOptions} />;
}
