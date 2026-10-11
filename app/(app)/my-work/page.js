import { requirePageViewer } from '@/lib/viewer';
import { IconCheck } from '@/app/icons';

// Placeholder from M0 so the route exists and is guarded; replaced in M2 (B3) (design §2.1, §15).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'My work' };

export default async function MyWorkPage() {
  const viewer = await requirePageViewer();
  return (
    <div className="coming-soon">
      <div className="proj-head">
        <h1 className="wi-h"><IconCheck size={24} /> My work</h1>
      </div>
      <div className="empty">
        <h3>Coming soon</h3>
        <p>Your open tasks grouped by when they are due, and your projects.</p>
      </div>
    </div>
  );
}
