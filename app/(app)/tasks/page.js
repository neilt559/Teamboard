import { requirePageViewer, publicViewer, tagUpdating } from '@/lib/viewer';
import { listVisibleOpenTasks } from '@/lib/queries/tasks';
import GlobalTasks from './GlobalTasks';

// All tasks (design §2.1, inventory §1.9): every open task on the projects the viewer can see, with today's
// filters, sorting and inline edits. Archived teams and offices are left out, and so are subtasks whose
// parent is archived (lib/queries/tasks.js).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'All tasks' };

export default async function AllTasksPage() {
  const viewer = await requirePageViewer();
  let data;
  try {
    data = await listVisibleOpenTasks(viewer);
  } catch (e) {
    throw tagUpdating(e);
  }
  return <GlobalTasks data={data} viewer={publicViewer(viewer)} />;
}
