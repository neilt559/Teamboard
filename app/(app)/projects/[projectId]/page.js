import { requirePageViewer } from '@/lib/viewer';
import { notFound } from 'next/navigation';
import { IconFile } from '@/app/icons';

// Placeholder from M0 so the route exists and is guarded; replaced in M2 (B2) (design §2.1, §15).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Project' };

export default async function ProjectPage({ params }) {
  const viewer = await requirePageViewer();
  if (!/^[0-9]{1,18}$/.test(String(params.projectId))) notFound();
  return (
    <div className="coming-soon">
      <div className="proj-head">
        <h1 className="wi-h"><IconFile size={24} /> Project</h1>
      </div>
      <div className="empty">
        <h3>Coming soon</h3>
        <p>The project board: tasks, notes, meetings, info and members.</p>
      </div>
    </div>
  );
}
