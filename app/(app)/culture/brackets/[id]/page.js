import { notFound, redirect } from 'next/navigation';
import { requirePageViewer, publicViewer } from '@/lib/viewer';
import { loadBracket } from '@/lib/queries/brackets';
import { PastBracketView } from '../bracket-ui';

// /culture/brackets/[id]: any bracket that isn't soft-deleted, read-only (the old PastBracket view). The
// current bracket lives at /culture/brackets, so its id redirects there. Missing or deleted: 404.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Bracket' };

export default async function BracketPage({ params }) {
  const viewer = await requirePageViewer();
  if (!/^[0-9]{1,18}$/.test(String(params.id))) notFound();
  const d = await loadBracket(viewer, String(params.id));
  if (!d) notFound();
  if (d.is_current) redirect('/culture/brackets');
  return <PastBracketView initial={d} viewer={publicViewer(viewer)} />;
}
