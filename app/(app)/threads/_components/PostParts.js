'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Headshot } from '@/app/_ui/Headshot';
import NameLabel from '@/app/_ui/NameLabel';
import DeptTag from '@/app/_ui/DeptTag';
import ConflictNotice from '@/app/_ui/ConflictNotice';
import { ConflictError } from '@/app/_ui/api';
import { IconPencil, IconTrash, IconPin, IconEye, IconEyeOff } from '@/app/icons';
import { fmtWhen, fmtFull } from './when';
import { MAX_BODY } from './space-api';

// Small pieces shared by the announcements and the chat (design-amendments A5.6).

// "now" for relative dates ("Today 3:14 PM"): the server's clock on the first render (so the HTML matches), then
// the browser's, refreshed every minute.
export function useNow(serverNow) {
  const [now, setNow] = useState(serverNow ?? null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now ?? serverNow;
}

export const authorOf = (p) => p?.author || null;

// The person's photo, name (links to their profile), department tag and the time (edited / pinned / new chips).
export function PostByline({ post, tz, now, size = 34, isNew = false, compact = false }) {
  const a = authorOf(post);
  return (
    <div className={`sp-by${compact ? ' compact' : ''}`}>
      {a ? <Headshot user={a} size={size} /> : <span className="hs hs-init sp-by-none" style={{ width: size, height: size }} aria-hidden="true" />}
      <div className="sp-by-main">
        <div className="sp-by-name">
          {a ? <NameLabel user={a} link /> : <span className="name-label muted">Former member</span>}
          {a?.department && <DeptTag dept={a.department} />}
        </div>
        <div className="sp-by-meta">
          <time dateTime={post.created_at || undefined} title={fmtFull(post.created_at, tz)}>{fmtWhen(post.created_at, tz, now)}</time>
          {post.edited_at && <span className="sp-edited" title={`Edited ${fmtFull(post.edited_at, tz)}`}>edited</span>}
          {post.pinned && <span className="sp-chip sp-chip-pin wi"><IconPin size={12} /> Pinned</span>}
          {isNew && <span className="sp-chip sp-chip-new">New</span>}
          {post.hidden && <span className="acct-tag pending" title="Hidden by a moderator: only moderators can see it">Hidden</span>}
        </div>
      </div>
    </div>
  );
}

// The actions of one post, for MoreMenu: the author edits and deletes; moderators pin (announcements) and hide.
// The API marks each post can_edit / can_delete / can_pin / can_moderate for this viewer.
export function postActions(post, { onEdit, onDelete, onPin, onHide, canPin = false }) {
  if (!post || post.removed) return [];
  const pinnable = post.can_pin ?? (post.can_moderate && canPin);
  const deletable = post.can_delete ?? post.mine;
  return [
    post.can_edit && onEdit && { label: 'Edit', icon: <IconPencil size={15} />, onClick: () => onEdit(post) },
    pinnable && canPin && onPin && {
      label: post.pinned ? 'Unpin' : 'Pin to the top', icon: <IconPin size={15} />, onClick: () => onPin(post, !post.pinned),
    },
    post.can_moderate && onHide && {
      label: post.hidden ? 'Unhide' : 'Hide (moderator)', icon: post.hidden ? <IconEye size={15} /> : <IconEyeOff size={15} />,
      onClick: () => onHide(post, !post.hidden),
    },
    deletable && onDelete && { label: 'Delete', icon: <IconTrash size={15} />, danger: true, onClick: () => onDelete(post) },
  ].filter(Boolean);
}

// Grows a textarea with its text (up to max px), and back after it is cleared.
export function useAutoGrow(ref, value, max = 200) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(max, el.scrollHeight + 2)}px`;
    el.style.overflowY = el.scrollHeight + 2 > max ? 'auto' : 'hidden';
  }, [ref, value, max]);
}

// Inline plain-text editor for a reply or a chat message. Enter saves (Shift+Enter: new line), Escape cancels.
// onSave(text, base) resolves true, or throws ConflictError (shown under the box with Keep mine / Use theirs).
export function InlineEdit({ post, onSave, onCancel, label = 'Edit message' }) {
  const [text, setText] = useState(post.body || '');
  const [base, setBase] = useState(post.body || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [conflict, setConflict] = useState(null);
  const ref = useRef(null);
  useAutoGrow(ref, text, 240);
  useEffect(() => { const el = ref.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, []);

  const save = async (b = base) => {
    const body = text.replace(/\s+$/, '');
    if (!body.trim()) { setErr('A message can’t be empty — delete it instead.'); return; }
    if (body.length > MAX_BODY) { setErr(`That’s too long (${body.length.toLocaleString('en-US')} of ${MAX_BODY.toLocaleString('en-US')} characters).`); return; }
    if (body === b) { onCancel(); return; }
    setBusy(true);
    setErr('');
    try {
      await onSave(body, b);
      setConflict(null);
    } catch (e) {
      if (e instanceof ConflictError) { setConflict(e); setBase(String(e.current?.body ?? b)); }
      else setErr(e?.message || 'Couldn’t save — please try again.');
    } finally { setBusy(false); }
  };
  return (
    <div className="sp-edit">
      <textarea
        ref={ref}
        className="notes-area sp-edit-area"
        rows={1}
        aria-label={label}
        value={text}
        maxLength={MAX_BODY + 500}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
          else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); save(); }
        }}
      />
      <ConflictNotice
        conflict={conflict}
        field="body"
        mine={text}
        onKeepMine={(theirs) => save(theirs)}
        onUseTheirs={() => { setText(String(conflict?.current?.body ?? '')); setConflict(null); onCancel(true); }}
      />
      {err && <div className="sp-err" role="alert">{err}</div>}
      <div className="sp-edit-actions">
        <span className="sp-hint">Enter to save · Esc to cancel</span>
        <button type="button" className="btn btn-plain btn-sm" onClick={() => onCancel()} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-ink btn-sm" onClick={() => save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}

// Replace a post (or reply) by id anywhere in a list of announcements with their replies.
export function mapPosts(list, id, fn) {
  const sid = String(id);
  return (list || []).map((p) => {
    if (String(p.id) === sid) return fn(p);
    if (Array.isArray(p.replies) && p.replies.some((r) => String(r.id) === sid)) {
      return { ...p, replies: p.replies.map((r) => (String(r.id) === sid ? fn(r) : r)) };
    }
    return p;
  });
}
