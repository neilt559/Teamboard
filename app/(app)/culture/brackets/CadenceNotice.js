import Link from 'next/link';
import { IconCalendar } from '@/app/icons';
import { fmtStart } from './format';

// The organizer warning (design §10(c) "Keeping the Monday cadence"): from Wednesday on, when no weekly bracket
// starts next Monday, organizers and admins see this on Home and /culture. Everyone else: nothing. Nothing is
// ever created for them: both links open the setup form.
export default function CadenceNotice({ cadence }) {
  if (!cadence || !cadence.next_monday || cadence.warn === false) return null;
  const day = fmtStart(cadence.next_monday);
  const base = `/culture/brackets/new?mode=auto&starts_on=${encodeURIComponent(cadence.next_monday)}`;
  return (
    <div className="bk-cadence" role="status">
      <IconCalendar size={16} />
      <span>Nothing is scheduled for <b>{day}</b>.</span>
      <span className="bk-cadence-links">
        <Link href={base} prefetch={false}>Schedule a bracket</Link>
        {cadence.repeat_id && <> · <Link href={`${base}&from=${encodeURIComponent(cadence.repeat_id)}`} prefetch={false}>Repeat this week’s</Link></>}
      </span>
    </div>
  );
}

