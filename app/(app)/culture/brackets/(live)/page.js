import { requirePageViewer, publicViewer } from '@/lib/viewer';
import { nowFromRequestContext } from '@/lib/clock';
import { loadBrackets } from '@/lib/queries/brackets';
import BracketView from '../bracket-ui';

// /culture/brackets: the live bracket (vote, crown, undo, edit names and notes), upcoming brackets (Release 3)
// and Past brackets (design §2.1, §10(c)). Everyone votes; crowning, undo and edits follow the bracket's
// crown_policy. The page polls GET /api/brackets/current every 15 s while a round is open (§7.5).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Brackets' };

export default async function BracketsPage() {
  const viewer = await requirePageViewer();
  const data = await loadBrackets(viewer, nowFromRequestContext());
  return <BracketView initial={data} viewer={publicViewer(viewer)} />;
}
