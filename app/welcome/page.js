import { redirect } from 'next/navigation';
import { requirePageViewer } from '@/lib/viewer';

// Placeholder from M0: the one-time profile wizard (design §5.2) replaces it in M1 (I1).
// Signed in with an incomplete profile only; a pending password change goes to /password first, and a
// finished profile is edited in Settings.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Welcome' };

export default async function WelcomePage() {
  const viewer = await requirePageViewer({ allowIncomplete: true });
  if (viewer.profile_done) redirect('/settings');
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-brand"><span className="dot" /> TeamBoard</div>
        <h1 className="login-h">Welcome, {viewer.name}</h1>
        <p className="login-sub">Coming soon: a quick one-time profile (your office, team, department, position and boss).</p>
      </div>
    </div>
  );
}
