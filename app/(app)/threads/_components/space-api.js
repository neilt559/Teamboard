import { api } from '@/app/_ui/api';

// The thread-space endpoints (design-amendments A5.5), for the client components. Plain module.
//   GET  /api/spaces/posts?space=&section=&before=&after=&limit=&parent_id=&changed_since=
//        -> { posts, has_more, server_time, changed? }   (parent_id: { parent, replies })
//   POST /api/spaces/posts { space, section, body, parent_id? }      -> the new post
//   PATCH /api/space-posts/:id { body, base: { body } } | { pinned } | { hidden } -> the stored post
//   DELETE /api/space-posts/:id                                      -> { ok: true }
//   POST /api/spaces/read { space, section }
// Answers are normalized here, so the components accept { post }, { row } or the bare object.

const asPost = (r) => {
  if (!r || typeof r !== 'object') return null;
  const p = r.post || r.row || r;
  if (!p || p.id == null) return null;
  return {
    ...p,
    id: String(p.id),
    parent_id: p.parent_id == null ? null : String(p.parent_id),
    replies: Array.isArray(p.replies) ? p.replies.map(asPost).filter(Boolean) : p.replies,
  };
};
const asPosts = (list) => (Array.isArray(list) ? list : []).map(asPost).filter(Boolean);

// One page of a section: { posts, has_more, server_time, changed }.
export async function fetchPage(space, section, { before = null, after = null, limit = null, changedSince = null } = {}) {
  const q = new URLSearchParams({ space, section });
  if (before != null) q.set('before', String(before));
  if (after != null) q.set('after', String(after));
  if (limit != null) q.set('limit', String(limit));
  if (changedSince) q.set('changed_since', String(changedSince));
  const r = await api(`/api/spaces/posts?${q}`, { quiet: true });
  const posts = asPosts(Array.isArray(r) ? r : r?.posts);
  return {
    posts,
    has_more: !!r?.has_more,
    server_time: r?.server_time || null,
    changed: Array.isArray(r?.changed) ? asPosts(r.changed) : [],
  };
}

// Every reply of one announcement, oldest first ("N replies" opened).
export async function fetchReplies(space, parentId) {
  const q = new URLSearchParams({ space, section: 'announcements', parent_id: String(parentId) });
  const r = await api(`/api/spaces/posts?${q}`, { quiet: true });
  return { parent: asPost(r?.parent), replies: asPosts(r?.replies) };
}

export async function createPost(space, section, body, parentId = null) {
  const payload = { space, section, body };
  if (parentId != null) payload.parent_id = String(parentId);
  return asPost(await api('/api/spaces/posts', { method: 'POST', body: payload }));
}

export async function editPost(id, body, base) {
  return asPost(await api(`/api/space-posts/${id}`, { method: 'PATCH', body: { body, base: { body: base } } }));
}

export async function setPostFlag(id, flag, on) {
  return asPost(await api(`/api/space-posts/${id}`, { method: 'PATCH', body: { [flag]: !!on } }));
}

export async function deletePost(id) {
  const r = await api(`/api/space-posts/${id}`, { method: 'DELETE' });
  return asPost(r?.post);
}

export async function markRead(space, section) {
  return api('/api/spaces/read', { method: 'POST', body: { space, section }, quiet: true });
}

export const MAX_BODY = 10_000;

// Which posts were new to the viewer when the section opened: its unread count, applied to the newest posts by
// other people that count as unread (not removed, not hidden). Unread counts posts after the viewer's last read
// of this section, so this marks the same ones without another request.
export function newPostIds(posts, unread) {
  const n = Number(unread) || 0;
  if (n <= 0) return new Set();
  const all = [];
  for (const p of posts || []) {
    all.push(p);
    if (Array.isArray(p.replies)) all.push(...p.replies);
  }
  const cand = all.filter((p) => p && !p.mine && !p.removed && !p.hidden && p.created_at)
    .sort((a, b) => (Date.parse(b.created_at) - Date.parse(a.created_at)) || (Number(b.id) - Number(a.id)));
  return new Set(cand.slice(0, n).map((p) => String(p.id)));
}
