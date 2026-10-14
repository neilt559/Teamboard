'use client';
import { useEffect, useRef, useState } from 'react';
import { IconArchive, IconCalendar, IconPencil, IconRestore } from '@/app/icons';
import { ConflictError } from '@/app/_ui/api';
import { fmtHhmm, fmtYmd } from '@/app/_ui/project-format';

// Upcoming meetings (design-amendments A6.2, A6.5): a simple list, separate from the meeting minutes, sorted by
// date and time: date, time, what / with whom, where. "+ Add meeting", Edit (a draft: the base is frozen when it
// opens, Save sends only what changed; a 409 shows their version with Overwrite / Discard) and Archive (confirm).
// Past ones stay (nothing is deleted) and hide behind "Show past"; archived ones behind "Show archived". The weekly
// owner report lists the ones from today on.

const EMPTY = { meeting_date: '', meeting_time: '', title: '', location: '' };
const toForm = (m) => ({ meeting_date: m.meeting_date || '', meeting_time: m.meeting_time || '', title: m.title || '', location: m.location || '' });

function MeetingForm({ initial, today, submitLabel, onSubmit, onCancel, onDirty }) {
  const base = useRef(initial ? toForm(initial) : { ...EMPTY, meeting_date: today || '' });
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
    if (!f.meeting_date) { setErr('Pick the meeting date.'); return; }
    if (!f.title.trim()) { setErr('Say what the meeting is (and with whom).'); return; }
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
    <form className="um-form" onSubmit={submit} noValidate>
      <div className="um-form-grid">
        <label className="um-f um-f-date"><span>Date</span>
          <input type="date" className="field" value={f.meeting_date} onChange={set('meeting_date')} required />
        </label>
        <label className="um-f um-f-time"><span>Time <i>(optional)</i></span>
          <input type="time" className="field" value={f.meeting_time} onChange={set('meeting_time')} />
        </label>
        <label className="um-f um-f-title"><span>What / with whom</span>
          <input className="field" value={f.title} onChange={set('title')} maxLength={300} placeholder="e.g. Pre-application meeting with Village staff" required autoFocus={!initial} />
        </label>
        <label className="um-f um-f-loc"><span>Where <i>(optional)</i></span>
          <input className="field" value={f.location} onChange={set('location')} maxLength={300} placeholder="e.g. Village Hall, or Teams" />
        </label>
      </div>
      {conflict && (
        <div className="pd-conflict" role="alert">
          <p><b>{conflict.message}</b></p>
          <p>Their version: <b>{conflict.current.title || '—'}</b>{conflict.current.location ? ` · ${conflict.current.location}` : ''}</p>
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
                submit(null, { ...base.current, title: cur.title ?? base.current.title, location: cur.location ?? base.current.location });
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

function MeetingRow({ m, ro, onEdit, onArchive, onRestore }) {
  return (
    <li className={`um-row${m.past ? ' past' : ''}${m.archived ? ' archived' : ''}`} data-id={m.id}>
      <div className="um-when">
        <span className="um-date">{fmtYmd(m.meeting_date, { weekday: true })}</span>
        <span className="um-time">{m.meeting_time ? fmtHhmm(m.meeting_time) : <span className="muted">No time set</span>}</span>
      </div>
      <div className="um-main">
        <span className="um-title">{m.title}</span>
        {m.location && <span className="um-loc">{m.location}</span>}
        {(m.past || m.archived) && <span className="um-tags">{m.past && <span className="lt-chip">Past</span>}{m.archived && <span className="lt-chip">Archived</span>}</span>}
      </div>
      {!ro && (
        <div className="um-act">
          {m.archived ? (
            <button type="button" className="btn btn-plain btn-xs wi" onClick={() => onRestore(m)}><IconRestore size={12} /> Restore</button>
          ) : (
            <>
              <button type="button" className="btn btn-plain btn-xs wi" onClick={() => onEdit(m)}><IconPencil size={12} /> Edit</button>
              <button type="button" className="row-icon um-archive" title="Archive this meeting" aria-label={`Archive ${m.title}`} onClick={() => onArchive(m)}><IconArchive size={15} /></button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

export default function UpcomingMeetings({ meetings, today, ctx }) {
  const { ro, actions } = ctx;
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);             // meeting id
  const [showPast, setShowPast] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [dirty, setDirty] = useState({});
  const markDirty = (k) => (v) => setDirty((s) => (!!s[k] === !!v ? s : { ...s, [k]: !!v }));
  const anyDirty = Object.values(dirty).some(Boolean);
  const dirtyRef = useRef(actions.setDraftDirty);
  dirtyRef.current = actions.setDraftDirty;
  useEffect(() => { if (dirtyRef.current) dirtyRef.current('upcoming', anyDirty); }, [anyDirty]);
  useEffect(() => { if (ro) { setAdding(false); setEditing(null); } }, [ro]);

  const list = meetings || [];
  const live = list.filter((m) => !m.archived);
  const upcoming = live.filter((m) => !m.past);
  const past = live.filter((m) => m.past);
  const archived = list.filter((m) => m.archived);
  const shown = [...upcoming, ...(showPast ? past : [])];

  const row = (m) => (editing === m.id && !ro ? (
    <li key={m.id} className="um-row um-editing" data-id={m.id}>
      <MeetingForm
        initial={m}
        today={today}
        submitLabel="Save"
        onDirty={markDirty(`edit:${m.id}`)}
        onCancel={() => setEditing(null)}
        onSubmit={async (f, bases) => { await actions.saveUpcoming(m, f, bases); setEditing(null); }}
      />
    </li>
  ) : (
    <MeetingRow key={m.id} m={m} ro={ro} onEdit={(x) => setEditing(x.id)} onArchive={actions.archiveUpcoming} onRestore={(x) => actions.patchUpcoming(x.id, { archived: false })} />
  ));

  return (
    <section className="info-panel um-panel" id="upcoming-meetings" aria-labelledby="um-h">
      <div className="info-head">
        <h2 className="notes-label sec-h" id="um-h"><IconCalendar size={14} /> Upcoming meetings <span>· in the weekly owner report</span></h2>
        <div className="sec-actions">
          {past.length > 0 && (
            <button type="button" className="btn btn-plain btn-sm" aria-pressed={showPast} onClick={() => setShowPast((v) => !v)}>
              {showPast ? 'Hide past' : `Show past (${past.length})`}
            </button>
          )}
          {archived.length > 0 && (
            <button type="button" className="btn btn-plain btn-sm" aria-pressed={showArchived} onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? 'Hide archived' : `Show archived (${archived.length})`}
            </button>
          )}
          {!ro && <button type="button" className="btn btn-lime btn-sm" onClick={() => setAdding(true)} disabled={adding}>+ Add meeting</button>}
        </div>
      </div>
      {adding && !ro && (
        <div className="um-new">
          <MeetingForm
            today={today}
            submitLabel="Add meeting"
            onDirty={markDirty('new')}
            onCancel={() => setAdding(false)}
            onSubmit={async (f) => { await actions.createUpcoming(f); setAdding(false); }}
          />
        </div>
      )}
      {shown.length > 0 ? (
        <ul className="um-list" aria-label="Upcoming meetings">{shown.map(row)}</ul>
      ) : (
        !adding && <p className="info-empty">{past.length ? 'No upcoming meetings. Past ones are under “Show past”.' : 'No upcoming meetings yet.'}</p>
      )}
      {showArchived && archived.length > 0 && (
        <div className="sub-archived">
          <h3 className="sub-archived-h"><IconArchive size={14} /> Archived meetings</h3>
          <ul className="um-list" aria-label="Archived meetings">{archived.map(row)}</ul>
        </div>
      )}
    </section>
  );
}
