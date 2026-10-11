import { requirePageViewer } from '@/lib/viewer';
import { notFound } from 'next/navigation';
import { IconKey } from '@/app/icons';

// Placeholder from M0 so the route exists and is guarded; replaced in M1 (I2) (design §2.1, §15).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Accounts' };

export default async function AdminUsersPage() {
  const viewer = await requirePageViewer();
  if (!viewer.is_admin) notFound();
  return (
    <div className="coming-soon">
      <div className="proj-head">
        <h1 className="wi-h"><IconKey size={24} /> Accounts</h1>
      </div>
      <div className="empty">
        <h3>Coming soon</h3>
        <p>Accounts: profiles, verification, passwords and admin rights.</p>
      </div>
    </div>
  );
}
