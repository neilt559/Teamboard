import { handle } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/auth/me: the signed-in user, or { user: null } (public; never a 401). Today's fields { id, username,
// is_admin, must_change } plus the profile basics new pages use. Nothing private beyond the viewer's own data.
export const GET = handle(async ({ viewer: v }) => ({
  user: v ? {
    id: v.id, username: v.username, name: v.name, display_name: v.display_name, is_admin: v.is_admin,
    is_organizer: v.is_organizer, must_change: v.must_change, profile_done: v.profile_done,
    identity_verified: v.identity_verified, level: v.level, person_id: v.person_id,
  } : null,
}), { auth: 'optional' });
