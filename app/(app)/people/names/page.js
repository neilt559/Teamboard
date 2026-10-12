import { requirePageViewer, tagUpdating } from '@/lib/viewer';
import { listNames } from '@/lib/queries/people';
import { isAdmin } from '@/lib/policy';
import NamesOnTasks from './NamesOnTasks';

// /people/names: "Names on tasks", the task-assignee roster everyone can edit (design §2.1, §4.5 decision 30).
// A static segment, so it wins over /people/[userId].
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Names on tasks' };

export default async function NamesOnTasksPage() {
  const viewer = await requirePageViewer();
  let data;
  try {
    data = await listNames(viewer);
  } catch (e) {
    throw tagUpdating(e);
  }
  return <NamesOnTasks initial={data} isAdmin={isAdmin(viewer)} />;
}
