import { handle } from '@/lib/http';
import { adminClaimAllowed, activeAdminExists } from '@/lib/queries/admin';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// The hidden Admin entrance asks this (rule 43). { isAdmin, canClaim }: canClaim is true only when
// TB_ALLOW_ADMIN_CLAIM=1 and no active admin exists, so with the flag off (always, on Vercel) it never
// reveals whether an admin exists (§13 #6). The old { adminExists } field is gone on purpose.
export const GET = handle(async ({ viewer }) => {
  const isAdmin = !!viewer.is_admin;
  const canClaim = !isAdmin && adminClaimAllowed() && !(await activeAdminExists());
  return { isAdmin, canClaim };
}, { allowIncomplete: true });
