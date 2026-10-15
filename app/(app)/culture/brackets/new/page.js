import Link from 'next/link';
import { requirePageViewer } from '@/lib/viewer';
import { nowFromRequestContext } from '@/lib/clock';
import { isOrganizer } from '@/lib/policy';
import { loadBracketSummary, loadBracketTemplate, loadStartMondays } from '@/lib/queries/brackets';
import { IconTrophy } from '@/app/icons';
import { NewBracketView } from '../bracket-ui';

// /culture/brackets/new: the bracket setup form (the old BracketSetup), for culture organizers and admins
// (design §4.5: new brackets are organizer-managed). ?from=<id> prefills names, regions and entrants from
// that bracket ("Repeat next Monday"). Release 3: how it runs (weekly auto-advance, the default, or manual) and
// the start Monday (?mode=auto|manual and ?starts_on=YYYY-MM-DD preselect them).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'New bracket' };

export default async function NewBracketPage({ searchParams }) {
  const viewer = await requirePageViewer();
  if (!isOrganizer(viewer)) {
    return (
      <div>
        <div className="proj-head">
          <h1 className="wi-h"><IconTrophy size={24} /> New bracket</h1>
        </div>
        <div className="empty">
          <h3>Only culture organizers can start brackets</h3>
          <p>Ask an admin if you’d like to run the next one. You can still vote in the live bracket.</p>
          <Link className="btn btn-ink" href="/culture/brackets" prefetch={false}>Go to the bracket</Link>
        </div>
      </div>
    );
  }
  const now = nowFromRequestContext();
  const summary = await loadBracketSummary(viewer, now);
  const from = typeof searchParams?.from === 'string' ? searchParams.from : null;
  const template = from ? await loadBracketTemplate(from) : null;
  const starts = await loadStartMondays(now);
  const want = typeof searchParams?.starts_on === 'string' ? searchParams.starts_on : '';
  const pick = starts.mondays.find((m) => m.ymd === want && !m.taken)?.ymd
    || starts.mondays.find((m) => m.ymd === starts.free_monday)?.ymd
    || starts.mondays.find((m) => !m.taken)?.ymd || '';
  return (
    <NewBracketView
      isFirst={!summary}
      current={summary?.current ?? null}
      template={template}
      mode={searchParams?.mode === 'manual' ? 'manual' : 'auto'}
      mondays={starts.mondays}
      startsOn={pick}
    />
  );
}
