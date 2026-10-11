import { requirePageViewer } from '@/lib/viewer';
import { notFound } from 'next/navigation';
import { IconCheck } from '@/app/icons';

// Placeholder from M0 so the route exists and is guarded; replaced in M1 (I2) (design §2.1, §15).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Approvals' };

export default async function AdminApprovalsPage() {
  const viewer = await requirePageViewer();
  if (!viewer.is_admin) notFound();
  return (
    <div className="coming-soon">
      <div className="proj-head">
        <h1 className="wi-h"><IconCheck size={24} /> Approvals</h1>
      </div>
      <div className="empty">
        <h3>Coming soon</h3>
        <p>Position requests, office changes, name links and identity checks.</p>
      </div>
    </div>
  );
}
