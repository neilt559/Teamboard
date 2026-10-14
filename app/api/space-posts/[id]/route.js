import { handle } from '@/lib/http';
import { patchPost, deletePost } from '@/lib/queries/spaces';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// PATCH /api/space-posts/:id (design-amendments A5.4, A5.5)
//   { body, base: { body } }  the author edits (base-compared through lib/patch.js: 409 { error: 'conflict',
//                             message, fields: ['body'], current: <post> } when the stored text moved on)
//   { pinned }                moderators pin / unpin a top-level announcement
//   { hidden }                moderators hide / unhide any post (audited)
// -> { ok, row, post } (the stored post, shaped like the lists). A post that is missing, deleted, hidden from this
// viewer or in a space they can't read is 404 'gone'; someone else's post 403; an archived office or team 409.
export const PATCH = handle(async ({ viewer, params, body, now }) => {
  const post = await patchPost({ viewer, id: params.id, body: await body(), now });
  return { ok: true, row: post, post };
}, { maxBody: 200_000 });

// DELETE /api/space-posts/:id: the author's soft delete (nothing is ever removed from the database). Missing or
// not readable -> { ok: true }; someone else's -> 403; archived office or team -> 409. -> { ok[, post] }
export const DELETE = handle(async ({ viewer, params }) => deletePost(viewer, params.id));
