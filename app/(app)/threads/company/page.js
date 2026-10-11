import { requirePageViewer } from '@/lib/viewer';
import { IconChat } from '@/app/icons';

// Placeholder from M0 so the route exists and is guarded; replaced in M3 (T1) (design §2.1, §15).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Company threads' };

export default async function CompanyThreadsPage() {
  const viewer = await requirePageViewer();
  return (
    <div className="coming-soon">
      <div className="proj-head">
        <h1 className="wi-h"><IconChat size={24} /> Company threads</h1>
      </div>
      <div className="empty">
        <h3>Coming soon</h3>
        <p>Company-wide conversations.</p>
      </div>
    </div>
  );
}
