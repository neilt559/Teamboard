'use client';
import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { withDefaults } from '@/lib/prefs';
import { IconAlert } from '../icons';
import Header from './Header';
import Sidebar from './Sidebar';
import Drawer from './Drawer';
import BottomNav from './BottomNav';
import { onApiBanner } from './api';
import { ClaimAdminHost } from './ClaimAdmin';

// The signed-in frame around every page in app/(app) (design §2.2): header, desktop sidebar, phone drawer
// and bottom bar, plus the banner api.js raises for 428 (reload) and 503 (updating).
// viewer = publicViewer(...) and nav = loadNav(...) from app/(app)/layout.js. Density (Settings > Customize)
// is a data attribute here rather than on <body>, so it is in the server HTML (no flash).
export default function AppShell({ viewer, nav, children }) {
  const pathname = usePathname() || '/';
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [banner, setBanner] = useState(null);
  const prefs = withDefaults(viewer?.prefs, { isAdmin: !!viewer?.is_admin });

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  useEffect(() => { setDrawerOpen(false); setBanner(null); }, [pathname]);
  useEffect(() => onApiBanner(setBanner), []);
  // Back/forward: Next 14.2 restores the page from its router cache without asking the server
  // (staleTimes covers Link navigations only), so a page edited since would come back stale and its fields
  // would send an old base (a false 409). Refresh once the restore has run: this listener can fire before
  // Next's own popstate handler (child effects register first), hence the timeout. pageshow covers a
  // whole-page bfcache restore.
  useEffect(() => {
    const onPop = () => { setTimeout(() => router.refresh(), 0); };
    const onShow = (e) => { if (e.persisted) router.refresh(); };
    window.addEventListener('popstate', onPop);
    window.addEventListener('pageshow', onShow);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('pageshow', onShow);
    };
  }, [router]);
  // Rotating a tablet or widening the window past the phone layout closes the drawer (and its scroll lock).
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 721px)');
    const on = () => { if (mq.matches) setDrawerOpen(false); };
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  return (
    <div className="app-shell" data-density={prefs.density}>
      <a className="skip-link" href="#main">Skip to content</a>
      <Header viewer={viewer} nav={nav} pathname={pathname} drawerOpen={drawerOpen} onMenu={() => setDrawerOpen((o) => !o)} />
      <div className="layout">
        <Sidebar nav={nav} pathname={pathname} />
        <main className="main" id="main" tabIndex={-1}>
          {banner && (
            <div className={`banner shell-banner${banner.kind === 'updating' ? ' setup' : ''}`} role="status">
              <IconAlert size={16} />
              <span>{banner.message}</span>
              <span className="spacer" />
              {banner.kind === 'reload'
                ? <button type="button" className="btn btn-ink btn-sm" onClick={() => window.location.reload()}>Reload</button>
                : <button type="button" className="btn btn-plain btn-sm" onClick={() => setBanner(null)}>Dismiss</button>}
            </div>
          )}
          {children}
        </main>
      </div>
      <Drawer open={drawerOpen} onClose={closeDrawer} viewer={viewer} nav={nav} pathname={pathname} />
      <BottomNav nav={nav} pathname={pathname} />
      {/* The hidden Admin entrance's one-time first-admin claim (Header -> openAdminEntrance). */}
      {!viewer?.is_admin && <ClaimAdminHost viewer={viewer} />}
    </div>
  );
}
