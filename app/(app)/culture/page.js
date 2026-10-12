import { requirePageViewer } from '@/lib/viewer';
import { nowFromRequestContext } from '@/lib/clock';
import { loadCultureHub } from '@/lib/queries/brackets';
import { IconTrophy } from '@/app/icons';
import { BracketCard } from '../_widgets/BracketWidget';
import GeoWidget from '../_widgets/GeoWidget';

// /culture: the Culture hub (design §2.1, §10). Release 1 cards: the bracket and GeoGuessr. Release 3 adds the
// monthly challenge, upcoming events, past challenges and the organizer "nothing scheduled" warning; until
// then those are left out rather than shown as placeholders. Cards stack on phones.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Culture' };

export default async function CulturePage() {
  const viewer = await requirePageViewer();
  const hub = await loadCultureHub(viewer, nowFromRequestContext());
  return (
    <div className="culture-hub">
      <div className="proj-head">
        <h1 className="wi-h"><IconTrophy size={24} /> Culture</h1>
      </div>
      <p className="cu-intro">The fun side of TeamBoard: vote in the bracket and post your office’s daily GeoGuessr score.</p>
      <div className="home-grid cu-cards">
        <BracketCard summary={hub.bracket} />
        <GeoWidget />
      </div>
    </div>
  );
}
