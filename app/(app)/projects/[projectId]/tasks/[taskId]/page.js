import { requirePageViewer } from '@/lib/viewer';
import { notFound } from 'next/navigation';
import { IconCheck } from '@/app/icons';

// Placeholder from M0 so the route exists and is guarded; replaced in M2 (B2) (design §2.1, §15).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Task' };

export default async function TaskPage({ params }) {
  const viewer = await requirePageViewer();
  if (!/^[0-9]{1,18}$/.test(String(params.projectId))) notFound();
  if (!/^[0-9]{1,18}$/.test(String(params.taskId))) notFound();
  return (
    <div className="coming-soon">
      <div className="proj-head">
        <h1 className="wi-h"><IconCheck size={24} /> Task</h1>
      </div>
      <div className="empty">
        <h3>Coming soon</h3>
        <p>One task, phone-friendly: owner, stoplight, due date, status, notes and subtasks.</p>
      </div>
    </div>
  );
}
