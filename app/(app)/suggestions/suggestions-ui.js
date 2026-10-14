'use client';
import { useState } from 'react';
import {
  CATEGORIES, STATUSES, categoryOf, categoryKey, statusOf, boardOrder, isRecentAnnouncement, isAnnouncement,
  BOARD_LABEL, TITLE_MAX, DETAILS_MAX, ANNOUNCEMENT_MAX, TOP_DAYS,
} from '@/lib/suggestions';
import {
  IconBulb, IconChevronUp, IconSearch, IconPencil, IconTrash, IconChat, IconEye, IconEyeOff, IconMegaphone,
  IconArchive,
} from '@/app/icons';
import { Headshot } from '@/app/_ui/Headshot';
import NameLabel from '@/app/_ui/NameLabel';
import { useConfirm } from '@/app/_ui/ConfirmDialog';
import { DraftConflict } from '@/app/_ui/ConflictNotice';
import { fmtWhen } from '@/app/_ui/when';
import { FormattedNotes, NotesEditor } from '@/app/notes-format';
import BoardSwitcher from './BoardSwitcher';
import './suggestions.css';

// ---- Suggestions/Announcements board ------------------------------------------------------------------------
// Design-amendments A10 (Neil, 2026-10-14), from the suggestion box (inventory §1.15). One feed per board (CAGE, or
// one office); anyone who can see the board posts either kind:
//   Suggestion   a title, a category, optional details; +1s, a status (anyone while the company is small, then
//                culture organizers and admins: canStatus comes from the server), optional anonymity; admins hide.
//   Announcement a title and a body in Neil's notes markup (links clickable); always shows the author; no +1s,
//                status or category; the author edits and deletes it; admins and culture organizers hide it.
// Both take replies. Announcements from the last two weeks sit on top (newest first); everything else follows by
// date. Filter chips: All / Announcements / Suggestions, plus search; the category, status and sort tools belong
// to the Suggestions view. Every row arrives already masked by the server: an anonymous author is never sent
// (rule 28). Posts and replies newer than the previous visit (since) carry an "Unread" chip (not "New", which is a
// suggestion status).

const isNewer = (v, since) => !!since && !!v && Date.parse(v) > Date.parse(since);

function KindToggle({ kind, onChange }) {
  const opts = [
    { key: 'suggestion', label: 'Suggestion', Icon: IconBulb },
    { key: 'announcement', label: 'Announcement', Icon: IconMegaphone },
  ];
  return (
    <div className="sgb-kind" role="radiogroup" aria-label="Post type">
      {opts.map(({ key, label, Icon }) => (
        <button
          type="button" key={key} role="radio" aria-checked={kind === key}
          className={`sgb-kind-opt${kind === key ? ' on' : ''}`}
          onClick={() => onChange(key)}
          onKeyDown={(e) => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
            e.preventDefault();
            const next = kind === 'suggestion' ? 'announcement' : 'suggestion';
            onChange(next);
            e.currentTarget.parentElement?.querySelector(`[data-kind="${next}"]`)?.focus();
          }}
          data-kind={key}
          tabIndex={kind === key ? 0 : -1}
        >
          <Icon size={15} /> {label}
        </button>
      ))}
    </div>
  );
}

