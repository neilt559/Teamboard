import { requirePageViewer } from '@/lib/viewer';
import { IconTag } from '@/app/icons';

// Placeholder from M0 so the route exists and is guarded; replaced in M2 (C3) (design §2.1, §15).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Names on tasks' };

export default async function NamesOnTasksPage() {
  const viewer = await requirePageViewer();
  return (
    <div className="coming-soon">
      <div className="proj-head">
        <h1 className="wi-h"><IconTag size={24} /> Names on tasks</h1>
      </div>
      <div className="empty">
        <h3>Coming soon</h3>
        <p>The names and groups tasks can be assigned to.</p>
      </div>
    </div>
  );
}
