import Link from 'next/link';
import { requirePageViewer } from '@/lib/viewer';
import { nowFromRequestContext } from '@/lib/clock';
import { isOrganizer } from '@/lib/policy';
import { loadBracketSummary, loadBracketTemplate } from '@/lib/queries/brackets';
import { IconTrophy } from '@/app/icons';
import { NewBracketView } from '../bracket-ui';

// /culture/brackets/new: the bracket setup form (the old BracketSetup), for culture organizers and admins
// (design §4.5: new brackets are organizer-managed). ?from=<id> prefills names, regions and entrants from
// that bracket. Release 3 adds the mode picker (weekly auto-advance) and the start Monday.
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
  const summary = await loadBracketSummary(viewer, nowFromRequestContext());
  const from = typeof searchParams?.from === 'string' ? searchParams.from : null;
  const template = from ? await loadBracketTemplate(from) : null;
  return (
    <NewBracketView
      isFirst={!summary}
      current={summary?.current ?? null}
      template={template}
    />
  );
}
