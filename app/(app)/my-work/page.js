import { requirePageViewer, publicViewer, tagUpdating } from '@/lib/viewer';
import { nowFromRequestContext } from '@/lib/clock';
import { localYmd } from '@/lib/time';
import { loadMyWork } from '@/lib/queries/tasks';
import { listMyProjects } from '@/lib/queries/projects-list';
import MyWork from './MyWork';

// My work (design §2.1): my open tasks (assigned to my linked name on tasks), grouped Overdue / Today /
// This week / Later / No date (or by project: prefs.my_work_group), my projects, and notices for my pending
// position, office change or person link. "Today" is the viewer's office date (test clock aware, §8.1).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'My work' };

export default async function MyWorkPage() {
  const viewer = await requirePageViewer();
  let work;
  let projects;
  try {
    [work, projects] = await Promise.all([loadMyWork(viewer), listMyProjects(viewer)]);
  } catch (e) {
    throw tagUpdating(e);
  }
  const now = nowFromRequestContext();
  let today;
  try { today = localYmd(now, viewer.tz || 'America/Chicago'); } catch { today = localYmd(now); }
  return <MyWork data={{ ...work, projects }} today={today} viewer={publicViewer(viewer)} />;
}
