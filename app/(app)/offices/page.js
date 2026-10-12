import { requirePageViewer, publicViewer, tagUpdating } from '@/lib/viewer';
import { listOffices } from '@/lib/queries/offices';
import { nowFromRequestContext } from '@/lib/clock';
import OfficesIndex from './OfficesIndex';

// All offices (design §2.1): every active office as a card with people count, local time, team names and
// "your projects here: N" (visible projects only), "Your office" / "Following" badges and a follow toggle.
// Office information is company-public; the counts are filtered per viewer. Replaces the old Home office grid
// (HomeView + workCounts, inventory §1.10); Home itself is the dashboard now.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Offices' };

export default async function OfficesPage() {
  const viewer = await requirePageViewer();
  let data;
  try {
    data = await listOffices(viewer);
  } catch (e) {
    throw tagUpdating(e);
  }
  return <OfficesIndex viewer={publicViewer(viewer)} data={data} now={nowFromRequestContext()} />;
}
