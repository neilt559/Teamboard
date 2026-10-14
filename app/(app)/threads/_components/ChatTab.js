'use client';
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FormattedNotes } from '@/app/notes-format';
import { useConfirm } from '@/app/_ui/ConfirmDialog';
import { usePoll, useRefreshOnFocus } from '@/app/_ui/useRefresh';
import { Headshot } from '@/app/_ui/Headshot';
import NameLabel from '@/app/_ui/NameLabel';
import { IconAlert, IconChat, IconCaret } from '@/app/icons';
import MoreMenu from '../../offices/_ui/MoreMenu';
import { postActions, useNow, useAutoGrow, InlineEdit } from './PostParts';
import { dayKey, dayLabel, fmtTime, fmtFull } from './when';
import { createPost, editPost, setPostFlag, deletePost, fetchPage, markRead, newPostIds, MAX_BODY } from './space-api';

// General chat (design-amendments A5.6): messages oldest to newest with day separators, the composer at the
// bottom (Enter sends, Shift+Enter makes a new line). It asks for messages after the newest one every 10 s while
// the tab is visible (with changed_since, so edits, deletes, hides and unhides by others show up too), has "Load earlier",
// and lets people edit and delete their own messages. It stays at the bottom when new messages arrive unless
// you've scrolled up; then "New messages" shows instead.
// initial = GET /api/spaces/posts's latest page from the server ({ posts oldest first, has_more, server_time }).
// The page scrolls (not an inner box), so phones keep their normal scrolling and keyboard behavior; the composer
// is sticky at the bottom of the screen (above the phone tab bar).

const POLL_MS = 10_000;
const GROUP_MS = 5 * 60_000;
const BOTTOM_SLACK = 140;
const num = (id) => Number(id) || 0;
const byId = (a, b) => num(a.id) - num(b.id);
const maxId = (list) => list.reduce((m, p) => Math.max(m, num(p.id)), 0);