// New post (either kind) or the author's edit of one. initial = the post being edited (its kind is fixed).
function PostForm({ initial, boardName, onCancel, onSubmit }) {
  const [kind, setKind] = useState(initial ? initial.kind || 'suggestion' : 'suggestion');
  const [title, setTitle] = useState(initial ? initial.title : '');
  const [details, setDetails] = useState(initial ? initial.details || '' : '');
  const [category, setCategory] = useState(initial ? categoryKey(initial.category) : '');
  const [anonymous, setAnonymous] = useState(initial ? !!initial.anonymous : false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(null);
  const [editorKey, setEditorKey] = useState(0);
  const ann = kind === 'announcement';

  // overwrite: resend over the newer version the server reported (draft editors, design §7.4).
  const submit = async (overwrite = null) => {
    if (busy) return;
    const body = ann ? details.replace(/\s+$/, '') : details.trim();
    if (!title.trim()) { setErr(ann ? 'Give your announcement a title.' : 'Give your suggestion a short title.'); return; }
    if (!ann && !category) { setErr('Pick a category.'); return; }
    if (ann && !body.trim()) { setErr('Write the announcement first.'); return; }
    const max = ann ? ANNOUNCEMENT_MAX : DETAILS_MAX;
    if (body.length > max) { setErr(`That’s too long (${body.length.toLocaleString('en-US')} of ${max.toLocaleString('en-US')} characters).`); return; }
    setErr('');
    setBusy(true);
    const p = ann
      ? { kind, title: title.trim(), details: body }
      : { kind, title: title.trim(), details: body, category, anonymous };
    const res = await onSubmit(p, overwrite);
    setBusy(false);
    if (res && res.conflict) { setConflict(res.conflict); return; }
    setConflict(null);
    if (res === false) setErr('Couldn’t save — please try again.');
  };

  const heading = initial ? (ann ? 'Edit announcement' : 'Edit suggestion') : `New post${boardName ? ` on ${boardName}` : ''}`;
  return (
    <div className={`sg-form sgb-form${ann ? ' is-ann' : ''}`}>
      <h3>{heading}</h3>
      {!initial && (
        <>
          <span className="atm-label">Post type</span>
          <KindToggle kind={kind} onChange={(k) => { setKind(k); setErr(''); }} />
        </>
      )}
      <label className="atm-label" htmlFor="sg-title">{ann ? 'Title' : 'Your idea'}</label>
      <input
        id="sg-title"
        className="field"
        autoFocus
        maxLength={TITLE_MAX}
        placeholder={ann ? 'e.g. Office closed Friday for the holiday' : 'e.g. Monthly lunch-and-learn on Civil 3D tips'}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !ann) submit(); }}
      />
      {ann ? (
        <>
          <span className="atm-label">Message</span>
          <div className="sgb-editor">
            {/* NotesEditor reads value once, when it mounts: switching the post type keeps what was typed. */}
            <NotesEditor key={editorKey} value={details} onChange={setDetails} placeholder="What should everyone here know?" />
          </div>
          <p className="sgb-hint">Shows with your name, at the top of this board for {TOP_DAYS} days.</p>
        </>
      ) : (
        <>
          <span className="atm-label">Category</span>
          <div className="sg-chips" role="radiogroup" aria-label="Category">
            {CATEGORIES.map((c) => (
              <button
                type="button" key={c.key} role="radio" aria-checked={category === c.key}
                className={`sg-chip${category === c.key ? ' on' : ''}`} style={{ '--c': c.color }} onClick={() => setCategory(c.key)}
              >
                <i />{c.label}
              </button>
            ))}
          </div>
          <label className="atm-label" htmlFor="sg-details">Details <span className="login-opt">(optional)</span></label>
          <textarea id="sg-details" className="notes-area" rows={4} placeholder="Why it matters, how it could work, who it would help…" value={details} onChange={(e) => setDetails(e.target.value)} />
          <label className="sg-anon-check">
            <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
            <span><b>Post anonymously</b> — your name won’t be shown to anyone. The site still knows it’s yours, so only you can edit or delete it.</span>
          </label>
        </>
      )}
      {err && <div className="bk-err" role="alert">{err}</div>}
      <DraftConflict
        conflict={conflict}
        labels={{ title: ann ? 'Title' : 'Your idea', details: ann ? 'Message' : 'Details' }}
        onOverwrite={() => submit(conflict.current)}
        onDiscard={() => { setConflict(null); setEditorKey((x) => x + 1); onCancel(true); }}
      />
      <div className="modal-actions">
        <button type="button" className="btn btn-plain" onClick={() => onCancel(false)} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-ink" onClick={() => submit()} disabled={busy}>
          {busy ? 'Saving…' : initial ? 'Save changes' : ann ? 'Post announcement' : 'Post suggestion'}
        </button>
      </div>
    </div>
  );
}

