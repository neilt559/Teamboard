import { requirePageViewer } from '@/lib/viewer';
import { IconHome } from '@/app/icons';

// Placeholder from M0 so the route exists and is guarded; replaced in M2 (B1) (design §2.1, §15).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Home' };

export default async function HomePage() {
  const viewer = await requirePageViewer();
  return (
    <div className="coming-soon">
      <div className="proj-head">
        <h1 className="wi-h"><IconHome size={24} /> Home</h1>
      </div>
      <div className="empty">
        <h3>Coming soon</h3>
        <p>Your dashboard: my tasks, pinned projects, my projects and what is happening around the company.</p>
      </div>
    </div>
  );
}
