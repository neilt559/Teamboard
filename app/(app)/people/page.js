import { requirePageViewer } from '@/lib/viewer';
import { IconUsers } from '@/app/icons';

// Placeholder from M0 so the route exists and is guarded; replaced in M2 (C3) (design §2.1, §15).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'People' };

export default async function PeoplePage() {
  const viewer = await requirePageViewer();
  return (
    <div className="coming-soon">
      <div className="proj-head">
        <h1 className="wi-h"><IconUsers size={24} /> People</h1>
      </div>
      <div className="empty">
        <h3>Coming soon</h3>
        <p>The company directory: search by office, department, team and position.</p>
      </div>
    </div>
  );
}
