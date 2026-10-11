import { requirePageViewer } from '@/lib/viewer';
import { IconTrophy } from '@/app/icons';

// Placeholder from M0 so the route exists and is guarded; replaced in M2 (C2) (design §2.1, §15).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'New bracket' };

export default async function NewBracketPage() {
  const viewer = await requirePageViewer();
  return (
    <div className="coming-soon">
      <div className="proj-head">
        <h1 className="wi-h"><IconTrophy size={24} /> New bracket</h1>
      </div>
      <div className="empty">
        <h3>Coming soon</h3>
        <p>Set up a new bracket.</p>
      </div>
    </div>
  );
}
