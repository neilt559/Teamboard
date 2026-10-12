import { Suspense } from 'react';
import Link from 'next/link';
import { requirePageViewer, publicViewer, tagUpdating } from '@/lib/viewer';
import { loadDashboard } from '@/lib/queries/home';
import { nowFromRequestContext } from '@/lib/clock';
import { withDefaults } from '@/lib/prefs';
import { IconHome, IconBuilding, IconFolder, IconList, IconSettings } from '@/app/icons';
import HomeLanding, { WidgetBoundary, HomeNotices } from './HomeLanding';
import MyTasksWidget from './_widgets/MyTasksWidget';
import PinnedWidget from './_widgets/PinnedWidget';
import MyProjectsWidget from './_widgets/MyProjectsWidget';
import AdminQueueWidget from './_widgets/AdminQueueWidget';
import WhatsNewWidget from './_widgets/WhatsNewWidget';
import AnnouncementsWidget from './_widgets/AnnouncementsWidget';
import ThreadsWidget from './_widgets/ThreadsWidget';
import ChallengeWidget from './_widgets/ChallengeWidget';
import EventsWidget from './_widgets/EventsWidget';
import BracketWidget from './_widgets/BracketWidget';
import GeoWidget from './_widgets/GeoWidget';

// Home: the dashboard (design §2.1 "/", §11). The widgets show in the viewer's saved order (Settings ›
// Customize; prefs.widgets, unknown keys dropped and new ones appended by withDefaults), switched-off ones
// are skipped and the approval queue is for admins only. Widgets from other areas (bracket, GeoGuessr,
// threads, culture) get { viewer, now } and load their own data; this area's widgets read the one batch
// from loadDashboard. Each widget sits in its own error boundary, so one failing card never takes Home down.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Home' };

const WIDGETS = {
  my_tasks: MyTasksWidget,
  pinned_projects: PinnedWidget,
  my_projects: MyProjectsWidget,
  announcements: AnnouncementsWidget,
  threads: ThreadsWidget,
  challenge: ChallengeWidget,
  events: EventsWidget,
  bracket: BracketWidget,
  geo: GeoWidget,
  admin_queue: AdminQueueWidget,
};
// Widgets fed from loadDashboard (this area), each with only its slice; the rest load their own.
const OWN = {
  my_tasks: (d) => ({ my_tasks: d.my_tasks, today: d.today, pending_person: d.notices?.pending_person || null }),
  pinned_projects: (d) => ({ pinned: d.pinned }),
  my_projects: (d) => ({ my_projects: d.my_projects }),
  admin_queue: (d) => ({ admin: d.admin }),
};

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

export default async function HomePage({ searchParams }) {
  const viewer = await requirePageViewer();
  const now = nowFromRequestContext();
  let dash;
  try {
    dash = await loadDashboard(viewer, now);
  } catch (e) {
    throw tagUpdating(e);
  }
  const prefs = withDefaults(viewer.prefs, { isAdmin: !!viewer.is_admin });
  const pv = publicViewer(viewer);
  const notice = searchParams?.notice === 'project_gone' ? 'project_gone' : null;
  const list = prefs.widgets.filter((w) => w.on && WIDGETS[w.key] && (w.key !== 'admin_queue' || viewer.is_admin));

  return (
    <div className="dash">
      <HomeLanding landing={prefs.landing} hasNotice={!!notice} />
      <div className="proj-head dash-head">
        <h1 className="wi-h"><IconHome size={24} /> Home</h1>
        <span className="dash-hello">Hi, {firstName(viewer.name)}</span>
        <div className="spacer" />
        <nav className="dash-links" aria-label="Shortcuts">
          <Link href="/offices" prefetch={false} className="btn btn-plain btn-sm wi"><IconBuilding size={15} /> Offices</Link>
          <Link href="/projects" prefetch={false} className="btn btn-plain btn-sm wi"><IconFolder size={15} /> All projects</Link>
          <Link href="/tasks" prefetch={false} className="btn btn-plain btn-sm wi"><IconList size={15} /> All tasks</Link>
          <Link href="/settings?tab=customize" prefetch={false} className="btn btn-plain btn-sm wi" title="Choose and order the cards on Home"><IconSettings size={15} /> Customize</Link>
        </nav>
      </div>
      <HomeNotices notice={notice} notices={dash.notices} seenAt={prefs.position_notice_seen_at} />
      <WhatsNewWidget viewer={pv} />
      {list.length === 0 ? (
        <div className="empty">
          <h3>Your Home is empty</h3>
          <p>Every card is switched off. Turn some back on in Settings.</p>
          <Link href="/settings?tab=customize" prefetch={false} className="btn btn-lime">Customize Home</Link>
        </div>
      ) : (
        <div className="dash-grid">
          {list.map(({ key }) => {
            const W = WIDGETS[key];
            return (
              <WidgetBoundary key={key} name={key}>
                <Suspense fallback={<section className="widget widget-loading" aria-busy="true" />}>
                  {OWN[key] ? <W viewer={pv} now={now} data={OWN[key](dash)} /> : <W viewer={pv} now={now} />}
                </Suspense>
              </WidgetBoundary>
            );
          })}
        </div>
      )}
    </div>
  );
}
