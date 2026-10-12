import { requirePageViewer } from '@/lib/viewer';
import { listBracketsForAdmin } from '@/lib/queries/brackets';
import BracketsAdminList from '../../culture/brackets/BracketsAdminList';

// /admin "Brackets" section (design §2.1, §10(c) "Admin restore"): soft-deleted brackets with Restore
// (PATCH {deleted:false}) and archived brackets with Un-archive (PATCH {archived:false}, refused while a
// different bracket is live). Also the recovery path after a Release 3 rollback (§16).
// An async Server Component: render it from the server page, e.g. <BracketsAdmin viewer={viewer} />.
// It renders nothing for non-admins (the page is 404 for them anyway; the API checks again).
export default async function BracketsAdmin({ viewer } = {}) {
  const v = viewer || await requirePageViewer();
  if (!v?.is_admin) return null;
  const data = await listBracketsForAdmin();
  return <BracketsAdminList data={data} tz={viewer?.tz} />;
}
