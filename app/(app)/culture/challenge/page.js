import { requirePageViewer } from '@/lib/viewer';
import { IconTrophy } from '@/app/icons';

// Placeholder from M0 so the route exists and is guarded; replaced in M4 (K1) (design §2.1, §15).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'This month’s challenge' };

export default async function CurrentChallengePage() {
  const viewer = await requirePageViewer();
  return (
    <div className="coming-soon">
      <div className="proj-head">
        <h1 className="wi-h"><IconTrophy size={24} /> This month’s challenge</h1>
      </div>
      <div className="empty">
        <h3>Coming soon</h3>
        <p>This month’s challenge: log your stats and see the leaderboards.</p>
      </div>
    </div>
  );
}
