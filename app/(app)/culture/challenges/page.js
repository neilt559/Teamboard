import Link from 'next/link';
import { requirePageViewer } from '@/lib/viewer';
import { nowFromRequestContext } from '@/lib/clock';
import { isOrganizer } from '@/lib/policy';
import { listChallenges } from '@/lib/queries/challenges';
import { IconMedal, IconPlus, IconArchive } from '@/app/icons';
import { ChallengeCard } from './_components/ChallengeCard';
import RefreshOnFocus from './_components/RefreshOnFocus';

// /culture/challenges: every monthly challenge (design §2.1, §10(a); agent K1), in Running now / Coming up / Past.
// Company challenges plus the ones for the viewer's offices and followed offices by default; "All offices" shows
// every office's (everyone may read every challenge). Organizers get New challenge and the archived list.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Challenges' };

function Section({ title, list, today, empty }) {
  if (!list.length && !empty) return null;
  return (
    <section className="ch-section" aria-label={title}>
      <h2 className="ch-section-h">{title}{list.length > 0 && <span className="ch-section-n">{list.length}</span>}</h2>
      {list.length ? (
        <div className="ch-grid">
          {list.map((c) => <ChallengeCard key={c.id} c={c} today={today} />)}
        </div>
      ) : <p className="ch-section-empty">{empty}</p>}
    </section>
  );
}

export default async function ChallengesPage({ searchParams }) {
  const viewer = await requirePageViewer();
  const org = isOrganizer(viewer);
  const show = searchParams?.show === 'all' ? 'all' : 'mine';
  const archived = org && searchParams?.archived === '1';
  const data = await listChallenges(viewer, nowFromRequestContext(), { show, archived });
  const q = (o) => {
    const p = new URLSearchParams();
    if (o.show === 'all') p.set('show', 'all');
    if (o.archived) p.set('archived', '1');
    const s = p.toString();
    return `/culture/challenges${s ? `?${s}` : ''}`;
  };
  const nothing = !data.running.length && !data.upcoming.length && !data.past.length && !data.archived_list.length;
  return (
    <div className="ch-page">
      <RefreshOnFocus />
      <div className="proj-head">
        <h1 className="wi-h"><IconMedal size={24} /> Challenges</h1>
        <div className="spacer" />
        {org && <Link href="/culture/challenges/new" prefetch={false} className="btn btn-lime wi"><IconPlus size={15} /> New challenge</Link>}
      </div>
      <p className="cu-intro">Each month’s challenge: log your stats and see where you, your office and your department stand.</p>
      <nav className="ch-filter" aria-label="Which challenges">
        <Link href={q({ show: 'mine' })} prefetch={false} className={`ch-filter-chip${show === 'mine' && !archived ? ' on' : ''}`} aria-current={show === 'mine' && !archived ? 'page' : undefined}>Company + my offices</Link>
        <Link href={q({ show: 'all' })} prefetch={false} className={`ch-filter-chip${show === 'all' && !archived ? ' on' : ''}`} aria-current={show === 'all' && !archived ? 'page' : undefined}>
          All offices{show === 'mine' && data.other_office_count > 0 ? ` (+${data.other_office_count})` : ''}
        </Link>
        {org && (
          <Link href={q({ show: 'all', archived: true })} prefetch={false} className={`ch-filter-chip${archived ? ' on' : ''}`} aria-current={archived ? 'page' : undefined}>
            <IconArchive size={13} /> Archived
          </Link>
        )}
      </nav>
      {archived ? (
        <Section title="Archived" list={data.archived_list} today={data.today} empty="Nothing is archived." />
      ) : nothing ? (
        <div className="empty">
          <h3>No challenges yet</h3>
          <p>{org ? 'Set up the first monthly challenge: steps, miles, workouts, anything you can count.' : 'A culture organizer sets up each month’s challenge. Check back soon.'}</p>
          {org && <Link href="/culture/challenges/new" prefetch={false} className="btn btn-lime">New challenge</Link>}
        </div>
      ) : (
        <>
          <Section title="Running now" list={data.running} today={data.today} empty="No challenge is running right now." />
          <Section title="Coming up" list={data.upcoming} today={data.today} />
          <Section title="Past challenges" list={data.past} today={data.today} />
        </>
      )}
    </div>
  );
}
