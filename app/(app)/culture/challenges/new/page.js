import Link from 'next/link';
import { requirePageViewer } from '@/lib/viewer';
import { nowFromRequestContext } from '@/lib/clock';
import { isOrganizer } from '@/lib/policy';
import { chicagoToday } from '@/lib/time';
import { monthRange } from '@/lib/challenges';
import { listChallengeOffices } from '@/lib/queries/challenges';
import { listCookChoices } from '@/lib/queries/chili';
import { IconMedal } from '@/app/icons';
import ChallengeForm from '../_components/ChallengeForm';

// /culture/challenges/new: set up a challenge (design §10(a) "Configuration"; agent K1). Culture organizers and
// admins; everyone else gets a short explanation (the API refuses them too). Dates default to this calendar month
// in Central.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'New challenge' };

export default async function NewChallengePage() {
  const viewer = await requirePageViewer();
  if (!isOrganizer(viewer)) {
    return (
      <div>
        <div className="proj-head">
          <h1 className="wi-h"><IconMedal size={24} /> New challenge</h1>
        </div>
        <div className="empty">
          <h3>Only culture organizers can set up challenges</h3>
          <p>Ask an admin if you’d like to run one. You can still log your stats in the current challenge.</p>
          <Link className="btn btn-ink" href="/culture/challenges" prefetch={false}>See the challenges</Link>
        </div>
      </div>
    );
  }
  const today = chicagoToday(nowFromRequestContext());
  const [offices, cooks] = await Promise.all([listChallengeOffices(), listCookChoices()]);
  return <ChallengeForm mode="new" defaults={monthRange(today)} offices={offices} today={today} cooks={cooks} homeOfficeId={viewer.office_id || ''} />;
}
