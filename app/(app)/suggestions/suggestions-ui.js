'use client';
import { useState } from 'react';
import { CATEGORIES, STATUSES, categoryOf, categoryKey, statusOf } from '@/lib/suggestions';
import { IconBulb, IconChevronUp, IconSearch, IconPencil, IconTrash, IconChat, IconEye, IconEyeOff } from '@/app/icons';
import { Headshot } from '@/app/_ui/Headshot';
import NameLabel from '@/app/_ui/NameLabel';
import { useConfirm } from '@/app/_ui/ConfirmDialog';
import { DraftConflict } from '@/app/_ui/ConflictNotice';
import './suggestions.css';

// ---- suggestion box --------------------------------------------------------
// Ported from app/suggestions-ui.js (inventory §1.15). Anyone signed in can post an idea (optionally
// anonymously), +1 ideas they like, reply, and follow what happens with them. Only an idea's author can
// edit or delete it. Status: anyone while the company is small (fewer than 50 active users), then culture
// organizers and admins (canStatus comes from the server). Admins can hide a suggestion or a reply.
// Every row arrives already masked by the server: an anonymous author is never sent (rule 28).

// Dates render in the viewer's office time zone, built from parts, so the server HTML and the browser
// agree (no hydration mismatch from the host's zone or from ICU's narrow no-break space before "PM").
const fmts = new Map();
function partsOf(v, tz, opts) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const key = `${tz || ''}|${JSON.stringify(opts)}`;
  let f = fmts.get(key);
  if (!f) {
    try { f = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: tz || undefined }); }
    catch { f = new Intl.DateTimeFormat('en-US', opts); }
    fmts.set(key, f);
  }
  return Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
}
// "Oct 2, 2026"
function fmtDay(v, tz) {
  const p = partsOf(v, tz, { month: 'short', day: 'numeric', year: 'numeric' });
  return p ? `${p.month} ${p.day}, ${p.year}` : '';
}
// "Oct 2, 3:14 PM" for replies (they often happen on the same day).
function fmtWhen(v, tz) {
  const p = partsOf(v, tz, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  return p ? `${p.month} ${p.day}, ${p.hour}:${p.minute} ${p.dayPeriod || ''}`.trim() : '';
}

function SuggestionForm({ initial, onCancel, onSubmit }) {
  const [title, setTitle] = useState(initial ? initial.title : '');
  const [details, setDetails] = useState(initial ? initial.details || '' : '');
  const [category, setCategory] = useState(initial ? categoryKey(initial.category) : '');
  const [anonymous, setAnonymous] = useState(initial ? !!initial.anonymous : false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(null);

  // overwrite: resend over the newer version the server reported (draft editors, design §7.4).
  const submit = async (overwrite = null) => {
    if (busy) return;
    if (!title.trim()) { setErr('Give your suggestion a short title.'); return; }
    if (!category) { setErr('Pick a category.'); return; }
    setErr('');
    setBusy(true);
    const res = await onSubmit({ title: title.trim(), details: details.trim(), category, anonymous }, overwrite);
    setBusy(false);
    if (res && res.conflict) { setConflict(res.conflict); return; }
    setConflict(null);
    if (res === false) setErr('Couldn’t save — please try again.');
  };

  return (
    <div className="sg-form">
      <h3>{initial ? 'Edit suggestion' : 'New suggestion'}</h3>
      <label className="atm-label" htmlFor="sg-title">Your idea</label>
      <input
        id="sg-title"
        className="field"
        autoFocus
        maxLength={160}
        placeholder="e.g. Monthly lunch-and-learn on Civil 3D tips"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
      />
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
      {err && <div className="bk-err" role="alert">{err}</div>}
      <DraftConflict
        conflict={conflict}
        labels={{ title: 'Your idea', details: 'Details' }}
        onOverwrite={() => submit(conflict.current)}
        onDiscard={() => { setConflict(null); onCancel(true); }}
      />
      <div className="modal-actions">
        <button type="button" className="btn btn-plain" onClick={() => onCancel(false)} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-ink" onClick={() => submit()} disabled={busy}>{busy ? 'Saving…' : initial ? 'Save changes' : 'Post suggestion'}</button>
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

function SuggestionCard({ s, replies, tz, canStatus, statusOpen, isAdmin, ask, onRefresh, onPatch, onEdit, onDelete, onVote, onReply, onDeleteReply, onHide, onHideReply }) {
  const [editing, setEditing] = useState(null);       // the values the edit started from (its frozen base)
  const [expanded, setExpanded] = useState(false);
  const [threadOpen, setThreadOpen] = useState(false);
  const c = categoryOf(s.category);
  if (editing) {
    const start = editing;
    return (
      <SuggestionForm
        initial={s}
        onCancel={(reload) => { setEditing(null); if (reload) onRefresh(); }}
        onSubmit={async (p, overwrite) => {
          const base = overwrite ? { ...start, title: overwrite.title ?? start.title, details: overwrite.details ?? start.details } : start;
          const changes = {};
          for (const k of ['title', 'details', 'category', 'anonymous']) if (p[k] !== base[k]) changes[k] = p[k];
          if (!Object.keys(changes).length) { setEditing(null); return true; }
          const res = await onEdit(s.id, changes, { title: base.title, details: base.details });
          if (res === true) setEditing(null);
          return res;
        }}
      />
    );
  }
  const long = (s.details || '').length > 280 || (s.details || '').split('\n').length > 5;
  return (
    <article className={`sg-card st-${s.status}${s.hidden ? ' sg-hidden' : ''}`}>
      <button
        type="button"
        className={`sg-vote${s.voted ? ' on' : ''}`}
        onClick={() => onVote(s.id, !s.voted)}
        title={s.voted ? 'Take back your +1' : '+1 this idea'}
        aria-pressed={!!s.voted}
      >
        <IconChevronUp size={18} />
        <b>{s.votes}</b>
      </button>
      <div className="sg-body">
        <div className="sg-top">
          <span className="sg-cat" style={{ '--c': c.color }}>{c.label}</span>
          <StatusControl s={s} canStatus={canStatus} statusOpen={statusOpen} onPatch={onPatch} />
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
          <span>· {fmtDay(s.created_at, tz)}</span>
          {s.mine && (
            <>
              <span className="sg-mine">· yours{s.anonymous ? ' (only you can see that)' : ''}</span>
              <button type="button" className="sg-icon-btn" onClick={() => setEditing({ title: s.title, details: s.details || '', category: categoryKey(s.category), anonymous: !!s.anonymous })} title="Edit your suggestion" aria-label="Edit your suggestion"><IconPencil size={13} /></button>
              <button
                type="button"
                className="sg-icon-btn danger"
                onClick={async () => {
                  if (await ask({ title: `Delete “${s.title}”?`, lines: ['This can’t be undone.'], confirmLabel: 'Delete', danger: true })) onDelete(s.id);
                }}
                title="Delete your suggestion"
                aria-label="Delete your suggestion"
              ><IconTrash size={13} /></button>
            </>
          )}
          {isAdmin && (
            <button
              type="button"
              className="sg-icon-btn"
              onClick={() => onHide(s.id, !s.hidden)}
              title={s.hidden ? 'Unhide: show it to everyone again' : 'Hide from everyone except admins'}
              aria-label={s.hidden ? 'Unhide suggestion' : 'Hide suggestion'}
            >{s.hidden ? <IconEye size={13} /> : <IconEyeOff size={13} />}</button>
          )}
          <button type="button" className={`sg-reply-toggle${threadOpen ? ' on' : ''}`} onClick={() => setThreadOpen((x) => !x)} aria-expanded={threadOpen}>
            <IconChat size={14} /> {replies.length ? `${replies.length} repl${replies.length === 1 ? 'y' : 'ies'}` : 'Reply'}
          </button>
        </div>
        {threadOpen && (
          <ReplyThread
            replies={replies}
            tz={tz}
            isAdmin={isAdmin}
            ask={ask}
            onReply={(body) => onReply(s.id, body)}
            onDeleteReply={onDeleteReply}
            onHideReply={onHideReply}
          />
        )}
      </div>
    </article>
  );
}

function ReplyThread({ replies, tz, isAdmin, ask, onReply, onDeleteReply, onHideReply }) {
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
                <span>{fmtWhen(r.created_at, tz)}</span>
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
    </div>
  );
}

// embedded (Release 2, a thread space's Suggestions tab): no page heading, the intro line and "+ New suggestion"
// share one row. intro replaces the default intro text; canPost false hides "+ New suggestion" (archived space).
export default function SuggestionsView({
  suggestions, replies = [], tz, canStatus = true, statusOpen = true, isAdmin = false,
  onAdd, onPatch, onEdit, onDelete, onVote, onReply, onDeleteReply, onHide, onHideReply, onRefresh,
  embedded = false, intro = null, canPost = true,
}) {
  const [composing, setComposing] = useState(false);
  const [cat, setCat] = useState('all');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('new');
  const [q, setQ] = useState('');
  const [confirmUI, ask] = useConfirm();

  const counts = {};
  suggestions.forEach((s) => { const k = categoryKey(s.category); counts[k] = (counts[k] || 0) + 1; });

  const repliesBy = {};
  replies.forEach((r) => { (repliesBy[String(r.suggestion_id)] = repliesBy[String(r.suggestion_id)] || []).push(r); });

  const needle = q.trim().toLowerCase();
  const haystack = (s) => `${s.title} ${s.details || ''} ${(repliesBy[String(s.id)] || []).map((r) => r.body).join(' ')}`.toLowerCase();
  let rows = suggestions.filter((s) =>
    (cat === 'all' || categoryKey(s.category) === cat)
    && (status === 'all' || s.status === status)
    && (!needle || haystack(s).includes(needle)));
  const newest = (a, b) => (new Date(b.created_at) - new Date(a.created_at)) || (Number(b.id) - Number(a.id));
  rows = [...rows].sort(sort === 'top' ? (a, b) => (b.votes - a.votes) || newest(a, b) : newest);

  return (
    <>
      {embedded ? (
        <div className="sg-embed-head">
          <p className="sg-intro">{intro || 'Ideas to make the office better. Anyone can post one, +1 the ideas they like, and follow what happens with them.'}</p>
          {canPost && !composing && <button type="button" className="btn btn-lime btn-sm" onClick={() => setComposing(true)}>+ New suggestion</button>}
        </div>
      ) : (
        <>
          <div className="proj-head">
            <h1 className="wi-h"><IconBulb size={24} /> Suggestions</h1>
            {canPost && !composing && <button type="button" className="btn btn-lime btn-sm" onClick={() => setComposing(true)}>+ New suggestion</button>}
          </div>
          <p className="sg-intro">{intro || 'Ideas to make the office better. Anyone can post one, +1 the ideas they like, and follow what happens with them.'}</p>
        </>
      )}

      {composing && (
        <SuggestionForm
          onCancel={() => setComposing(false)}
          onSubmit={async (p) => { const ok = await onAdd(p); if (ok) { setComposing(false); setCat('all'); setStatus('all'); setQ(''); } return ok; }}
        />
      )}

      <div className="sg-chips sg-filter">
        <button type="button" className={`sg-chip all${cat === 'all' ? ' on' : ''}`} onClick={() => setCat('all')}>All <span>{suggestions.length}</span></button>
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
      <div className="sg-tools">
        <label className="sg-search">
          <IconSearch size={15} />
          <input placeholder="Search suggestions & replies" aria-label="Search suggestions and replies" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <select className="sg-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="all">Any status</option>
          {STATUSES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
        </select>
        <select className="sg-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          <option value="new">Newest first</option>
          <option value="top">Most +1s</option>
        </select>
      </div>

      {rows.length === 0 ? (
        <div className="sg-empty">{suggestions.length ? 'No suggestions match these filters.' : canPost ? 'No suggestions yet — be the first to post one!' : 'No suggestions here.'}</div>
      ) : (
        <div className="sg-list">
          {rows.map((s) => (
            <SuggestionCard
              key={s.id} s={s} replies={repliesBy[String(s.id)] || []} tz={tz}
              canStatus={canStatus} statusOpen={statusOpen} isAdmin={isAdmin} ask={ask} onRefresh={onRefresh}
              onPatch={onPatch} onEdit={onEdit} onDelete={onDelete} onVote={onVote} onReply={onReply}
              onDeleteReply={onDeleteReply} onHide={onHide} onHideReply={onHideReply}
            />
          ))}
        </div>
      )}
      {confirmUI}
    </>
  );
}
