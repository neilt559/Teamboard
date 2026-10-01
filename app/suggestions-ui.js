'use client';
import { useState } from 'react';
import { CATEGORIES, STATUSES, categoryOf, statusOf } from '@/lib/suggestions';
import { IconBulb, IconChevronUp, IconSearch, IconPencil, IconTrash } from './icons';
import { Headshot } from './bracket-ui';

// ---- suggestion box --------------------------------------------------------
// Anyone signed in can post an idea (optionally anonymously), +1 ideas they
// like, and move an idea's status along (New → Under review → Planned → Done,
// or Not now). Only an idea's author can edit or delete it.

function fmtDay(v) {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function SuggestionForm({ initial, onCancel, onSubmit }) {
  const [title, setTitle] = useState(initial ? initial.title : '');
  const [details, setDetails] = useState(initial ? initial.details || '' : '');
  const [category, setCategory] = useState(initial ? initial.category : '');
  const [anonymous, setAnonymous] = useState(initial ? !!initial.anonymous : false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim()) { setErr('Give your suggestion a short title.'); return; }
    if (!category) { setErr('Pick a category.'); return; }
    setErr('');
    setBusy(true);
    const ok = await onSubmit({ title: title.trim(), details: details.trim(), category, anonymous });
    setBusy(false);
    if (ok === false) setErr('Couldn’t save — please try again.');
  };

  return (
    <div className="sg-form">
      <h3>{initial ? 'Edit suggestion' : 'New suggestion'}</h3>
      <label className="atm-label">Your idea</label>
      <input
        className="field"
        autoFocus
        maxLength={160}
        placeholder="e.g. Monthly lunch-and-learn on Civil 3D tips"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
      />
      <label className="atm-label">Category</label>
      <div className="sg-chips">
        {CATEGORIES.map((c) => (
          <button type="button" key={c.key} className={`sg-chip${category === c.key ? ' on' : ''}`} style={{ '--c': c.color }} onClick={() => setCategory(c.key)}>
            <i />{c.label}
          </button>
        ))}
      </div>
      <label className="atm-label">Details <span className="login-opt">(optional)</span></label>
      <textarea className="notes-area" rows={4} placeholder="Why it matters, how it could work, who it would help…" value={details} onChange={(e) => setDetails(e.target.value)} />
      <label className="sg-anon-check">
        <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
        <span><b>Post anonymously</b> — your name won’t be shown to anyone. The site still knows it’s yours, so only you can edit or delete it.</span>
      </label>
      {err && <div className="bk-err">{err}</div>}
      <div className="modal-actions">
        <button className="btn btn-plain" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="btn btn-ink" onClick={submit} disabled={busy}>{busy ? 'Saving…' : initial ? 'Save changes' : 'Post suggestion'}</button>
      </div>
    </div>
  );
}

function SuggestionCard({ s, author, onPatch, onDelete, onVote }) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const c = categoryOf(s.category);
  const st = statusOf(s.status);
  if (editing) {
    return <SuggestionForm initial={s} onCancel={() => setEditing(false)} onSubmit={async (p) => { const ok = await onPatch(s.id, p); if (ok !== false) setEditing(false); return ok; }} />;
  }
  const long = (s.details || '').length > 280 || (s.details || '').split('\n').length > 5;
  return (
    <article className={`sg-card st-${s.status}`}>
      <button
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
          <select
            className="sg-status"
            value={s.status}
            style={{ '--s': st.color }}
            onChange={(e) => onPatch(s.id, { status: e.target.value })}
            title="Anyone can update the status"
          >
            {STATUSES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </div>
        <h3 className="sg-title">{s.title}</h3>
        {s.details && <p className={`sg-details${long && !expanded ? ' clamp' : ''}`}>{s.details}</p>}
        {long && <button className="bk-link" onClick={() => setExpanded((x) => !x)}>{expanded ? 'Show less' : 'Show more'}</button>}
        <div className="sg-meta">
          {s.anonymous
            ? <span className="sg-anon">Anonymous</span>
            : <span className="sg-author">{author && <Headshot user={author} size={18} />} {author ? author.username : 'Former member'}</span>}
          <span>· {fmtDay(s.created_at)}</span>
          {s.mine && (
            <>
              <span className="sg-mine">· yours{s.anonymous ? ' (only you can see that)' : ''}</span>
              <button className="sg-icon-btn" onClick={() => setEditing(true)} title="Edit your suggestion"><IconPencil size={13} /></button>
              <button
                className="sg-icon-btn danger"
                onClick={() => { if (confirm(`Delete “${s.title}”?\n\nThis can’t be undone.`)) onDelete(s.id); }}
                title="Delete your suggestion"
              ><IconTrash size={13} /></button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

export default function SuggestionsView({ suggestions, users, onAdd, onPatch, onDelete, onVote }) {
  const [composing, setComposing] = useState(false);
  const [cat, setCat] = useState('all');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('new');
  const [q, setQ] = useState('');

  const usersById = {};
  users.forEach((u) => { usersById[String(u.id)] = u; });
  const counts = {};
  suggestions.forEach((s) => { counts[s.category] = (counts[s.category] || 0) + 1; });

  const needle = q.trim().toLowerCase();
  let rows = suggestions.filter((s) =>
    (cat === 'all' || s.category === cat)
    && (status === 'all' || s.status === status)
    && (!needle || `${s.title} ${s.details || ''}`.toLowerCase().includes(needle)));
  const newest = (a, b) => (new Date(b.created_at) - new Date(a.created_at)) || (Number(b.id) - Number(a.id));
  rows = [...rows].sort(sort === 'top' ? (a, b) => (b.votes - a.votes) || newest(a, b) : newest);

  return (
    <>
      <div className="proj-head">
        <h1 className="wi-h"><IconBulb size={24} /> Suggestions</h1>
        {!composing && <button className="btn btn-lime btn-sm" onClick={() => setComposing(true)}>+ New suggestion</button>}
      </div>
      <p className="sg-intro">Ideas to make the office better. Anyone can post one, +1 the ideas they like, and follow what happens with them.</p>

      {composing && (
        <SuggestionForm
          onCancel={() => setComposing(false)}
          onSubmit={async (p) => { const ok = await onAdd(p); if (ok) { setComposing(false); setCat('all'); setStatus('all'); setQ(''); } return ok; }}
        />
      )}

      <div className="sg-chips sg-filter">
        <button className={`sg-chip all${cat === 'all' ? ' on' : ''}`} onClick={() => setCat('all')}>All <span>{suggestions.length}</span></button>
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            className={`sg-chip${cat === c.key ? ' on' : ''}${counts[c.key] ? '' : ' empty'}`}
            style={{ '--c': c.color }}
            onClick={() => setCat(cat === c.key ? 'all' : c.key)}
          >
            <i />{c.label}{counts[c.key] ? <span>{counts[c.key]}</span> : null}
          </button>
        ))}
      </div>
      <div className="sg-tools">
        <label className="sg-search">
          <IconSearch size={15} />
          <input placeholder="Search suggestions" value={q} onChange={(e) => setQ(e.target.value)} />
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
        <div className="sg-empty">{suggestions.length ? 'No suggestions match these filters.' : 'No suggestions yet — be the first to post one!'}</div>
      ) : (
        <div className="sg-list">
          {rows.map((s) => (
            <SuggestionCard key={s.id} s={s} author={usersById[String(s.author_id)]} onPatch={onPatch} onDelete={onDelete} onVote={onVote} />
          ))}
        </div>
      )}
    </>
  );
}
