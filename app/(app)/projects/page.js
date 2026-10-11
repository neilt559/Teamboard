import { requirePageViewer } from '@/lib/viewer';
import { IconFolder } from '@/app/icons';

// Placeholder from M0 so the route exists and is guarded; replaced in M2 (B3) (design §2.1, §15).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Projects' };

export default async function ProjectsPage() {
  const viewer = await requirePageViewer();
  return (
    <div className="coming-soon">
      <div className="proj-head">
        <h1 className="wi-h"><IconFolder size={24} /> Projects</h1>
      </div>
      <div className="empty">
        <h3>Coming soon</h3>
        <p>Search and browse every project you can see.</p>
      </div>
    </div>
  );
}
