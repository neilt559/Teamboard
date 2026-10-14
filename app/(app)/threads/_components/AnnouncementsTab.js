'use client';
import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FormattedNotes, NotesEditor } from '@/app/notes-format';
import { ConflictError } from '@/app/_ui/api';
import { DraftConflict } from '@/app/_ui/ConflictNotice';
import { useConfirm } from '@/app/_ui/ConfirmDialog';
import useServerState from '@/app/_ui/useServerState';
import { useRefreshOnFocus } from '@/app/_ui/useRefresh';
import { IconAlert, IconBell, IconChat, IconPencil } from '@/app/icons';
import MoreMenu from '../../offices/_ui/MoreMenu';
import { PostByline, postActions, useNow, useAutoGrow, InlineEdit, mapPosts } from './PostParts';
import {
  createPost, editPost, setPostFlag, deletePost, fetchPage, fetchReplies, newPostIds, MAX_BODY,
} from './space-api';

// Announcements (design-amendments A5.6): composer at the top ("Post an announcement"), posts newest first with
// pinned ones on top, bodies in Neil's notes markup with clickable links, and "N replies" opening the replies and
// a reply box. Authors edit (base-compare) and delete their own; moderators pin and hide.
// initial = GET /api/spaces/posts's first page from the server ({ posts (each with its latest 3 replies),
// has_more }); writes adopt what the API returns, then the page refreshes (design §7.5).

const tooLong = (s) => s.length > MAX_BODY;
const longMsg = (s) => `That’s too long (${s.length.toLocaleString('en-US')} of ${MAX_BODY.toLocaleString('en-US')} characters).`;
const byNewest = (a, b) => (Number(!!b.pinned) - Number(!!a.pinned))
  || (Date.parse(b.created_at) - Date.parse(a.created_at)) || (Number(b.id) - Number(a.id));

function Composer({ space, onPost }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [n, setN] = useState(0);                       // remounts the editor after a post
  if (!open) {
    return (
      <button type="button" className="sp-compose-open" onClick={() => setOpen(true)}>
        <IconPencil size={16} /> <span>Post an announcement</span>
      </button>
    );
  }
  const submit = async () => {
    const body = text.replace(/\s+$/, '');
    if (!body.trim()) { setErr('Write something first.'); return; }
    if (tooLong(body)) { setErr(longMsg(body)); return; }
    setBusy(true);
    setErr('');
    const ok = await onPost(body);
    setBusy(false);
    if (ok === true) { setText(''); setN((x) => x + 1); setOpen(false); } else setErr(ok || 'Couldn’t post — please try again.');
  };
  return (
    <div className="sp-composer" role="group" aria-label="Post an announcement">
      <div className="sp-composer-h">Post an announcement to {space.name}</div>
      <NotesEditor key={n} value="" onChange={setText} placeholder="What should everyone here know?" />
      {err && <div className="sp-err" role="alert">{err}</div>}
      <div className="sp-composer-actions">
        <button type="button" className="btn btn-plain" onClick={() => { setOpen(false); setErr(''); }} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-lime" onClick={submit} disabled={busy || !text.trim()}>{busy ? 'Posting…' : 'Post announcement'}</button>
      </div>
    </div>
  );
}

