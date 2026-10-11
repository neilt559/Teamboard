import { requirePageViewer } from '@/lib/viewer';
import { notFound } from 'next/navigation';
import { IconUser } from '@/app/icons';

// Placeholder from M0 so the route exists and is guarded; replaced in M2 (C3) (design §2.1, §15).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Profile' };

export default async function PersonPage({ params }) {
  const viewer = await requirePageViewer();
  if (!/^[0-9]{1,18}$/.test(String(params.userId))) notFound();
  return (
    <div className="coming-soon">
      <div className="proj-head">
        <h1 className="wi-h"><IconUser size={24} /> Profile</h1>
      </div>
      <div className="empty">
        <h3>Coming soon</h3>
        <p>A person’s profile: office, team, who they report to, and shared projects.</p>
      </div>
    </div>
  );
}
