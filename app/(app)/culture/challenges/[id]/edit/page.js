import { requirePageViewer } from '@/lib/viewer';
import { notFound } from 'next/navigation';
import { IconTrophy } from '@/app/icons';

// Placeholder from M0 so the route exists and is guarded; replaced in M4 (K1) (design §2.1, §15).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Edit challenge' };

export default async function EditChallengePage({ params }) {
  const viewer = await requirePageViewer();
  if (!/^[0-9]{1,18}$/.test(String(params.id))) notFound();
  return (
    <div className="coming-soon">
      <div className="proj-head">
        <h1 className="wi-h"><IconTrophy size={24} /> Edit challenge</h1>
      </div>
      <div className="empty">
        <h3>Coming soon</h3>
        <p>Edit a challenge.</p>
      </div>
    </div>
  );
}
