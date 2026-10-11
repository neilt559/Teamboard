import { requirePageViewer } from '@/lib/viewer';
import { IconBulb } from '@/app/icons';

// Placeholder from M0 so the route exists and is guarded; replaced in M2 (C3) (design §2.1, §15).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Suggestions' };

export default async function SuggestionsPage() {
  const viewer = await requirePageViewer();
  return (
    <div className="coming-soon">
      <div className="proj-head">
        <h1 className="wi-h"><IconBulb size={24} /> Suggestions</h1>
      </div>
      <div className="empty">
        <h3>Coming soon</h3>
        <p>Ideas to make work better, with +1s and replies.</p>
      </div>
    </div>
  );
}
