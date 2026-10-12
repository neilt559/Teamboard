import { requirePageViewer, tagUpdating } from '@/lib/viewer';
import { loadSuggestions } from '@/lib/queries/suggestions';
import SuggestionsClient from './SuggestionsClient';

// /suggestions: the company-wide suggestion box (design §2.1; inventory §1.15). Everything the page shows is
// masked on the server (lib/queries/suggestions.js): anonymous authors never reach the browser.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Suggestions' };

export default async function SuggestionsPage() {
  const viewer = await requirePageViewer();
  let data;
  try {
    data = await loadSuggestions(viewer);
  } catch (e) {
    throw tagUpdating(e);
  }
  return <SuggestionsClient initial={data} tz={viewer.tz} />;
}
