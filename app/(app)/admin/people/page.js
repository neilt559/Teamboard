import { notFound } from 'next/navigation';
import { requirePageViewer, tagUpdating } from '@/lib/viewer';
import { listPeopleAdmin, loadApprovalCounts } from '@/lib/queries/admin';
import AdminNav from '../_parts/AdminNav';
import PeopleAdmin from './PeopleAdmin';

// /admin/people (design §2.1): the admin side of "Names on tasks": link and unlink accounts, person or group,
// archive linked names, restore archived ones. Adding, renaming and recoloring live on /people/names.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Names on tasks (admin)' };

export default async function AdminPeoplePage() {
  const viewer = await requirePageViewer();
  if (!viewer.is_admin) notFound();
  let data;
  let counts;
  try {
    [data, counts] = await Promise.all([listPeopleAdmin(), loadApprovalCounts()]);
  } catch (e) {
    throw tagUpdating(e);
  }
  return (
    <div className="admin-page">
      <AdminNav active="people" pending={counts.total} />
      <PeopleAdmin initial={data} />
    </div>
  );
}
