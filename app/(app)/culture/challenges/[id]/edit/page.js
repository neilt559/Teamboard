import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePageViewer } from '@/lib/viewer';
import { nowFromRequestContext } from '@/lib/clock';
import { isOrganizer } from '@/lib/policy';
import { chicagoToday } from '@/lib/time';
import { listChallengeOffices, loadChallengeRow } from '@/lib/queries/challenges';
import { IconMedal } from '@/app/icons';
import ChallengeForm from '../../_components/ChallengeForm';

// /culture/challenges/[id]/edit: change a challenge (design §10(a); agent K1). Culture organizers and admins; the
// form is a draft editor (base frozen on open, 409 shows the other version). Others get a short explanation.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Edit challenge' };

export default async function EditChallengePage({ params }) {
  const viewer = await requirePageViewer();
  if (!/^[0-9]{1,18}$/.test(String(params.id))) notFound();
  if (!isOrganizer(viewer)) {
    return (
      <div>
        <div className="proj-head">
          <h1 className="wi-h"><IconMedal size={24} /> Edit challenge</h1>
        </div>
        <div className="empty">
          <h3>Only culture organizers can change challenges</h3>
          <p>You can still log your stats and follow the leaderboards.</p>
          <Link className="btn btn-ink" href={`/culture/challenges/${params.id}`} prefetch={false}>Back to the challenge</Link>
        </div>
      </div>
    );
  }
  const challenge = await loadChallengeRow(params.id);
  if (!challenge) notFound();
  const offices = await listChallengeOffices(challenge.office_id, challenge.kind === 'bingo' ? challenge.id : null);
  return <ChallengeForm key={challenge.updated_at || challenge.id} mode="edit" challenge={challenge} offices={offices}
    today={chicagoToday(nowFromRequestContext())} />;
}
