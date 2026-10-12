import { redirect } from 'next/navigation';
import { requirePageViewer, publicViewer } from '@/lib/viewer';
import ForcedPassword from './ForcedPassword';

// /password (design §2.1, §13 #3): the forced "Choose a new password" after an admin reset (must_change).
// It comes before the profile wizard, so an incomplete profile is allowed here. Every API refuses this session
// (403 must_change) until the password is changed, and every page sends it here. It can't be dismissed (rule
// 48); signing out is the only other way off this page. Everyone else changes their password in Settings.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Choose a new password' };

export default async function PasswordPage() {
  const viewer = await requirePageViewer({ allowMustChange: true, allowIncomplete: true });
  if (!viewer.must_change) redirect('/settings?tab=password');
  return <ForcedPassword viewer={publicViewer(viewer)} />;
}
