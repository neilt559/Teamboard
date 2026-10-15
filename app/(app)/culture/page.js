import { requirePageViewer } from '@/lib/viewer';
import { nowFromRequestContext } from '@/lib/clock';
import { loadCultureHub } from '@/lib/queries/brackets';
import { IconTrophy } from '@/app/icons';
import { BracketCard, BracketCadenceNotice } from '../_widgets/BracketWidget';
import GeoWidget from '../_widgets/GeoWidget';
import { ChallengeHubCards } from '../_widgets/ChallengeWidget';   // Release 3 (K1): current + past challenges

// /culture: the Culture hub (design §2.1, §10): the monthly challenge, the bracket, GeoGuessr
// and past challenges, plus (organizers only) the "nothing scheduled for next Monday" bracket warning. Cards
// stack on phones.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Culture' };

export default async function CulturePage() {
  const viewer = await requirePageViewer();
  const now = nowFromRequestContext();
  const hub = await loadCultureHub(viewer, now);
  return (
    <div className="culture-hub">
      <div className="proj-head">
        <h1 className="wi-h"><IconTrophy size={24} /> Culture</h1>
      </div>
      <p className="cu-intro">The fun side of TeamBoard: log your stats in the monthly challenge, vote in the bracket and post your office’s daily GeoGuessr score.</p>
      <BracketCadenceNotice viewer={viewer} now={now} />
      <div className="home-grid cu-cards">
        <ChallengeHubCards viewer={viewer} now={now} part="current" />
        <BracketCard summary={hub.bracket} />
        <GeoWidget />
        <ChallengeHubCards viewer={viewer} now={now} part="past" />
      </div>
    </div>
  );
}
