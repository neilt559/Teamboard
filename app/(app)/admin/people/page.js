import { requirePageViewer } from '@/lib/viewer';
import { notFound } from 'next/navigation';
import { IconUsers } from '@/app/icons';

// Placeholder from M0 so the route exists and is guarded; replaced in M1 (I2) (design §2.1, §15).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Names on tasks (admin)' };

export default async function AdminPeoplePage() {
  const viewer = await requirePageViewer();
  if (!viewer.is_admin) notFound();
  return (
    <div className="coming-soon">
      <div className="proj-head">
        <h1 className="wi-h"><IconUsers size={24} /> Names on tasks (admin)</h1>
      </div>
      <div className="empty">
        <h3>Coming soon</h3>
        <p>Link names on tasks to accounts, change kinds, restore archived names.</p>
      </div>
    </div>
  );
}
