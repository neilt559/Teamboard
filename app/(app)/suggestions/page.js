import { redirect } from 'next/navigation';
import { requirePageViewer } from '@/lib/viewer';

// /suggestions: Release 2 moved the suggestion box into the thread spaces (design-amendments A5.6): every space
// (CAGE, each office, each team) has a Suggestions tab, and the four existing suggestions now live in the Charlotte
// office space. The old address goes to the space list. SuggestionsClient and suggestions-ui.js (this folder)
// render the Suggestions tab (app/(app)/threads/_components/SpaceScreen.js).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export default async function SuggestionsPage() {
  await requirePageViewer();
  redirect('/threads');
}
