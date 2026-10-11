import { requirePageViewer } from '@/lib/viewer';
import { IconSettings } from '@/app/icons';

// Placeholder from M0 so the route exists and is guarded; replaced in M1 (I1) (design §2.1, §15).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const viewer = await requirePageViewer();
  return (
    <div className="coming-soon">
      <div className="proj-head">
        <h1 className="wi-h"><IconSettings size={24} /> Settings</h1>
      </div>
      <div className="empty">
        <h3>Coming soon</h3>
        <p>Your profile, photo, password and how TeamBoard looks for you.</p>
      </div>
    </div>
  );
}
