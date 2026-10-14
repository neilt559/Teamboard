import { requirePageViewer } from '@/lib/viewer';
import BoardScreen, { boardMetadata } from './BoardScreen';

// /suggestions: the CAGE Suggestions/Announcements board, everyone's (design-amendments A10.1). Every office has
// its own at /suggestions/office/[officeId]; the switcher at the top moves between them. Every /threads address
// redirects here (or to the office's board).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export async function generateMetadata() {
  return boardMetadata('company');
}

export default async function SuggestionsPage() {
  const viewer = await requirePageViewer();
  return <BoardScreen viewer={viewer} boardKey="company" />;
}
