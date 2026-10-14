import { handle } from '@/lib/http';
import { requireSpace, listPosts, createPost } from '@/lib/queries/spaces';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/spaces/posts?space=<key>&section=announcements|chat&before=<id>&after=<id>&limit=
//   [&parent_id=<announcement id>][&changed_since=<ISO time>]   (design-amendments A5.5)
// -> { space, section, posts, has_more, server_time[, changed] }; with parent_id: { space, section, parent,
//    replies, server_time }. Announcements: newest first, pinned first on the first page, each with reply_count and
//    its last 3 replies. Chat: oldest first, pages of 50 (after = polling, before = "Load earlier").
// A space the viewer can't read is the same 404 as a missing one. Shapes: lib/queries/spaces.js shapePost.
export const GET = handle(async ({ req, viewer }) => {
  const q = new URL(req.url).searchParams;
  const sp = await requireSpace(viewer, q.get('space'));
  return listPosts(viewer, sp, q.get('section'), {
    before: q.get('before'), after: q.get('after'), limit: q.get('limit'),
    parent_id: q.get('parent_id'), changed_since: q.get('changed_since'),
  });
});

// POST /api/spaces/posts { space, section: 'announcements' | 'chat', body, parent_id? } -> { ok, id, post }
// Anyone who can read the space posts and replies (replies: announcements only). 400 for a blank or > 10,000
// character body, 404 for a space the viewer can't read, 409 for an archived office or team (admins excepted).
export const POST = handle(async ({ viewer, body }) => {
  const post = await createPost(viewer, await body());
  return { ok: true, id: post?.id ?? null, post };
}, { maxBody: 200_000 });
