import { redirect } from 'next/navigation';
import { requirePageViewer } from '@/lib/viewer';

// Placeholder from M0: the forced "Choose a new password" page (design §2.1) replaces it in M1 (I1).
// Only for a session whose password was reset by an admin (must_change); it comes before the profile
// wizard, so an incomplete profile is allowed here. Everyone else changes their password in Settings.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Choose a new password' };

export default async function PasswordPage() {
  const viewer = await requirePageViewer({ allowMustChange: true, allowIncomplete: true });
  if (!viewer.must_change) redirect('/settings?tab=password');
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-brand"><span className="dot" /> TeamBoard</div>
        <h1 className="login-h">Choose a new password</h1>
        <p className="login-sub">Coming soon: pick your own password to replace the temporary one.</p>
      </div>
    </div>
  );
}