function atBottom() {
  const el = document.documentElement;
  return window.innerHeight + window.scrollY >= el.scrollHeight - BOTTOM_SLACK;
}
function toBottom(smooth = false) {
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

// Add messages, newest version wins, kept in id order.
function upsert(list, add) {
  const m = new Map(list.map((p) => [String(p.id), p]));
  for (const p of add) m.set(String(p.id), { ...(m.get(String(p.id)) || {}), ...p });
  return [...m.values()].sort(byId);
}
// A fresh server page (after router.refresh): it is the truth for its own id range; older pages loaded with
// "Load earlier" and anything newer (sent or polled since) stay.
function mergeServer(cur, page) {
  if (!page.length) return cur.filter((p) => p._local);
  const lo = num(page[0].id);
  const hi = num(page[page.length - 1].id);
  const keep = cur.filter((p) => num(p.id) < lo || num(p.id) > hi);
  return upsert(keep, page);
}

function Composer({ space, onSend, pill, onPill }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ref = useRef(null);
  useAutoGrow(ref, text, 168);
  const send = async () => {
    const body = text.replace(/\s+$/, '');
    if (!body.trim() || busy) return;
    if (body.length > MAX_BODY) { setErr(`That’s too long (${body.length.toLocaleString('en-US')} of ${MAX_BODY.toLocaleString('en-US')} characters).`); return; }
    setBusy(true);
    setErr('');
    const ok = await onSend(body);
    setBusy(false);
    if (ok === true) { setText(''); ref.current?.focus(); } else setErr(ok || 'Couldn’t send — please try again.');
  };
  return (
    <div className="sp-chat-compose">
      {pill && (
        <button type="button" className="sp-newpill" onClick={onPill}>
          New messages <IconCaret size={14} />
        </button>
      )}
      {err && <div className="sp-err" role="alert">{err}</div>}
      {space.can_post ? (
        <div className="sp-chat-row">
          <textarea
            ref={ref}
            className="notes-area sp-chat-input"
            rows={1}
            placeholder={`Message ${space.name}`}
            aria-label={`Message ${space.name}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
            }}
          />
          <button type="button" className="btn btn-lime sp-send" onClick={send} disabled={busy || !text.trim()}>{busy ? 'Sending…' : 'Send'}</button>
        </div>
      ) : (
        <p className="sp-chat-ro">This space is archived, so nobody can post here.</p>
      )}
      {space.can_post && <div className="sp-hint sp-chat-hint">Enter sends · Shift+Enter for a new line</div>}
    </div>
  );
}

export default function ChatTab({ space, initial, unread = 0, viewer, tz, serverNow }) {
  const [msgs, setMsgs] = useState(() => [...(initial?.posts || [])].sort(byId));
  const [more, setMore] = useState(!!initial?.has_more);
  const [fresh] = useState(() => newPostIds(initial?.posts, unread));   // new since the last visit (frozen)
  const [pill, setPill] = useState(false);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState(null);
  const [earlierBusy, setEarlierBusy] = useState(false);
  const cursor = useRef(maxId(initial?.posts || []));  // newest id the server has listed to us
  const changedSince = useRef(initial?.server_time || null);   // the server clock of the last answer
  const plan = useRef(null);                           // what to do with the scroll after the next render
  const readAt = useRef(0);
  const [confirmUI, ask] = useConfirm();
  const now = useNow(serverNow);
  useRefreshOnFocus(30_000);

  const me = { id: viewer.id, username: viewer.username, display_name: viewer.display_name, name: viewer.name, avatar_v: null };

  // First paint: jump to the newest message (after Next's own scroll handling for the navigation).
  useEffect(() => {
    let a = 0;
    let b = 0;
    a = requestAnimationFrame(() => { toBottom(); b = requestAnimationFrame(() => toBottom()); });
    return () => { cancelAnimationFrame(a); cancelAnimationFrame(b); };
  }, []);

  // A refresh brought a new server page: merge it in (deleted and hidden ones drop out, edits show).
  const firstProps = useRef(true);
  useEffect(() => {
    if (firstProps.current) { firstProps.current = false; return; }
    const page = [...(initial?.posts || [])].sort(byId);
    plan.current = atBottom() ? 'bottom' : null;
    setMsgs((cur) => mergeServer(cur, page));
    cursor.current = Math.max(cursor.current, maxId(page));
    if (initial?.server_time) changedSince.current = initial.server_time;
  }, [initial]);

  useLayoutEffect(() => {
    const p = plan.current;
    plan.current = null;
    if (!p) return;
    if (p === 'bottom') { toBottom(); setPill(false); }
    else if (p === 'pill') setPill(true);
    else if (typeof p === 'object') window.scrollTo(0, p.y + (document.documentElement.scrollHeight - p.h));
  }, [msgs]);

  // Leaving the bottom keeps the pill; reaching it hides the pill.
  useEffect(() => {
    if (!pill) return undefined;
    const on = () => { if (atBottom()) setPill(false); };
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, [pill]);

  const readSoon = () => {
    if (Date.now() - readAt.current < 5000) return;
    readAt.current = Date.now();
    markRead(space.key, 'chat').catch(() => {});
  };

  async function pollNow() {
    let got = [];
    let changed = [];
    for (let i = 0; i < 5; i++) {                       // a burst bigger than one page: keep reading
      const page = await fetchPage(space.key, 'chat', { after: cursor.current || null, changedSince: i === 0 ? changedSince.current : null });
      if (i === 0) { changed = page.changed; if (page.server_time) changedSince.current = page.server_time; }
      got = got.concat(page.posts);
      cursor.current = Math.max(cursor.current, maxId(page.posts));
      if (!page.has_more || !page.posts.length) break;
    }
    if (!got.length && !changed.length) return;
    const have = new Set(msgs.map((m) => String(m.id)));
    const fromOthers = got.some((m) => !m.mine && !have.has(String(m.id)));
    const bottom = atBottom();
    const gone = new Set(changed.filter((m) => m.removed).map((m) => String(m.id)));
    const edits = changed.filter((m) => !m.removed);
    // A changed message this chat doesn't show (a moderator unhid it) comes back, in id order, when it falls in the
    // history loaded here; an older one arrives with "Load earlier" like the rest.
    const lo = more && msgs.length ? num(msgs[0].id) : 0;
    const back = edits.filter((m) => !have.has(String(m.id)) && num(m.id) >= lo);
    plan.current = got.length ? (bottom ? 'bottom' : fromOthers ? 'pill' : null) : (back.length && bottom ? 'bottom' : null);
    setMsgs((cur) => {
      const known = new Set(cur.map((m) => String(m.id)));
      const kept = cur.filter((m) => !gone.has(String(m.id)));
      return upsert(kept, [...edits.filter((m) => known.has(String(m.id))), ...back, ...got.filter((m) => !gone.has(String(m.id)))]);
    });
    if (fromOthers && bottom && document.visibilityState === 'visible') readSoon();
  }
  usePoll(pollNow, POLL_MS);

  async function send(body) {
    try {
      const p = await createPost(space.key, 'chat', body);
      if (p) {
        plan.current = 'bottom';
        setMsgs((cur) => upsert(cur, [{ author: me, created_at: new Date().toISOString(), mine: true, can_edit: true, ...p, _local: true }]));
      }
      setError(null);
      pollNow().catch(() => {});
      return true;
    } catch (e) { return e?.message || false; }
  }

  async function loadEarlier() {
    if (!msgs.length || earlierBusy) return;
    setEarlierBusy(true);
    try {
      const page = await fetchPage(space.key, 'chat', { before: msgs[0].id, limit: 50 });
      plan.current = { h: document.documentElement.scrollHeight, y: window.scrollY };
      setMsgs((cur) => upsert(cur, page.posts));
      setMore(page.has_more);
    } catch (e) { setError(e?.message || 'Couldn’t load earlier messages.'); }
    finally { setEarlierBusy(false); }
  }

  const patch = (id, fn) => setMsgs((cur) => cur.map((m) => (String(m.id) === String(id) ? fn(m) : m)));
  const act = {
    async edit(m, body, base) {
      const row = await editPost(m.id, body, base);
      patch(m.id, (x) => ({ ...x, ...(row || {}), body: row?.body ?? body, edited_at: row?.edited_at || new Date().toISOString() }));
      setEditing(null);
      setError(null);
    },
    async remove(m) {
      if (!(await ask({ title: 'Delete this message?', lines: ['This can’t be undone.'], confirmLabel: 'Delete', danger: true }))) return;
      try {
        await deletePost(m.id);
        setMsgs((cur) => cur.filter((x) => String(x.id) !== String(m.id)));
        setError(null);
      } catch (e) { setError(e?.message || 'Couldn’t delete that — please try again.'); }
    },
    async hide(m, on) {
      if (on && !(await ask({ title: 'Hide this message?', lines: ['Everyone but moderators stops seeing it. You can unhide it later.'], confirmLabel: 'Hide' }))) return;
      patch(m.id, (x) => ({ ...x, hidden: on }));
      try { await setPostFlag(m.id, 'hidden', on); setError(null); }
      catch (e) { patch(m.id, (x) => ({ ...x, hidden: !on })); setError(e?.message || 'Couldn’t change that.'); }
    },
  };

  // Day separators, the "New messages" line, and runs of messages by one person within 5 minutes.
  let prev = null;
  let prevDay = null;
  let newLineDone = fresh.size === 0;
  const rows = [];
  for (const m of msgs) {
    const day = dayKey(m.created_at, tz);
    const parts = [];
    if (day !== prevDay) { parts.push({ kind: 'day', key: `d${day}`, label: dayLabel(m.created_at, tz, now) }); prev = null; }
    if (!newLineDone && fresh.has(String(m.id))) {
      parts.push({ kind: 'new', key: 'new' });
      newLineDone = true;
      prev = null;
    }
    const same = prev && prev.author?.id && m.author?.id && String(prev.author.id) === String(m.author.id)
      && Date.parse(m.created_at) - Date.parse(prev.created_at) < GROUP_MS;
    parts.push({ kind: 'msg', key: m.id, m, cont: !!same });
    rows.push(...parts);
    prev = m;
    prevDay = day;
  }

  return (
    <section className="sp-panel sp-chat" aria-label="General chat">
      {error && (
        <div className="banner" role="alert">
          <IconAlert size={16} /><span>{error}</span><span className="spacer" />
          <button type="button" className="btn btn-plain btn-sm" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
      {more && msgs.length > 0 && (
        <div className="sp-earlier">
          <button type="button" className="sp-link-btn" onClick={loadEarlier} disabled={earlierBusy}>{earlierBusy ? 'Loading…' : 'Load earlier messages'}</button>
        </div>
      )}
      {msgs.length === 0 ? (
        <div className="sp-empty sp-chat-empty">
          <IconChat size={22} />
          <b>No messages yet</b>
          <span>{space.can_post ? `Say hello to ${space.name}.` : 'Nothing was said here.'}</span>
        </div>
      ) : (
        <ol className="sp-msgs" aria-label="Messages">
          {rows.map((r) => {
            if (r.kind === 'day') return <li key={r.key} className="sp-day" role="separator"><span>{r.label}</span></li>;
            if (r.kind === 'new') return <li key={r.key} className="sp-newline" role="separator"><span>New</span></li>;
            const { m, cont } = r;
            const items = postActions(m, { onEdit: () => setEditing(m.id), onDelete: act.remove, onHide: act.hide });
            return (
              <li key={r.key} className={`sp-msg${cont ? ' cont' : ''}${m.mine ? ' mine' : ''}${m.hidden ? ' is-hidden' : ''}`} data-post={m.id}>
                <div className="sp-msg-side">
                  {cont
                    ? <time className="sp-msg-time-side" dateTime={m.created_at || undefined} title={fmtFull(m.created_at, tz)}>{fmtTime(m.created_at, tz)}</time>
                    : m.author ? <Headshot user={m.author} size={34} /> : <span className="hs hs-init" style={{ width: 34, height: 34 }} aria-hidden="true" />}
                </div>
                <div className="sp-msg-main">
                  {!cont && (
                    <div className="sp-msg-head">
                      {m.author ? <NameLabel user={m.author} link /> : <span className="name-label muted">Former member</span>}
                      <time dateTime={m.created_at || undefined} title={fmtFull(m.created_at, tz)}>{fmtTime(m.created_at, tz)}</time>
                      {m.hidden && <span className="acct-tag pending" title="Hidden by a moderator: only moderators can see it">Hidden</span>}
                    </div>
                  )}
                  {editing === m.id ? (
                    <InlineEdit post={m} onSave={(body, base) => act.edit(m, body, base)} onCancel={() => setEditing(null)} />
                  ) : (
                    <div className="sp-msg-body">
                      <FormattedNotes text={m.body} linkify empty="" />
                      {m.edited_at && <span className="sp-edited" title={`Edited ${fmtFull(m.edited_at, tz)}`}>(edited)</span>}
                      {cont && m.hidden && <span className="acct-tag pending">Hidden</span>}
                    </div>
                  )}
                </div>
                <MoreMenu items={items} label="Message actions" className="sp-menu sp-msg-menu" />
              </li>
            );
          })}
        </ol>
      )}
      <Composer space={space} onSend={send} pill={pill} onPill={() => { toBottom(true); setPill(false); readSoon(); }} />
      {confirmUI}
    </section>
  );
}
