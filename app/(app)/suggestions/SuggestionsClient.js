'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ConflictError } from '@/app/_ui/api';
import useServerState, { mergeById } from '@/app/_ui/useServerState';
import { useRefreshOnFocus } from '@/app/_ui/useRefresh';
import { IconAlert } from '@/app/icons';
import SuggestionsView from './suggestions-ui';

// The page-local handlers the old single page held for the suggestion box (page.js:404-438), now talking to
// the same endpoints with the new client (X-TB-Client: 2). Optimistic where they were optimistic (status,
// +1, deletes); creates and replies wait for the server, then the page refreshes (design §7.5: after your
// own write, router.refresh(); refresh on focus).
export default function SuggestionsClient({ initial, tz }) {
  const router = useRouter();
  const [data, setData] = useServerState(initial);
  const [error, setError] = useState(null);
  useRefreshOnFocus(30_000);

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

  async function addSuggestion(p) {
    try {
      const row = await api('/api/suggestions', { method: 'POST', body: p });
      if (row && row.id != null && row.title != null) {
        setData((d) => ({ ...d, suggestions: [row, ...d.suggestions.filter((s) => String(s.id) !== String(row.id))] }));
      }
      ok();
      refresh();
      return true;
    } catch (e) { fail(e, false); return false; }
  }
  async function patchSuggestion(id, patch) {
    patchLocal(id, patch);
    try {
      const r = await api(`/api/suggestions/${id}`, { method: 'PATCH', body: patch });
      adopt(r?.row);
      ok();
      return true;
    } catch (e) { fail(e); return false; }
  }
  // The author's edit form: only the changed fields, plus the title/details it opened with as the base.
  async function editSuggestion(id, changes, base) {
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
  async function deleteSuggestion(id) {
    setData((d) => ({
      ...d,
      suggestions: d.suggestions.filter((s) => String(s.id) !== String(id)),
      replies: d.replies.filter((r) => String(r.suggestion_id) !== String(id)),
    }));
    try { await api(`/api/suggestions/${id}`, { method: 'DELETE' }); ok(); refresh(); }
    catch (e) { fail(e); }
  }
  async function voteSuggestion(id, on) {
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
  async function replySuggestion(id, body) {
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
  // Admin moderation.
  async function hideSuggestion(id, hidden) {
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
    <div className="sg-page">
      {error && (
        <div className="banner sg-banner" role="alert">
          <IconAlert size={16} />
          <span>{error}</span>
          <span className="spacer" />
          <button type="button" className="btn btn-plain btn-sm" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
      <SuggestionsView
        suggestions={data.suggestions}
        replies={data.replies}
        tz={tz}
        canStatus={data.canStatus}
        statusOpen={data.statusOpen}
        isAdmin={data.isAdmin}
        onAdd={addSuggestion}
        onPatch={patchSuggestion}
        onEdit={editSuggestion}
        onDelete={deleteSuggestion}
        onVote={voteSuggestion}
        onReply={replySuggestion}
        onDeleteReply={deleteReply}
        onHide={hideSuggestion}
        onHideReply={hideReply}
        onRefresh={refresh}
      />
    </div>
  );
}
