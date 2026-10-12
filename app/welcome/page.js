import { redirect } from 'next/navigation';
import { requirePageViewer, publicViewer } from '@/lib/viewer';
import { loadProfileOptions } from '@/lib/queries/profile';
import WelcomeWizard from './WelcomeWizard';

// /welcome (design §2.1, §5.2): the one-time profile wizard. Signed in with an incomplete profile only: a
// pending password change goes to /password first (requirePageViewer), and a finished profile is edited in
// Settings. Every page and API sends an incomplete profile here (APIs answer 403 profile_required).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Welcome' };

export default async function WelcomePage() {
  const viewer = await requirePageViewer({ allowIncomplete: true });
  if (viewer.profile_done) redirect('/settings');
  const data = await loadProfileOptions(viewer);
  return <WelcomeWizard viewer={publicViewer(viewer)} data={data} />;
}
