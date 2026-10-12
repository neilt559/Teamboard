import { notFound } from 'next/navigation';
import { requirePageViewer, tagUpdating } from '@/lib/viewer';
import { loadOrg, loadApprovalCounts } from '@/lib/queries/admin';
import AdminNav from '../_parts/AdminNav';
import OrgAdmin from './OrgAdmin';

// /admin/org (design §2.1): offices (rename, reorder, time zone, archive, delete with the GeoGuessr guard),
// teams in every office (rename, move, reorder, archive, delete, "give this team's members all of its
// projects"), departments and positions with their levels.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Organization' };

export default async function AdminOrgPage() {
  const viewer = await requirePageViewer();
  if (!viewer.is_admin) notFound();
  let data;
  let counts;
  try {
    [data, counts] = await Promise.all([loadOrg(), loadApprovalCounts()]);
  } catch (e) {
    throw tagUpdating(e);
  }
  return (
    <div className="admin-page">
      <AdminNav active="org" pending={counts.total} />
      <OrgAdmin initial={data} />
    </div>
  );
}