// The author's editor for a whole announcement: the notes editor, base frozen when Edit opens (§7.4).
function AnnouncementEdit({ post, onSave, onCancel }) {
  const [text, setText] = useState(post.body || '');
  const [base, setBase] = useState(post.body || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [conflict, setConflict] = useState(null);
  const save = async (b = base) => {
    const body = text.replace(/\s+$/, '');
    if (!body.trim()) { setErr('An announcement can’t be empty — delete it instead.'); return; }
    if (tooLong(body)) { setErr(longMsg(body)); return; }
    if (body === b) { onCancel(); return; }
    setBusy(true);
    setErr('');
    try { await onSave(body, b); setConflict(null); }
    catch (e) {
      if (e instanceof ConflictError) { setConflict(e); setBase(String(e.current?.body ?? b)); }
      else setErr(e?.message || 'Couldn’t save — please try again.');
    } finally { setBusy(false); }
  };
  return (
    <div className="sp-composer sp-composer-edit">
      <NotesEditor value={post.body || ''} onChange={setText} />
      <DraftConflict
        conflict={conflict}
        labels={{ body: 'Announcement' }}
        onOverwrite={() => save(String(conflict?.current?.body ?? base))}
        onDiscard={() => { setConflict(null); onCancel(true); }}
      />
      {err && <div className="sp-err" role="alert">{err}</div>}
      <div className="sp-composer-actions">
        <button type="button" className="btn btn-plain" onClick={() => onCancel()} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-ink" onClick={() => save()} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
      </div>
    </div>
  );
}

function ReplyBox({ space, onReply }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ref = useRef(null);
  useAutoGrow(ref, text, 180);
  const send = async () => {
    const body = text.replace(/\s+$/, '');
    if (!body.trim() || busy) return;
    if (tooLong(body)) { setErr(longMsg(body)); return; }
    setBusy(true);
    setErr('');
    const ok = await onReply(body);
    setBusy(false);
    if (ok === true) setText(''); else setErr(ok || 'Couldn’t send — please try again.');
  };
  return (
    <div className="sp-reply-box">
      <div className="sp-reply-row">
        <textarea
          ref={ref}
          className="notes-area"
          rows={1}
          placeholder="Write a reply…  (Ctrl+Enter to send)"
          aria-label={`Write a reply in ${space.name}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }}
        />
        <button type="button" className="btn btn-ink btn-sm" onClick={send} disabled={busy || !text.trim()}>{busy ? 'Sending…' : 'Reply'}</button>
      </div>
      {err && <div className="sp-err" role="alert">{err}</div>}
    </div>
  );
}

function Reply({ r, tz, now, isNew, editing, setEditing, act }) {
  if (r.removed) return <li className="sp-reply removed"><span className="sp-removed">Message removed</span></li>;
  const items = postActions(r, { onEdit: () => setEditing(r.id), onDelete: act.remove, onHide: act.hide });
  return (
    <li className={`sp-reply${r.hidden ? ' is-hidden' : ''}${isNew ? ' is-new' : ''}`} data-post={r.id}>
      <div className="sp-reply-top">
        <PostByline post={r} tz={tz} now={now} size={26} compact isNew={isNew} />
        <MoreMenu items={items} label="Reply actions" className="sp-menu" />
      </div>
      {editing === r.id
        ? (
          <InlineEdit
            post={r}
            label="Edit your reply"
            enterSaves={false}
            onSave={(body, base) => act.edit(r, body, base).then(() => setEditing(null))}
            onCancel={(reload) => { setEditing(null); if (reload) act.refresh(); }}
          />
        )
        : <div className="sp-reply-body"><FormattedNotes text={r.body} linkify empty="" /></div>}
    </li>
  );
}

function PostCard({ post, space, tz, now, isNew, act }) {
  const replies = post.replies || [];
  const count = Math.max(Number(post.reply_count) || 0, replies.filter((r) => !r.removed).length);
  const newReplies = replies.filter((r) => isNew(r.id)).length;
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null);           // the id being edited (this post or one reply)
  const items = postActions(post, { onEdit: () => setEditing(post.id), onDelete: act.remove, onPin: act.pin, onHide: act.hide, canPin: true });
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && count > replies.filter((r) => !r.removed).length) {   // only the latest 3 came with the page
      setLoading(true);
      await act.loadReplies(post);
      setLoading(false);
    }
  };
  return (
    <article className={`sp-post${post.pinned ? ' pinned' : ''}${post.hidden ? ' is-hidden' : ''}${post.removed ? ' removed' : ''}${isNew(post.id) ? ' is-new' : ''}`} data-post={post.id}>
      {post.removed ? (
        <div className="sp-removed sp-removed-top">Message removed</div>
      ) : (
        <>
          <div className="sp-post-top">
            <PostByline post={post} tz={tz} now={now} isNew={isNew(post.id)} />
            <MoreMenu items={items} label="Announcement actions" className="sp-menu" />
          </div>
          {editing === post.id ? (
            <AnnouncementEdit
              post={post}
              onSave={(body, base) => act.edit(post, body, base).then(() => setEditing(null))}
              onCancel={(reload) => { setEditing(null); if (reload) act.refresh(); }}
            />
          ) : (
            <div className="sp-post-body"><FormattedNotes text={post.body} linkify empty="" /></div>
          )}
        </>
      )}
      <div className="sp-post-foot">
        <button type="button" className={`sp-replies-toggle${open ? ' on' : ''}`} aria-expanded={open} onClick={toggle}>
          <IconChat size={15} />
          <span>{count ? `${count} ${count === 1 ? 'reply' : 'replies'}` : 'Reply'}</span>
          {newReplies > 0 && !open && <span className="sp-chip sp-chip-new">{newReplies} new</span>}
        </button>
      </div>
      {open && (
        <div className="sp-replies">
          {loading && <p className="sp-older-note">Loading replies…</p>}
          {replies.length > 0 && (
            <ul className="sp-reply-list">
              {replies.map((r) => <Reply key={r.id} r={r} tz={tz} now={now} isNew={isNew(r.id)} editing={editing} setEditing={setEditing} act={act} />)}
            </ul>
          )}
          {space.can_post && !post.removed && <ReplyBox space={space} onReply={(body) => act.reply(post, body)} />}
        </div>
      )}
    </article>
  );
}

export default function AnnouncementsTab({ space, initial, unread = 0, viewer, tz, serverNow }) {
  const router = useRouter();
  const [data, setData] = useServerState(initial);
  const [older, setOlder] = useState([]);
  const [olderMore, setOlderMore] = useState(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState(null);
  const [fresh] = useState(() => newPostIds(initial?.posts, unread));   // "New" since the last visit (frozen)
  const [confirmUI, ask] = useConfirm();
  const now = useNow(serverNow);
  useRefreshOnFocus(30_000);

  const refresh = () => router.refresh();
  const isNew = (id) => fresh.has(String(id));
  const posts = useMemo(() => {
    const seen = new Set();
    const top = [];
    const rest = [];
    for (const p of data?.posts || []) { if (!seen.has(p.id)) { seen.add(p.id); top.push(p); } }
    for (const p of older) { if (!seen.has(p.id)) { seen.add(p.id); rest.push(p); } }
    return [...top.sort(byNewest), ...rest];
  }, [data, older]);

  const patchAll = (id, fn) => {
    setData((d) => ({ ...d, posts: mapPosts(d.posts, id, fn) }));
    setOlder((o) => mapPosts(o, id, fn));
  };
  const me = { id: viewer.id, username: viewer.username, display_name: viewer.display_name, name: viewer.name, avatar_v: null };

  const act = {
    refresh,
    async post(body) {
      try {
        const p = await createPost(space.key, 'announcements', body);
        if (p) {
          const row = { author: me, created_at: new Date().toISOString(), mine: true, can_edit: true, can_delete: true, reply_count: 0, ...p, replies: [] };
          setData((d) => ({ ...d, posts: [row, ...d.posts.filter((x) => x.id !== row.id)] }));
        }
        setError(null);
        refresh();
        return true;
      } catch (e) { return e?.message || false; }
    },
    async reply(post, body) {
      try {
        const r = await createPost(space.key, 'announcements', body, post.id);
        if (r) {
          const row = { author: me, created_at: new Date().toISOString(), mine: true, can_edit: true, can_delete: true, ...r, parent_id: String(post.id) };
          patchAll(post.id, (p) => ({
            ...p,
            replies: [...(p.replies || []).filter((x) => x.id !== row.id), row],
            reply_count: (Number(p.reply_count) || 0) + 1,
          }));
        }
        setError(null);
        refresh();
        return true;
      } catch (e) { return e?.message || false; }
    },
    async loadReplies(post) {
      try {
        const { replies } = await fetchReplies(space.key, post.id);
        patchAll(post.id, (p) => ({ ...p, replies, reply_count: Math.max(replies.length, 0) }));
      } catch (e) { setError(e?.message || 'Couldn’t load the replies.'); }
    },
    async edit(post, body, base) {
      const row = await editPost(post.id, body, base);        // ConflictError goes to the editor
      patchAll(post.id, (p) => ({
        ...p, ...(row || {}), body: row?.body ?? body, edited_at: row?.edited_at || new Date().toISOString(),
        replies: p.replies, reply_count: p.reply_count,
      }));
      setError(null);
      refresh();
    },
    async remove(post) {
      const top = post.parent_id == null;
      const hasReplies = top && ((Number(post.reply_count) || 0) > 0 || (post.replies || []).length > 0);
      const ok = await ask({
        title: top ? 'Delete this announcement?' : 'Delete your reply?',
        lines: [hasReplies ? 'Its replies stay; the announcement shows as “Message removed”.' : 'This can’t be undone.'],
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
      try {
        await deletePost(post.id);
        if (hasReplies) patchAll(post.id, (p) => ({ ...p, removed: true, body: '', author: null, pinned: false }));
        else if (top) {
          setData((d) => ({ ...d, posts: d.posts.filter((p) => p.id !== post.id) }));
          setOlder((o) => o.filter((p) => p.id !== post.id));
        } else {
          const drop = (list) => list.map((p) => (p.replies?.some((r) => r.id === post.id)
            ? { ...p, replies: p.replies.filter((r) => r.id !== post.id), reply_count: Math.max(0, (Number(p.reply_count) || 1) - 1) } : p));
          setData((d) => ({ ...d, posts: drop(d.posts) }));
          setOlder(drop);
        }
        setError(null);
        refresh();
      } catch (e) { setError(e?.message || 'Couldn’t delete that — please try again.'); refresh(); }
    },
    async pin(post, on) {
      patchAll(post.id, (p) => ({ ...p, pinned: on }));
      try { await setPostFlag(post.id, 'pinned', on); setError(null); refresh(); }
      catch (e) { patchAll(post.id, (p) => ({ ...p, pinned: !on })); setError(e?.message || 'Couldn’t pin that.'); }
    },
    async hide(post, on) {
      if (on && !(await ask({
        title: 'Hide this post?',
        lines: ['Everyone but moderators stops seeing it (where it has replies, it shows as “Message removed”). You can unhide it later.'],
        confirmLabel: 'Hide',
      }))) return;
      patchAll(post.id, (p) => ({ ...p, hidden: on }));
      try { await setPostFlag(post.id, 'hidden', on); setError(null); refresh(); }
      catch (e) { patchAll(post.id, (p) => ({ ...p, hidden: !on })); setError(e?.message || 'Couldn’t change that.'); }
    },
  };

  const more = olderMore == null ? !!data?.has_more : olderMore;
  async function loadOlder() {
    const last = [...posts].reverse().find((p) => !p.pinned);
    if (!last || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await fetchPage(space.key, 'announcements', { before: last.id });
      setOlder((o) => [...o, ...page.posts.filter((p) => p.parent_id == null)]);
      setOlderMore(page.has_more);
    } catch (e) { setError(e?.message || 'Couldn’t load older announcements.'); }
    finally { setLoadingOlder(false); }
  }

  return (
    <section className="sp-panel sp-ann" aria-label="Announcements">
      {error && (
        <div className="banner" role="alert">
          <IconAlert size={16} /><span>{error}</span><span className="spacer" />
          <button type="button" className="btn btn-plain btn-sm" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
      {space.can_post && <Composer space={space} onPost={act.post} />}
      {posts.length === 0 ? (
        <div className="sp-empty">
          <IconBell size={22} />
          <b>No announcements yet</b>
          <span>{space.can_post ? `Post the first one — everyone who can see ${space.name} will see it here.` : 'Nothing has been posted here.'}</span>
        </div>
      ) : (
        <div className="sp-posts">
          {posts.map((p) => <PostCard key={p.id} post={p} space={space} tz={tz} now={now} isNew={isNew} act={act} />)}
        </div>
      )}
      {more && posts.length > 0 && (
        <div className="sp-more">
          <button type="button" className="btn btn-plain btn-sm" onClick={loadOlder} disabled={loadingOlder}>{loadingOlder ? 'Loading…' : 'Show older announcements'}</button>
        </div>
      )}
      {confirmUI}
    </section>
  );
}
