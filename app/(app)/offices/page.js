import { requirePageViewer } from '@/lib/viewer';
import { IconBuilding } from '@/app/icons';

// Placeholder from M0 so the route exists and is guarded; replaced in M2 (B1) (design §2.1, §15).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Offices' };

export default async function OfficesPage() {
  const viewer = await requirePageViewer();
  return (
    <div className="coming-soon">
      <div className="proj-head">
        <h1 className="wi-h"><IconBuilding size={24} /> Offices</h1>
      </div>
      <div className="empty">
        <h3>Coming soon</h3>
        <p>All offices: people, local time, teams and your projects in each.</p>
      </div>
    </div>
  );
}