function StatusControl({ s, canStatus, statusOpen, onPatch }) {
  const st = statusOf(s.status);
  if (!canStatus) {
    return (
      <span className="sg-status sg-status-ro" style={{ '--s': st.color }} title="Only culture organizers and admins can update the status">
        {st.label}
      </span>
    );
  }
  return (
    <select
      className="sg-status"
      value={s.status}
      style={{ '--s': st.color }}
      onChange={(e) => onPatch(s.id, { status: e.target.value })}
      title={statusOpen ? 'Anyone can update the status' : 'Culture organizers and admins can update the status'}
      aria-label="Status"
    >
      {STATUSES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
    </select>
  );
}

// Edit / delete (the author), hide (moderators), and the replies toggle: the end of every card's meta line.
function CardActions({ s, canHide, ask, onStartEdit, onDelete, onHide, replies, newReplies, threadOpen, setThreadOpen }) {
  const what = isAnnouncement(s) ? 'announcement' : 'suggestion';
  return (
    <>
      {s.mine && (
        <>
          <button type="button" className="sg-icon-btn" onClick={onStartEdit} title={`Edit your ${what}`} aria-label={`Edit your ${what}`}><IconPencil size={13} /></button>
          <button
            type="button"
            className="sg-icon-btn danger"
            onClick={async () => {
              if (await ask({ title: `Delete “${s.title}”?`, lines: ['This can’t be undone.'], confirmLabel: 'Delete', danger: true })) onDelete(s.id);
            }}
            title={`Delete your ${what}`}
            aria-label={`Delete your ${what}`}
          ><IconTrash size={13} /></button>
        </>
      )}
      {canHide && (
        <button
          type="button"
          className="sg-icon-btn"
          onClick={() => onHide(s.id, !s.hidden)}
          title={s.hidden ? 'Unhide: show it to everyone again' : isAnnouncement(s) ? 'Hide from everyone except admins and organizers' : 'Hide from everyone except admins'}
          aria-label={s.hidden ? `Unhide ${what}` : `Hide ${what}`}
        >{s.hidden ? <IconEye size={13} /> : <IconEyeOff size={13} />}</button>
      )}
      <button type="button" className={`sg-reply-toggle${threadOpen ? ' on' : ''}`} onClick={() => setThreadOpen((x) => !x)} aria-expanded={threadOpen}>
        <IconChat size={14} /> {replies.length ? `${replies.length} repl${replies.length === 1 ? 'y' : 'ies'}` : 'Reply'}
        {newReplies > 0 && !threadOpen && <span className="sgb-new">{newReplies} unread</span>}
      </button>
    </>
  );
}

function SuggestionCard({ s, replies, tz, now, since, canStatus, statusOpen, isAdmin, canPost, ask, onRefresh, onPatch, onEdit, onDelete, onVote, onReply, onDeleteReply, onHide, onHideReply }) {
  const [editing, setEditing] = useState(null);       // the values the edit started from (its frozen base)
  const [expanded, setExpanded] = useState(false);
  const [threadOpen, setThreadOpen] = useState(false);
  const c = categoryOf(s.category);
  if (editing) {
    return <EditForm s={s} start={editing} setEditing={setEditing} onRefresh={onRefresh} onEdit={onEdit} />;
  }
  const long = (s.details || '').length > 280 || (s.details || '').split('\n').length > 5;
  const fresh = !s.mine && isNewer(s.created_at, since);
  const newReplies = replies.filter((r) => !r.mine && isNewer(r.created_at, since)).length;
  return (
    <article id={`post-${s.id}`} className={`sg-card st-${s.status}${s.hidden ? ' sg-hidden' : ''}`} data-kind="suggestion">
      <button
        type="button"
        className={`sg-vote${s.voted ? ' on' : ''}`}
        onClick={() => onVote(s.id, !s.voted)}
        title={s.voted ? 'Take back your +1' : '+1 this idea'}
        aria-pressed={!!s.voted}
        disabled={!canPost}
      >
        <IconChevronUp size={18} />
        <b>{s.votes}</b>
      </button>
      <div className="sg-body">
        <div className="sg-top">
          <span className="sg-cat" style={{ '--c': c.color }}>{c.label}</span>
          <StatusControl s={s} canStatus={canStatus && canPost} statusOpen={statusOpen} onPatch={onPatch} />
          {fresh && <span className="sgb-new">Unread</span>}
          {s.hidden && (
            <span className="acct-tag pending" title="Only admins can see a hidden suggestion">
              Hidden{s.hidden_by_name ? ` by ${s.hidden_by_name}` : ''}
            </span>
          )}
        </div>
        <h3 className="sg-title">{s.title}</h3>
        {s.details && <p className={`sg-details${long && !expanded ? ' clamp' : ''}`}>{s.details}</p>}
        {long && <button type="button" className="bk-link" onClick={() => setExpanded((x) => !x)}>{expanded ? 'Show less' : 'Show more'}</button>}
        <div className="sg-meta">
          {s.anonymous
            ? <span className="sg-anon">Anonymous</span>
            : <span className="sg-author">{s.author && <Headshot user={s.author} size={18} />} {s.author ? <NameLabel user={s.author} link /> : 'Former member'}</span>}
          <span>· <time dateTime={s.created_at || undefined}>{fmtWhen(s.created_at, tz, now)}</time></span>
          {s.mine && <span className="sg-mine">· yours{s.anonymous ? ' (only you can see that)' : ''}</span>}
          <CardActions
            s={s} canHide={isAdmin} ask={ask} onDelete={onDelete} onHide={onHide} replies={replies} newReplies={newReplies}
            threadOpen={threadOpen} setThreadOpen={setThreadOpen}
            onStartEdit={() => setEditing({ title: s.title, details: s.details || '', category: categoryKey(s.category), anonymous: !!s.anonymous })}
          />
        </div>
        {threadOpen && (
          <ReplyThread
            replies={replies} tz={tz} now={now} since={since} isAdmin={isAdmin} ask={ask} canPost={canPost}
            onReply={(body) => onReply(s.id, body)} onDeleteReply={onDeleteReply} onHideReply={onHideReply}
          />
        )}
      </div>
    </article>
  );
}

function AnnouncementCard({ s, replies, tz, now, since, isAdmin, isOrganizer, canPost, ask, onRefresh, onEdit, onDelete, onReply, onDeleteReply, onHide, onHideReply }) {
  const [editing, setEditing] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [threadOpen, setThreadOpen] = useState(false);
  if (editing) {
    return <EditForm s={s} start={editing} setEditing={setEditing} onRefresh={onRefresh} onEdit={onEdit} />;
  }
  const body = s.details || '';
  const long = body.length > 700 || body.split('\n').length > 10;
  const recent = isRecentAnnouncement(s, now);
  const fresh = !s.mine && isNewer(s.created_at, since);
  const newReplies = replies.filter((r) => !r.mine && isNewer(r.created_at, since)).length;
  return (
    <article id={`post-${s.id}`} className={`sg-card sgb-ann${recent ? ' recent' : ''}${s.hidden ? ' sg-hidden' : ''}`} data-kind="announcement">
      <div className="sgb-ann-mark" aria-hidden="true"><IconMegaphone size={18} /></div>
      <div className="sg-body">
        <div className="sg-top">
          <span className="sgb-badge">Announcement</span>
          {fresh && <span className="sgb-new">Unread</span>}
          {s.hidden && (
            <span className="acct-tag pending" title="Only admins and culture organizers can see a hidden announcement">
              Hidden{s.hidden_by_name ? ` by ${s.hidden_by_name}` : ''}
            </span>
          )}
        </div>
        <h3 className="sg-title">{s.title}</h3>
        {body && (
          <div className={`sgb-ann-body${long && !expanded ? ' clamp' : ''}`}>
            <FormattedNotes text={body} linkify empty="" />
          </div>
        )}
        {long && <button type="button" className="bk-link" onClick={() => setExpanded((x) => !x)}>{expanded ? 'Show less' : 'Show more'}</button>}
        <div className="sg-meta">
          <span className="sg-author">{s.author && <Headshot user={s.author} size={18} />} {s.author ? <NameLabel user={s.author} link /> : 'Former member'}</span>
          <span>· <time dateTime={s.created_at || undefined}>{fmtWhen(s.created_at, tz, now)}</time></span>
          {s.mine && <span className="sg-mine">· yours</span>}
          <CardActions
            s={s} canHide={isAdmin || isOrganizer} ask={ask} onDelete={onDelete} onHide={onHide} replies={replies}
            newReplies={newReplies} threadOpen={threadOpen} setThreadOpen={setThreadOpen}
            onStartEdit={() => setEditing({ title: s.title, details: s.details || '' })}
          />
        </div>
        {threadOpen && (
          <ReplyThread
            replies={replies} tz={tz} now={now} since={since} isAdmin={isAdmin} ask={ask} canPost={canPost}
            onReply={(text) => onReply(s.id, text)} onDeleteReply={onDeleteReply} onHideReply={onHideReply}
          />
        )}
      </div>
    </article>
  );
}

// The author's edit of either kind: only the changed fields go out, with the title/details the edit opened with
// as the base (overwrite = the newer version the server reported, design §7.4).
function EditForm({ s, start, setEditing, onRefresh, onEdit }) {
  return (
    <div id={`post-${s.id}`} className="sgb-editing">
      <PostForm
        initial={s}
        onCancel={(reload) => { setEditing(null); if (reload) onRefresh(); }}
        onSubmit={async (p, overwrite) => {
          const base = overwrite ? { ...start, title: overwrite.title ?? start.title, details: overwrite.details ?? start.details } : start;
          const keys = isAnnouncement(s) ? ['title', 'details'] : ['title', 'details', 'category', 'anonymous'];
          const changes = {};
          for (const k of keys) if (p[k] !== base[k]) changes[k] = p[k];
          if (!Object.keys(changes).length) { setEditing(null); return true; }
          const res = await onEdit(s.id, changes, { title: base.title, details: base.details });
          if (res === true) setEditing(null);
          return res;
        }}
      />
    </div>
  );
}

function ReplyThread({ replies, tz, now, since, isAdmin, ask, canPost, onReply, onDeleteReply, onHideReply }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    const ok = await onReply(body);
    setBusy(false);
    if (ok) setText('');
  };
  return (
    <div className="sg-thread">
      {replies.map((r) => {
        const who = r.author;
        return (
          <div key={r.id} className={`sg-reply${r.hidden ? ' sg-hidden' : ''}`}>
            {r.anonymous || !who
              ? <span className="hs hs-init sg-reply-anon" style={{ width: 22, height: 22, fontSize: 11 }} aria-hidden="true">?</span>
              : <Headshot user={who} size={22} />}
            <div className="sg-reply-main">
              <div className="sg-reply-head">
                <b>{r.anonymous ? 'Anonymous (poster)' : who ? <NameLabel user={who} link /> : 'Former member'}</b>
                <span>{fmtWhen(r.created_at, tz, now)}</span>
                {!r.mine && isNewer(r.created_at, since) && <span className="sgb-new">Unread</span>}
                {r.hidden && <span className="acct-tag pending" title="Only admins can see a hidden reply">Hidden</span>}
                {r.mine && (
                  <button
                    type="button"
                    className="sg-icon-btn danger"
                    title="Delete your reply"
                    aria-label="Delete your reply"
                    onClick={async () => {
                      if (await ask({ title: 'Delete your reply?', confirmLabel: 'Delete', danger: true })) onDeleteReply(r.id);
                    }}
                  ><IconTrash size={12} /></button>
                )}
                {isAdmin && (
                  <button
                    type="button"
                    className="sg-icon-btn"
                    title={r.hidden ? 'Unhide: show it to everyone again' : 'Hide from everyone except admins'}
                    aria-label={r.hidden ? 'Unhide reply' : 'Hide reply'}
                    onClick={() => onHideReply(r.id, !r.hidden)}
                  >{r.hidden ? <IconEye size={12} /> : <IconEyeOff size={12} />}</button>
                )}
              </div>
              <div className="sg-reply-body">{r.body}</div>
            </div>
          </div>
        );
      })}
      {canPost && (
        <div className="sg-reply-compose">
          <textarea
            className="notes-area"
            rows={2}
            placeholder="Write a reply…  (Ctrl+Enter to send)"
            aria-label="Write a reply"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }}
          />
          <button type="button" className="btn btn-ink btn-sm" onClick={send} disabled={busy || !text.trim()}>{busy ? 'Sending…' : 'Reply'}</button>
        </div>
      )}
    </div>
  );
}

