import { notFound } from 'next/navigation';
import { requirePageViewer, tagUpdating } from '@/lib/viewer';
import { listApprovals } from '@/lib/queries/admin';
import { IconCheck } from '@/app/icons';
import AdminNav from '../_parts/AdminNav';
import ApprovalQueue from './ApprovalQueue';

// /admin/approvals (design §5.5): one list, oldest first. Position requests, office changes, name links and
// identity checks, each with a plain-English consequence computed on the server.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Approvals' };

export default async function AdminApprovalsPage() {
  const viewer = await requirePageViewer();
  if (!viewer.is_admin) notFound();
  let data;
  try {
    data = await listApprovals();
  } catch (e) {
    throw tagUpdating(e);
  }
  return (
    <div className="admin-page">
      <AdminNav active="approvals" pending={data.counts.total} />
      <div className="proj-head">
        <h1 className="wi-h"><IconCheck size={24} /> Approvals</h1>
        <span className="progress-label">Oldest first. Each decision applies only to what you see here.</span>
      </div>
      <ApprovalQueue initial={data} tz={viewer.tz} />
    </div>
  );
}
