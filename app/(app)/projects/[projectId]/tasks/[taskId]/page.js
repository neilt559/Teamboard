import { notFound } from 'next/navigation';
import { requirePageViewer } from '@/lib/viewer';
import { loadTaskPage } from '@/lib/queries/project';
import { projectTitle } from '@/lib/projects';
import TaskDetail from './TaskDetail';

// /projects/[projectId]/tasks/[taskId] (design §2.1): one task, phone-first (the board's cards open this page).
// Same visibility as the project; a task that isn't in that project is a 404 too.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

const ID = /^[0-9]{1,18}$/;

export async function generateMetadata({ params }) {
  const viewer = await requirePageViewer();
  const ok = ID.test(String(params.projectId)) && ID.test(String(params.taskId));
  const data = ok ? await loadTaskPage(viewer, String(params.projectId), String(params.taskId)) : null;
  if (!data) notFound();                                  // before streaming starts: a real 404 status
  return { title: `${data.task.title || (data.task.parent_id ? 'Untitled subtask' : 'Untitled task')} · ${projectTitle(data.project)}` };
}

export default async function TaskPage({ params }) {
  const viewer = await requirePageViewer();
  if (!ID.test(String(params.projectId)) || !ID.test(String(params.taskId))) notFound();
  const data = await loadTaskPage(viewer, String(params.projectId), String(params.taskId));
  if (!data) notFound();
  return <TaskDetail key={data.task.id} initial={data} />;
}
