import { notFound, redirect } from 'next/navigation';
import { requirePageViewer, publicViewer } from '@/lib/viewer';
import { nowFromRequestContext } from '@/lib/clock';
import { loadBracket, loadStartMondays } from '@/lib/queries/brackets';
import { isOrganizer } from '@/lib/policy';
import { PastBracketView } from '../bracket-ui';

// /culture/brackets/[id]: any bracket that isn't soft-deleted, read-only (the old PastBracket view); an upcoming
// weekly bracket shows when it starts, and organizers can still fix its names, move its start or delete it. The
// current bracket lives at /culture/brackets, so its id redirects there (an upcoming one whose Monday has come
// activates on this load and redirects too). Missing or deleted: 404.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Bracket' };

export default async function BracketPage({ params }) {
  const viewer = await requirePageViewer();
  if (!/^[0-9]{1,18}$/.test(String(params.id))) notFound();
  const now = nowFromRequestContext();
  const d = await loadBracket(viewer, String(params.id), now);
  if (!d) notFound();
  if (d.is_current) redirect('/culture/brackets');
  const b = d.bracket;
  const upcoming = b.mode === 'auto' && !b.activated_at && !b.archived;
  const mondays = upcoming && isOrganizer(viewer) ? (await loadStartMondays(now)).mondays : null;
  return <PastBracketView initial={d} viewer={publicViewer(viewer)} mondays={mondays} />;
}
