'use client';
import { useEffect, useRef, useState } from 'react';
import { IconAlert, IconArchive, IconCaret, IconCheck, IconPencil, IconRestore } from '@/app/icons';
import { ConflictError } from '@/app/_ui/api';
import { fmtYmd } from '@/app/_ui/project-format';
import { attentionFlag, sortAttention, sortReceived } from '@/lib/projects';
import { DateField } from './Submittals';

// Attention Items (design-amendments A8.3): what we need from third parties (owner, client, architect, a village, a
// person...), who it's from, and optionally when we need it by. Open items sort by need-by (dated first, oldest
// first; undated last); a need-by before today (Central) is flagged Overdue (red), today or within 7 days Due soon
// (amber). Each open item: Received (stamps today; the date stays editable in the Received list), Edit (a draft: the
// base is frozen when it opens, Save sends only what changed, a 409 shows their version) and Archive (confirm). A
// collapsed "Received (N)" list shows the received ones with their dates and Re-open. "Show archived" lists the
// archived ones with Restore. Anyone who can see the project; every open item goes in the weekly owner report.

const EMPTY = { item: '', from_party: '', need_by: '' };
const toForm = (a) => ({ item: a.item || '', from_party: a.from_party || '', need_by: a.need_by || '' });

function ItemForm({ initial, listId, submitLabel, onSubmit, onCancel, onDirty }) {
  const base = useRef(initial ? toForm(initial) : { ...EMPTY });
  const [f, setF] = useState(() => ({ ...base.current }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [conflict, setConflict] = useState(null);           // { message, current }
  const dirty = Object.keys(EMPTY).some((k) => f[k] !== base.current[k]);
  const dirtyRef = useRef(onDirty);
  dirtyRef.current = onDirty;
  useEffect(() => { if (dirtyRef.current) dirtyRef.current(dirty); }, [dirty]);
  useEffect(() => () => { if (dirtyRef.current) dirtyRef.current(false); }, []);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = async (e, bases = base.current) => {
    e?.preventDefault?.();
    if (busy) return;
    if (!f.item.trim()) { setErr('Say what is needed.'); return; }
    setBusy(true);
    setErr(null);
    try {
      await onSubmit(f, bases);
    } catch (e2) {
      setBusy(false);
      if (e2 instanceof ConflictError) setConflict({ message: e2.message, current: e2.current || {} });
      else setErr(e2?.message || 'Couldn’t save — please try again.');
    }
  };

  return (
    <form className="um-form at-form" onSubmit={submit} noValidate>
      <div className="at-form-grid">
        <label className="um-f at-f-item"><span>What’s needed</span>
          <input className="field" value={f.item} onChange={set('item')} maxLength={500} placeholder="e.g. Signed engineering agreement, geotech report, title commitment" required autoFocus={!initial} />
        </label>
        <label className="um-f at-f-from"><span>From</span>
          <input className="field" value={f.from_party} onChange={set('from_party')} maxLength={200} list={listId} placeholder="Owner, Architect, Village of…" autoComplete="off" />
        </label>
        <label className="um-f at-f-date"><span>Need by <i>(optional)</i></span>
          <input type="date" className="field" value={f.need_by} onChange={set('need_by')} />
        </label>
      </div>
      {conflict && (
        <div className="pd-conflict" role="alert">
          <p><b>{conflict.message}</b></p>
          <p>Their version: <b>{conflict.current.item || '—'}</b>{conflict.current.from_party ? ` · from ${conflict.current.from_party}` : ''}</p>
        </div>
      )}
      {err && <p className="ofc-dialog-err" role="alert">{err}</p>}
      <div className="um-form-actions">
        {conflict ? (
          <>
            <button type="button" className="btn btn-plain btn-sm" onClick={onCancel}>Discard mine</button>
            <button
              type="button"
              className="btn btn-ink btn-sm"
              onClick={() => {
                const cur = conflict.current;
                setConflict(null);
                submit(null, { ...base.current, item: cur.item ?? base.current.item, from_party: cur.from_party ?? base.current.from_party });
              }}
            >Overwrite with mine</button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-plain btn-sm" onClick={onCancel} disabled={busy}>Cancel</button>
            <button type="submit" className="btn btn-lime btn-sm" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
          </>
        )}
      </div>
    </form>
  );
}

// The need-by cell: the date with its flag (Overdue red, Due soon amber), or "No date".
function NeedBy({ a, today }) {
  if (!a.need_by) return <span className="at-due none">No need-by date</span>;
  const flag = attentionFlag(a.need_by, today);
  return (
    <span className={`at-due${flag ? ` ${flag}` : ''}`} data-flag={flag}>
      <span className="at-due-k">{flag === 'overdue' && <IconAlert size={11} />}{flag === 'overdue' ? 'Overdue' : flag === 'soon' ? 'Due soon' : 'Need by'}</span>
      <span className="at-due-v">{fmtYmd(a.need_by, { weekday: true })}</span>
    </span>
  );
}

function OpenRow({ a, ro, today, onEdit, actions }) {
  const flag = attentionFlag(a.need_by, today);
  return (
    <li className={`at-row${flag ? ` ${flag}` : ''}`} data-id={a.id} data-flag={flag}>
      <div className="at-main">
        <span className="at-item">{a.item}</span>
        <span className="at-from">{a.from_party ? <>From <b>{a.from_party}</b></> : <span className="muted">From: not set</span>}</span>
      </div>
      <div className="at-when"><NeedBy a={a} today={today} /></div>
      {!ro && (
        <div className="at-act">
          <button type="button" className="btn btn-plain btn-xs wi at-recv" title="Mark received (today)" onClick={() => actions.receiveAttention(a)}>
            <IconCheck size={12} /> Received
          </button>
          <button type="button" className="btn btn-plain btn-xs wi at-edit" onClick={() => onEdit(a)}><IconPencil size={12} /> Edit</button>
          <button type="button" className="row-icon at-archive" title="Archive this item" aria-label={`Archive ${a.item}`} onClick={() => actions.archiveAttention(a)}>
            <IconArchive size={15} />
          </button>
        </div>
      )}
    </li>
  );
}

function ReceivedRow({ a, ro, actions }) {
  return (
    <li className="at-row at-received" data-id={a.id}>
      <div className="at-main">
        <span className="at-item">{a.item}</span>
        <span className="at-from">{a.from_party ? <>From <b>{a.from_party}</b></> : <span className="muted">From: not set</span>}</span>
      </div>
      <label className="at-when at-rdate">
        <span className="at-due-k">Received</span>
        {ro ? <span className="at-due-v">{fmtYmd(a.received_date) || '—'}</span> : (
          <DateField
            value={a.received_date}
            required
            onSave={(d) => actions.patchAttention(a.id, { received_date: d })}
            aria-label={`Date received for ${a.item}`}
          />
        )}
      </label>
      {!ro && (
        <div className="at-act">
          <button type="button" className="btn btn-plain btn-xs wi at-reopen" onClick={() => actions.reopenAttention(a)}><IconRestore size={12} /> Re-open</button>
          <button type="button" className="row-icon at-archive" title="Archive this item" aria-label={`Archive ${a.item}`} onClick={() => actions.archiveAttention(a)}>
            <IconArchive size={15} />
          </button>
        </div>
      )}
    </li>
  );
}

export default function AttentionItems({ items, today, fromOptions, ctx }) {
  const { ro, actions, pid } = ctx;
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);             // item id
  const [showReceived, setShowReceived] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [dirty, setDirty] = useState({});
  const markDirty = (k) => (v) => setDirty((s) => (!!s[k] === !!v ? s : { ...s, [k]: !!v }));
  const anyDirty = Object.values(dirty).some(Boolean);
  const dirtyRef = useRef(actions.setDraftDirty);
  dirtyRef.current = actions.setDraftDirty;
  useEffect(() => { if (dirtyRef.current) dirtyRef.current('attention', anyDirty); }, [anyDirty]);
  useEffect(() => { if (ro) { setAdding(false); setEditing(null); } }, [ro]);

  const list = items || [];
  const live = list.filter((a) => !a.archived);
  const open = sortAttention(live.filter((a) => a.status !== 'received'));
  const received = sortReceived(live.filter((a) => a.status === 'received'));
  const archived = list.filter((a) => a.archived);
  const late = open.filter((a) => attentionFlag(a.need_by, today) === 'overdue').length;
  const listId = `at-from-${pid}`;

  const openRow = (a) => (editing === a.id && !ro ? (
    <li key={a.id} className="at-row at-editing" data-id={a.id}>
      <ItemForm
        initial={a}
        listId={listId}
        submitLabel="Save"
        onDirty={markDirty(`edit:${a.id}`)}
        onCancel={() => setEditing(null)}
        onSubmit={async (f, bases) => { await actions.saveAttention(a, f, bases); setEditing(null); }}
      />
    </li>
  ) : (
    <OpenRow key={a.id} a={a} ro={ro} today={today} onEdit={(x) => setEditing(x.id)} actions={actions} />
  ));

  return (
    <section className="info-panel at-panel" id={ctx.review ? undefined : 'attention-items'} data-section="attention-items" aria-labelledby={ctx.review ? `at-h-${pid}` : 'at-h'}>
      <div className="info-head">
        <h2 className="notes-label sec-h" id={ctx.review ? `at-h-${pid}` : 'at-h'}>
          <IconAlert size={14} /> Attention Items
          {late > 0 && <b className="at-late-count">{late} overdue</b>}
          <span>· open ones go in the weekly owner report</span>
        </h2>
        <div className="sec-actions">
          {archived.length > 0 && (
            <button type="button" className="btn btn-plain btn-sm" aria-pressed={showArchived} onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? 'Hide archived' : `Show archived (${archived.length})`}
            </button>
          )}
          {!ro && <button type="button" className="btn btn-lime btn-sm" onClick={() => setAdding(true)} disabled={adding}>+ Add item</button>}
        </div>
      </div>
      <datalist id={listId}>
        {(fromOptions || []).map((v) => <option key={v} value={v} />)}
      </datalist>
      {adding && !ro && (
        <div className="um-new at-new">
          <ItemForm
            listId={listId}
            submitLabel="Add item"
            onDirty={markDirty('new')}
            onCancel={() => setAdding(false)}
            onSubmit={async (f) => { await actions.createAttention(f); setAdding(false); }}
          />
        </div>
      )}
      {open.length > 0 ? (
        <ul className="at-list" aria-label="Open attention items">{open.map(openRow)}</ul>
      ) : (
        !adding && <p className="info-empty">{received.length ? 'Nothing open. Everything we asked for has come in.' : `No attention items${ro || ctx.review ? '.' : ' — add what you need from the owner, the architect, the village or anyone else, with the date you need it by.'}`}</p>
      )}
      {received.length > 0 && (
        <div className="at-recv-wrap">
          <button
            type="button"
            className="at-recv-toggle"
            aria-expanded={showReceived}
            aria-controls={`at-recv-${pid}`}
            onClick={() => setShowReceived((v) => !v)}
          >
            <IconCaret size={12} className={showReceived ? 'open' : undefined} /> Received ({received.length})
          </button>
          {showReceived && (
            <ul className="at-list at-list-received" id={`at-recv-${pid}`} aria-label="Received attention items">
              {received.map((a) => <ReceivedRow key={a.id} a={a} ro={ro} actions={actions} />)}
            </ul>
          )}
        </div>
      )}
      {showArchived && archived.length > 0 && (
        <div className="sub-archived">
          <h3 className="sub-archived-h"><IconArchive size={14} /> Archived items</h3>
          <ul className="sub-list sub-list-archived" aria-label="Archived attention items">
            {archived.map((a) => (
              <li key={a.id} className="sub-arow at-arow" data-id={a.id}>
                <span className="sub-arow-main">
                  <b>{a.item}</b>{a.from_party ? ` · from ${a.from_party}` : ''}
                  {a.status === 'received' && a.received_date ? ` · received ${fmtYmd(a.received_date)}` : ''}
                </span>
                {!ro && (
                  <button type="button" className="btn btn-plain btn-sm wi" onClick={() => actions.patchAttention(a.id, { archived: false })}>
                    <IconRestore size={13} /> Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
