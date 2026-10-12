import { requirePageViewer, tagUpdating } from '@/lib/viewer';
import { listDirectory } from '@/lib/queries/people';
import Directory from './Directory';

// /people: the company directory (design §2.1). Company-public; zz_ test accounts and disabled accounts
// are left out (rule 51).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'People' };

const idParam = (v) => (typeof v === 'string' && /^[0-9]{1,18}$/.test(v) ? v : '');

export default async function PeoplePage({ searchParams }) {
  await requirePageViewer();
  let data;
  try {
    data = await listDirectory();
  } catch (e) {
    throw tagUpdating(e);
  }
  const sp = searchParams || {};
  const initialFilters = {
    q: typeof sp.q === 'string' ? sp.q.slice(0, 100) : '',
    office: idParam(sp.office),
    dept: idParam(sp.dept),
    team: idParam(sp.team),
    position: idParam(sp.position),
  };
  return <Directory data={data} initialFilters={initialFilters} />;
}
