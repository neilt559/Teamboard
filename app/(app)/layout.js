import { requirePageViewer, publicViewer } from '@/lib/viewer';
import { loadNav } from '@/lib/queries/nav';
import AppShell from '@/app/_ui/AppShell';

// Every signed-in page (design §2.1). The guard here covers the first load only: layouts don't re-render on
// client navigation, so each page.js calls requirePageViewer() itself as well (React cache() makes the
// second call free within a request).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

// Lock or statement timeouts while a deploy migrates (lib/viewer.js retries once, then throws): show
// "updating" and retry, never a sign-out or a blank error page. Next's redirect and not-found signals
// carry no such code and pass straight through.
const UPDATING_CODES = new Set(['55P03', '40P01', '40001', '57014']);

function Updating() {
  return (
    <div className="login-wrap">
      <meta httpEquiv="refresh" content="3" />
      <div className="login-card">
        <div className="login-brand"><span className="dot" /> TeamBoard</div>
        <p className="login-sub" role="status">TeamBoard is updating — try again in a moment. This page will refresh by itself.</p>
      </div>
    </div>
  );
}

export default async function AppLayout({ children }) {
  let viewer;
  let nav;
  try {
    viewer = await requirePageViewer();
    nav = await loadNav(viewer);
  } catch (e) {
    if (UPDATING_CODES.has(e?.code)) return <Updating />;
    throw e;
  }
  return <AppShell viewer={publicViewer(viewer)} nav={nav}>{children}</AppShell>;
}
