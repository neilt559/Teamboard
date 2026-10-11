import { requirePageViewer } from '@/lib/viewer';
import { notFound } from 'next/navigation';
import { IconBuilding } from '@/app/icons';

// Placeholder from M0 so the route exists and is guarded; replaced in M1 (I2) (design §2.1, §15).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Organization' };

export default async function AdminOrgPage() {
  const viewer = await requirePageViewer();
  if (!viewer.is_admin) notFound();
  return (
    <div className="coming-soon">
      <div className="proj-head">
        <h1 className="wi-h"><IconBuilding size={24} /> Organization</h1>
      </div>
      <div className="empty">
        <h3>Coming soon</h3>
        <p>Offices, teams, departments and positions.</p>
      </div>
    </div>
  );
}
