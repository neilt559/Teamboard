import { notFound } from 'next/navigation';
import { requirePageViewer, publicViewer, tagUpdating } from '@/lib/viewer';
import { loadAccountsPage, loadApprovalCounts } from '@/lib/queries/admin';
import AdminNav from '../_parts/AdminNav';
import AccountsView from './accounts-ui';

// /admin/users (design §2.1): today's Accounts page plus profile columns, identity "Verify", name and email
// edits, organizer flag, disable, extra offices, "Clear sign-in lock" and the legacy-access tools (§6).
// ?user=<id> opens that account's editor (the approval queue's "Edit…" links here).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Accounts' };

export default async function AdminUsersPage({ searchParams }) {
  const viewer = await requirePageViewer();
  if (!viewer.is_admin) notFound();
  let data;
  let counts;
  try {
    [data, counts] = await Promise.all([loadAccountsPage(), loadApprovalCounts()]);
  } catch (e) {
    throw tagUpdating(e);
  }
  const open = typeof searchParams?.user === 'string' && /^[0-9]{1,18}$/.test(searchParams.user) ? searchParams.user : null;
  return (
    <div className="admin-page">
      <AdminNav active="users" pending={counts.total} />
      <AccountsView me={publicViewer(viewer)} initial={data} openUserId={open} />
    </div>
  );
}
