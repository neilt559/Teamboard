'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ConflictError } from '@/app/_ui/api';
import useServerState, { mergeById } from '@/app/_ui/useServerState';
import { useRefreshOnFocus } from '@/app/_ui/useRefresh';
import { IconAlert } from '@/app/icons';
import SuggestionsView from './suggestions-ui';

// One Suggestions/Announcements board's state and writes (design-amendments A10). The handlers talk to
// /api/suggestions with the new client (X-TB-Client: 2). Optimistic where the old box was (status, +1, deletes,
// hides); posts and replies wait for the server, then the page refreshes (design §7.5: after your own write,
// router.refresh(); refresh on focus).
//   initial = loadBoard()'s { board, suggestions, replies, canStatus, statusOpen, isAdmin, isOrganizer, canPost,
//   since }; boards = the switcher's list; now = the server's clock (the 14-day announcement window and "Today").
export default function SuggestionsClient({ initial, boards = [], tz, now }) {
  const router = useRouter();
  const [data, setData] = useServerState(initial);
  const [error, setError] = useState(null);
  // The previous visit, frozen when the page opened: the refresh after marking the board read must not take the
  // "Unread" chips away while the person is looking at them.
  const [since] = useState(() => initial?.since || null);
  useRefreshOnFocus(30_000);

  const board = data.board || initial.board;
  const refresh = () => router.refresh();
  const fail = (e, reload = true) => {
    setError(e?.message || 'Something went wrong — please try again.');
    if (reload) refresh();
  };
  const ok = () => setError(null);

  const patchLocal = (id, patch) => setData((d) => ({
    ...d, suggestions: d.suggestions.map((s) => (String(s.id) === String(id) ? { ...s, ...patch } : s)),
  }));
  // Adopt the stored row a PATCH returns (already masked by the server).
  const adopt = (row) => {
    if (!row || row.id == null) return;
    setData((d) => ({ ...d, suggestions: mergeById(d.suggestions, row) }));
  };

  async function addPost(p) {
    try {
      const row = await api('/api/suggestions', { method: 'POST', body: { ...p, space: board.key } });
      if (row && row.id != null && row.title != null) {
        setData((d) => ({ ...d, suggestions: [row, ...d.suggestions.filter((s) => String(s.id) !== String(row.id))] }));
      }
      ok();
      refresh();
      return true;
    } catch (e) { fail(e, false); return false; }
  }
  async function patchPost(id, patch) {
    patchLocal(id, patch);
    try {
      const r = await api(`/api/suggestions/${id}`, { method: 'PATCH', body: patch });
      adopt(r?.row);
      ok();
      return true;
    } catch (e) { fail(e); return false; }
  }
  // The author's edit form: only the changed fields, plus the title/details it opened with as the base.
  async function editPost(id, changes, base) {
    const body = { ...changes };
    const b = {};
    if ('title' in changes) b.title = base.title;
    if ('details' in changes) b.details = base.details;
    if (Object.keys(b).length) body.base = b;
    try {
      const r = await api(`/api/suggestions/${id}`, { method: 'PATCH', body });
      adopt(r?.row);
      ok();
      refresh();
      return true;
    } catch (e) {
      if (e instanceof ConflictError) { if (e.current) adopt({ ...e.current, id }); return { conflict: e }; }
      fail(e);
      return false;
    }
  }
  async function deletePost(id) {
    setData((d) => ({
      ...d,
      suggestions: d.suggestions.filter((s) => String(s.id) !== String(id)),
      replies: d.replies.filter((r) => String(r.suggestion_id) !== String(id)),
    }));
    try { await api(`/api/suggestions/${id}`, { method: 'DELETE' }); ok(); refresh(); }
    catch (e) { fail(e); }
  }
  async function votePost(id, on) {
    setData((d) => ({
      ...d,
      suggestions: d.suggestions.map((s) => (String(s.id) === String(id) && !!s.voted !== on
        ? { ...s, voted: on, votes: s.votes + (on ? 1 : -1) } : s)),
    }));
    try {
      const r = await api(`/api/suggestions/${id}/vote`, { method: 'POST', body: { on } });
      if (r && typeof r.votes === 'number') {
        setData((d) => ({
          ...d,
          suggestions: d.suggestions.map((s) => (String(s.id) === String(id) && !!s.voted === on ? { ...s, votes: r.votes } : s)),
        }));
      }
      ok();
    } catch (e) { fail(e); }
  }
  async function replyPost(id, body) {
    try {
      const row = await api(`/api/suggestions/${id}/replies`, { method: 'POST', body: { body } });
      if (row && row.id != null && row.body != null) {
        setData((d) => ({ ...d, replies: [...d.replies.filter((r) => String(r.id) !== String(row.id)), row] }));
      }
      ok();
      refresh();
      return true;
    } catch (e) { fail(e, false); return false; }
  }
  async function deleteReply(id) {
    setData((d) => ({ ...d, replies: d.replies.filter((r) => String(r.id) !== String(id)) }));
    try { await api(`/api/suggestion-replies/${id}`, { method: 'DELETE' }); ok(); refresh(); }
    catch (e) { fail(e); }
  }
  // Moderation: suggestions admins; announcements admins and culture organizers (the API decides).
  async function hidePost(id, hidden) {
    patchLocal(id, { hidden });
    try {
      const r = await api(`/api/suggestions/${id}`, { method: 'PATCH', body: { hidden } });
      adopt(r?.row);
      ok();
      refresh();
    } catch (e) { fail(e); }
  }
  async function hideReply(id, hidden) {
    setData((d) => ({ ...d, replies: d.replies.map((r) => (String(r.id) === String(id) ? { ...r, hidden } : r)) }));
    try { await api(`/api/suggestion-replies/${id}`, { method: 'PATCH', body: { hidden } }); ok(); refresh(); }
    catch (e) { fail(e); }
  }

  return (
    <div className="sg-page sgb-page">
      {error && (
        <div className="banner sg-banner" role="alert">
          <IconAlert size={16} />
          <span>{error}</span>
          <span className="spacer" />
          <button type="button" className="btn btn-plain btn-sm" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
      <SuggestionsView
        board={board}
        boards={boards}
        suggestions={data.suggestions}
        replies={data.replies}
        tz={tz}
        now={now}
        since={since}
        canStatus={data.canStatus}
        statusOpen={data.statusOpen}
        isAdmin={data.isAdmin}
        isOrganizer={data.isOrganizer}
        canPost={data.canPost}
        onAdd={addPost}
        onPatch={patchPost}
        onEdit={editPost}
        onDelete={deletePost}
        onVote={votePost}
        onReply={replyPost}
        onDeleteReply={deleteReply}
        onHide={hidePost}
        onHideReply={hideReply}
        onRefresh={refresh}
      />
    </div>
  );
}