const TYPES = [
  { key: 'all', label: 'All' },
  { key: 'announcement', label: 'Announcements' },
  { key: 'suggestion', label: 'Suggestions' },
];

export default function SuggestionsView({
  board, boards = [], suggestions, replies = [], tz, now, since = null, canStatus = true, statusOpen = true,
  isAdmin = false, isOrganizer = false, canPost = true,
  onAdd, onPatch, onEdit, onDelete, onVote, onReply, onDeleteReply, onHide, onHideReply, onRefresh,
}) {
  const [composing, setComposing] = useState(false);
  const [type, setType] = useState('all');
  const [cat, setCat] = useState('all');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('new');
  const [q, setQ] = useState('');
  const [confirmUI, ask] = useConfirm();

  const company = board?.scope === 'company';
  const posts = suggestions || [];
  const kinds = { announcement: 0, suggestion: 0 };
  posts.forEach((s) => { kinds[isAnnouncement(s) ? 'announcement' : 'suggestion'] += 1; });
  const counts = {};
  posts.forEach((s) => { if (!isAnnouncement(s)) { const k = categoryKey(s.category); counts[k] = (counts[k] || 0) + 1; } });

  const repliesBy = {};
  replies.forEach((r) => { (repliesBy[String(r.suggestion_id)] = repliesBy[String(r.suggestion_id)] || []).push(r); });

  const needle = q.trim().toLowerCase();
  const haystack = (s) => `${s.title} ${s.details || ''} ${(repliesBy[String(s.id)] || []).map((r) => r.body).join(' ')}`.toLowerCase();
  const suggestionsOnly = type === 'suggestion';
  let rows = posts.filter((s) => {
    const ann = isAnnouncement(s);
    if (type === 'announcement' && !ann) return false;
    if (suggestionsOnly && (ann || (cat !== 'all' && categoryKey(s.category) !== cat) || (status !== 'all' && s.status !== status))) return false;
    return !needle || haystack(s).includes(needle);
  });
  rows = boardOrder(rows, now, type === 'announcement' ? 'new' : sort);

  const resetFilters = () => { setType('all'); setCat('all'); setStatus('all'); setQ(''); };
  const cardProps = {
    tz, now, since, canStatus, statusOpen, isAdmin, isOrganizer, canPost, ask, onRefresh, onPatch, onEdit, onDelete,
    onVote, onReply, onDeleteReply, onHide, onHideReply,
  };

  return (
    <>
      <div className="proj-head sgb-head">
        {/* "Suggestions/Announcements" has no space: on a phone it breaks after the slash. */}
        <h1 className="wi-h"><IconMegaphone size={24} /> <span className="sgb-h1">{BOARD_LABEL.split('/')[0]}/<wbr />{BOARD_LABEL.split('/').slice(1).join('/')}</span></h1>
        <div className="spacer" />
        {canPost && !composing && <button type="button" className="btn btn-lime btn-sm" onClick={() => setComposing(true)}>+ New post</button>}
      </div>
      <BoardSwitcher boards={boards} active={board?.key} />
      <p className="sg-intro sgb-intro">
        {company
          ? 'Ideas and news for everyone at CAGE. Post a suggestion to +1 and track, or an announcement everyone sees.'
          : `Ideas and news for the ${board?.name || ''} office. Seen by its people, Directors and up, and admins.`}
      </p>
      {board?.archived && (
        <div className="banner setup sgb-archived" role="status">
          <IconArchive size={16} />
          <span>{canPost ? 'This office is archived. Only admins can post here.' : 'This office is archived, so its board is read-only.'}</span>
        </div>
      )}

      {composing && (
        <PostForm
          boardName={board?.name}
          onCancel={() => setComposing(false)}
          onSubmit={async (p) => { const ok = await onAdd(p); if (ok) { setComposing(false); resetFilters(); } return ok; }}
        />
      )}

      <div className="sgb-tools">
        <div className="sg-chips sgb-types" role="group" aria-label="Show">
          {TYPES.map((t) => {
            const n = t.key === 'all' ? posts.length : kinds[t.key];
            return (
              <button
                type="button" key={t.key} className={`sg-chip all${type === t.key ? ' on' : ''}`} aria-pressed={type === t.key}
                onClick={() => setType(t.key)}
              >
                {t.label} <span>{n}</span>
              </button>
            );
          })}
        </div>
        <label className="sg-search">
          <IconSearch size={15} />
          <input placeholder="Search posts & replies" aria-label="Search posts and replies" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {type !== 'announcement' && (
          <select className="sg-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
            <option value="new">Newest first</option>
            <option value="top">Most +1s</option>
          </select>
        )}
      </div>
      {suggestionsOnly && (
        <div className="sgb-subtools">
          <div className="sg-chips sg-filter">
            <button type="button" className={`sg-chip all${cat === 'all' ? ' on' : ''}`} onClick={() => setCat('all')}>Any category</button>
            {CATEGORIES.map((c) => (
              <button
                type="button"
                key={c.key}
                className={`sg-chip${cat === c.key ? ' on' : ''}${counts[c.key] ? '' : ' empty'}`}
                style={{ '--c': c.color }}
                onClick={() => setCat(cat === c.key ? 'all' : c.key)}
                aria-pressed={cat === c.key}
              >
                <i />{c.label}{counts[c.key] ? <span>{counts[c.key]}</span> : null}
              </button>
            ))}
          </div>
          <select className="sg-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            <option value="all">Any status</option>
            {STATUSES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="sg-empty">
          {posts.length ? 'No posts match these filters.'
            : canPost ? 'Nothing here yet — post the first suggestion or announcement.' : 'Nothing has been posted here.'}
        </div>
      ) : (
        <div className="sg-list">
          {rows.map((s) => (isAnnouncement(s)
            ? <AnnouncementCard key={s.id} s={s} replies={repliesBy[String(s.id)] || []} {...cardProps} />
            : <SuggestionCard key={s.id} s={s} replies={repliesBy[String(s.id)] || []} {...cardProps} />))}
        </div>
      )}
      {confirmUI}
    </>
  );
}
