'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FormattedNotes, NotesEditor } from '../notes-format';
import { IconArchive, IconCalendar, IconCaret, IconNote, IconPencil, IconRestore, IconTag } from '../icons';
import { ConflictError } from './api';
import { DraftConflict } from './ConflictNotice';
import { useConfirm } from './ConfirmDialog';
import Modal from './Modal';
import { fmtHhmm, fmtYmd } from './project-format';

// A project's Meetings (design-amendments A9, Neil 2026-10-14: "The meetings should be combined but do not include
// meeting minutes in the report. So we can have upcoming meetings and past meetings, and it automatically sorts by
// day."). ONE section: Upcoming (dated today or later, Central; soonest first) and Past (most recent first; the first
// five, then "Show all past"), sorted by date and then time. Each row shows the date, time, what / with whom, where,
// its series as a tag and a "Minutes" mark when it has any; clicking it opens the minutes read-only. The owner reports
// list the upcoming ones without their minutes.
//
// Rule 34 stays: a meeting is written up in MeetingEditor and saved all at once with Post / Save (read-only until
// Edit; nothing is saved by scrolling past it). The editor freezes its base when it opens (design §7.4) and sends only
// the fields that changed, each text field with the value it opened with; on a 409 it stays open and lists the
// conflicting fields. Archive (inside edit mode, confirmed) replaces delete; "Show archived" brings meetings back.
// A meeting's series is an optional label ("New series…" makes one); the Series dialog renames and archives them.

const NEW_SERIES = '__new__';
const FIELDS = ['title', 'meeting_date', 'meeting_time', 'location', 'series_id', 'attendance', 'notes'];
const TEXT_FIELDS = new Set(['title', 'location', 'attendance', 'notes']);
const LABELS = { title: 'What / with whom', meeting_date: 'Date', meeting_time: 'Time', location: 'Where', series_id: 'Series', attendance: 'Attendance', notes: 'Notes' };
const PAST_SHOWN = 5;

const snapshot = (m, today) => ({
  title: m ? m.title || '' : '',
  meeting_date: m ? m.meeting_date || '' : today || '',
  meeting_time: m ? m.meeting_time || '' : '',
  location: m ? m.location || '' : '',
  series_id: m && m.series_id != null ? String(m.series_id) : '',
  attendance: m ? m.attendance || '' : '',
  notes: m ? m.notes || '' : '',
});
const hasMinutes = (m) => !!(String(m.notes || '').trim() || String(m.attendance || '').trim());

// Upcoming: dated today or later (today = the Central date from the server), soonest first, then by time (no time
// first). Past: dated before today, most recent first (latest time first); meetings without a date last. Archived
// ones apart, most recent first.
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const tkey = (m) => m.meeting_time || '';
const soonest = (a, b) => cmp(a.meeting_date, b.meeting_date) || cmp(tkey(a), tkey(b)) || (Number(a.id) - Number(b.id));
const latest = (a, b) => (Number(!a.meeting_date) - Number(!b.meeting_date)) || cmp(b.meeting_date || '', a.meeting_date || '')
  || cmp(tkey(b), tkey(a)) || (Number(b.id) - Number(a.id));
export function splitMeetings(list, today) {
  const live = (list || []).filter((m) => !m.archived);
  return {
    upcoming: live.filter((m) => m.meeting_date && m.meeting_date >= today).sort(soonest),
    past: live.filter((m) => !m.meeting_date || m.meeting_date < today).sort(latest),
    archived: (list || []).filter((m) => m.archived).sort(latest),
  };
}

// Write-up form for a meeting, used to create and to edit.
//   onSubmit(fields, base, newSeriesName): new meeting -> every field, base undefined; edit -> only the changed fields
//   plus base { field: value when Edit opened } for the text ones. fields.series_id is NEW_SERIES when "New series…"
//   was picked (newSeriesName holds its name). Resolve to close (the parent unmounts the editor); throw to keep it
//   open (ConflictError shows the conflict banner, anything else its message).
//   onArchive(): archive the meeting (edit mode only; the parent confirms).
//   onDiscard(): "Discard mine and reload" after a conflict (the parent closes the editor and refreshes).
//   onDirty(bool): whether there are unsaved changes (pauses the page's background refresh).
export function MeetingEditor({ meeting, series = [], today, onSubmit, onCancel, onArchive, onDiscard, onDirty }) {
  const [base, setBase] = useState(() => snapshot(meeting, today));      // frozen when Edit opens
  const [f, setF] = useState(base);
  const [newSeries, setNewSeries] = useState('');
  const [minutesOpen, setMinutesOpen] = useState(() => !!meeting && hasMinutes(meeting));
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(null);
  const [err, setErr] = useState(null);
  const [confirmUI, ask] = useConfirm();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const changed = FIELDS.filter((k) => f[k] !== base[k]);
  const dirty = changed.length > 0;

  const dirtyRef = useRef(onDirty);
  dirtyRef.current = onDirty;
  useEffect(() => { if (dirtyRef.current) dirtyRef.current(dirty); }, [dirty]);
  useEffect(() => () => { if (dirtyRef.current) dirtyRef.current(false); }, []);

  // The series a meeting can carry: the active ones, plus its own even when archived.
  const options = series.filter((s) => !s.archived || String(s.id) === base.series_id);

  const send = async (curBase) => {
    if (!f.title.trim()) { setErr('Say what the meeting is (and with whom).'); return; }
    if (!f.meeting_date && (!meeting || base.meeting_date)) { setErr('Pick the meeting date.'); return; }
    if (f.series_id === NEW_SERIES && !newSeries.trim()) { setErr('Name the new series.'); return; }
    setBusy(true);
    setErr(null);
    const all = { ...f, title: f.title.trim(), location: f.location.trim(), meeting_date: f.meeting_date || null, series_id: f.series_id || null };
    let fields = all;
    let b;
    if (meeting) {
      const ch = FIELDS.filter((k) => f[k] !== curBase[k]);
      fields = Object.fromEntries(ch.map((k) => [k, all[k]]));
      b = Object.fromEntries(ch.filter((k) => TEXT_FIELDS.has(k)).map((k) => [k, curBase[k]]));
    }
    try {
      await onSubmit(fields, b, f.series_id === NEW_SERIES ? newSeries.trim() : null);
    } catch (e) {
      setBusy(false);
      if (e instanceof ConflictError) setConflict(e);
      else setErr(e?.message || 'That didn’t save. Try again.');
    }
  };

  const submit = () => send(base);
  // Overwrite with mine: their value becomes the base of each conflicting field, then resend everything that
  // still differs. Fields nobody else touched keep their own base.
  const overwrite = () => {
    const cur = conflict?.current || {};
    const hit = conflict?.fields?.length ? conflict.fields : FIELDS.filter((k) => TEXT_FIELDS.has(k) && f[k] !== base[k]);
    const nb = { ...base };
    for (const k of hit) if (k in nb) nb[k] = cur[k] == null ? '' : String(cur[k]);
    setBase(nb);
    setConflict(null);
    send(nb);
  };
  const cancel = async () => {
    if (dirty && !(await ask({ title: 'Discard your changes to this meeting?', confirmLabel: 'Discard', danger: true }))) return;
    onCancel();
  };

  return (
    <div className="pm pm-editing" data-id={meeting?.id}>
      {conflict && (
        <DraftConflict
          conflict={conflict}
          labels={LABELS}
          onOverwrite={overwrite}
          onDiscard={() => { setConflict(null); (onDiscard || onCancel)(); }}
        />
      )}
      <div className="pm-edit-grid pm2-grid">
        <label className="pm-field pm2-f-title">
          <span className="pm-label">What / with whom</span>
          <input className="field" autoFocus={!meeting} placeholder="e.g. Pre-application meeting with Village staff" value={f.title} onChange={set('title')} maxLength={300} />
        </label>
        <label className="pm-field pm2-f-date">
          <span className="pm-label">Date</span>
          <input type="date" className="field" value={f.meeting_date} onChange={set('meeting_date')} />
        </label>
        <label className="pm-field pm2-f-time">
          <span className="pm-label">Time <i>(optional)</i></span>
          <input type="time" className="field" value={f.meeting_time} onChange={set('meeting_time')} />
        </label>
        <label className="pm-field pm2-f-where">
          <span className="pm-label">Where <i>(optional)</i></span>
          <input className="field" placeholder="e.g. Village Hall, or Teams" value={f.location} onChange={set('location')} maxLength={300} />
        </label>
        <label className="pm-field pm2-f-series">
          <span className="pm-label">Series <i>(optional)</i></span>
          <select className="field" value={f.series_id} onChange={set('series_id')}>
            <option value="">None</option>
            {options.map((s) => <option key={s.id} value={String(s.id)}>{s.name}{s.archived ? ' (archived)' : ''}</option>)}
            <option value={NEW_SERIES}>New series…</option>
          </select>
        </label>
        {f.series_id === NEW_SERIES && (
          <label className="pm-field pm2-f-newseries">
            <span className="pm-label">New series name</span>
            <input className="field" autoFocus placeholder="e.g. Bi-weekly owner call" value={newSeries} onChange={(e) => setNewSeries(e.target.value)} maxLength={300} />
          </label>
        )}
      </div>
      <button type="button" className={`pm2-minutes-toggle${minutesOpen ? ' on' : ''}`} aria-expanded={minutesOpen} onClick={() => setMinutesOpen((x) => !x)}>
        <IconCaret size={13} className={minutesOpen ? '' : 'caret-closed'} /> Minutes
        <span className="pm2-minutes-hint">attendance and notes · never in the owner report</span>
      </button>
      {minutesOpen && (
        <div className="pm2-minutes-edit">
          <label className="pm-field">
            <span className="pm-label">Attendance</span>
            <input className="field" placeholder="Who attended — e.g. John, Kyler, Sam" value={f.attendance} onChange={set('attendance')} maxLength={4000} />
          </label>
          <div className="pm-field">
            <span className="pm-label">Notes</span>
            {/* NotesEditor reads value once, when it mounts: closing and reopening Minutes keeps what was typed. */}
            <NotesEditor
              value={f.notes}
              onChange={(v) => setF((x) => ({ ...x, notes: v }))}
              placeholder="Start typing — %t for a title, %h for a header, - for a bullet"
            />
          </div>
        </div>
      )}
      {err && <p className="pm-error" role="alert">{err}</p>}
      <div className="pm-edit-actions">
        {onArchive && <button type="button" className="btn btn-plain btn-sm pm-delete wi" onClick={onArchive} disabled={busy}><IconArchive size={14} /> Archive meeting</button>}
        <div className="spacer" />
        <button type="button" className="btn btn-plain btn-sm" onClick={cancel} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-ink btn-sm" onClick={submit} disabled={busy || (meeting && !dirty)}>
          {busy ? 'Saving…' : meeting ? 'Save changes' : 'Post meeting'}
        </button>
      </div>
      {confirmUI}
    </div>
  );
}

// The Series dialog: rename and archive (or restore) a project's meeting series, or add one. Archived series leave the
// series picker; their meetings keep the label.
function SeriesDialog({ series, counts, readOnly, onAdd, onRename, onArchive, notice, onClose }) {
  const [renaming, setRenaming] = useState(null);       // { id, name }
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const active = series.filter((s) => !s.archived);
  const archived = series.filter((s) => s.archived);
  const add = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try { await onAdd(name.trim()); setName(''); } finally { setBusy(false); }
  };
  const rename = async () => {
    if (!renaming) return;
    const sv = series.find((s) => String(s.id) === String(renaming.id));
    if (sv && renaming.name.trim() && renaming.name.trim() !== sv.name) await onRename(sv, renaming.name.trim());
    setRenaming(null);
  };
  const row = (s) => (
    <li key={s.id} className={`pm2-sv${s.archived ? ' archived' : ''}`}>
      {renaming && String(renaming.id) === String(s.id) ? (
        <>
          <input
            className="field" autoFocus value={renaming.name} maxLength={300} aria-label={`New name for ${s.name}`}
            onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); rename(); } if (e.key === 'Escape') setRenaming(null); }}
          />
          <button type="button" className="btn btn-ink btn-xs" onClick={rename}>Save</button>
          <button type="button" className="btn btn-plain btn-xs" onClick={() => setRenaming(null)}>Cancel</button>
        </>
      ) : (
        <>
          <span className="pm2-sv-name"><IconTag size={13} /> {s.name}</span>
          <span className="pm2-sv-n">{counts[String(s.id)] || 0} meeting{counts[String(s.id)] === 1 ? '' : 's'}</span>
          {!readOnly && !s.archived && <button type="button" className="btn btn-plain btn-xs wi" onClick={() => setRenaming({ id: s.id, name: s.name })}><IconPencil size={12} /> Rename</button>}
          {!readOnly && (s.archived
            ? <button type="button" className="btn btn-plain btn-xs wi" onClick={() => onArchive(s, false)}><IconRestore size={12} /> Restore</button>
            : <button type="button" className="btn btn-plain btn-xs wi" onClick={() => onArchive(s, true)}><IconArchive size={12} /> Archive</button>)}
        </>
      )}
      {notice ? notice(s) : null}
    </li>
  );
  return (
    <Modal title="Meeting series" onClose={onClose} className="pm2-series-modal" actions={<button type="button" className="btn btn-ink" onClick={onClose}>Done</button>}>
      <p className="pm2-sv-intro">A series is a label for meetings that repeat (a weekly owner call, the county's review meetings). Archiving one only takes it out of the list for new meetings.</p>
      {active.length ? <ul className="pm2-sv-list">{active.map(row)}</ul> : <p className="ov-empty">{archived.length ? 'No active series.' : 'No series yet.'}</p>}
      {archived.length > 0 && (
        <>
          <h3 className="pm2-sv-h">Archived</h3>
          <ul className="pm2-sv-list">{archived.map(row)}</ul>
        </>
      )}
      {!readOnly && (
        <div className="pm2-sv-add">
          <input className="field" placeholder="New series name" aria-label="New series name" value={name} maxLength={300}
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
          <button type="button" className="btn btn-plain btn-sm" onClick={add} disabled={busy || !name.trim()}>Add series</button>
        </div>
      )}
    </Modal>
  );
}

// One meeting, read-only: date, time, what, where, series tag, a Minutes mark; a click opens the minutes.
function MeetingRow({ m, seriesName, open, onToggle, readOnly, onEdit, onRestore }) {
  const minutes = hasMinutes(m);
  return (
    <div className={`pm pm2${m.archived ? ' archived' : ''}${open ? ' open' : ''}`} data-id={m.id}>
      <div className="pm2-row">
        <button type="button" className="pm2-main" onClick={onToggle} aria-expanded={minutes ? open : undefined} disabled={!minutes}
          title={minutes ? (open ? 'Hide the minutes' : 'Show the minutes') : 'No minutes yet'}>
          <span className="pm2-when">
            <span className="pm2-date">{m.meeting_date ? fmtYmd(m.meeting_date, { weekday: true }) : 'No date'}</span>
            {m.meeting_time && <span className="pm2-time">{fmtHhmm(m.meeting_time)}</span>}
          </span>
          <span className="pm2-what">
            <span className="pm2-title">{m.title || 'Meeting'}</span>
            {m.location && <span className="pm2-loc">{m.location}</span>}
          </span>
          <span className="pm2-tags">
            {seriesName && <span className="pm2-series wi"><IconTag size={11} /> {seriesName}</span>}
            {minutes && <span className="pm2-min wi"><IconNote size={11} /> Minutes</span>}
          </span>
          {minutes && <IconCaret size={13} className={`pm2-caret${open ? '' : ' caret-closed'}`} />}
        </button>
        {!readOnly && (m.archived
          ? <button type="button" className="btn btn-plain btn-xs wi pm-edit-btn" onClick={() => onRestore(m)}><IconRestore size={12} /> Restore</button>
          : <button type="button" className="btn btn-plain btn-xs wi pm-edit-btn" title="Edit this meeting" onClick={() => onEdit(m)}><IconPencil size={12} /> Edit</button>)}
      </div>
      {open && minutes && (
        <div className="pm-body pm-read pm2-minutes">
          <div className="pm-label">Attendance</div>
          <div className={`pm-read-text${m.attendance ? '' : ' empty'}`}>{m.attendance || 'Not recorded'}</div>
          <div className="pm-label">Notes</div>
          <FormattedNotes text={m.notes} empty="No notes." />
        </div>
      )}
    </div>
  );
}

// The "Meetings" section of a project.
//   onCreate(fields, newSeriesName)         -> the created row (throws on failure)
//   onSave(meeting, patch, base, newName)   -> resolves when saved (throws ConflictError on 409)
//   onArchive(meeting, archived)            -> archive / restore (no confirm here for restore)
//   onAddSeries(name), onRenameSeries(series, name), onArchiveSeries(series, archived)
//   onDiscard()                             -> refresh after "Discard mine and reload"
//   onDirtyChange(bool)                     -> some editor has unsaved changes
//   seriesNotice(series)                    -> optional node under a series (e.g. a rename conflict)
export function ProjectMeetings({
  meetings, series = [], today, readOnly = false, onCreate, onSave, onArchive, onAddSeries, onRenameSeries, onArchiveSeries,
  onDiscard, onDirtyChange, seriesNotice, idKey = '', compact = false,
}) {
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState({});         // meeting id -> true while being edited
  const [expanded, setExpanded] = useState({});
  const [dirtyKeys, setDirtyKeys] = useState({});
  const [allPast, setAllPast] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [seriesOpen, setSeriesOpen] = useState(false);
  const [confirmUI, ask] = useConfirm();

  const anyDirty = Object.values(dirtyKeys).some(Boolean);
  const dirtyRef = useRef(onDirtyChange);
  dirtyRef.current = onDirtyChange;
  useEffect(() => { if (dirtyRef.current) dirtyRef.current(anyDirty); }, [anyDirty]);
  const markDirty = (key) => (v) => setDirtyKeys((s) => (!!s[key] === !!v ? s : { ...s, [key]: !!v }));

  // In read-only mode (archived project) nothing is open for editing.
  useEffect(() => { if (readOnly) { setComposing(false); setEditing({}); } }, [readOnly]);

  const { upcoming, past, archived } = useMemo(() => splitMeetings(meetings, today), [meetings, today]);
  const seriesName = useMemo(() => new Map(series.map((s) => [String(s.id), s.name])), [series]);
  const counts = useMemo(() => {
    const c = {};
    for (const m of meetings || []) if (m.series_id != null && !m.archived) c[String(m.series_id)] = (c[String(m.series_id)] || 0) + 1;
    return c;
  }, [meetings]);
  const stopEditing = (id) => setEditing((s) => { const n = { ...s }; delete n[id]; return n; });
  const toggle = (id) => setExpanded((s) => ({ ...s, [id]: !s[id] }));

  const archive = async (m) => {
    if (!(await ask({
      title: `Archive “${m.title || 'Meeting'}”?`,
      lines: ['It leaves the Meetings list (and the weekly report). “Show archived” brings it back.'],
      confirmLabel: 'Archive',
    }))) return false;
    await onArchive(m, true);
    return true;
  };

  const renderMeeting = (m) => {
    if (editing[m.id] && !readOnly) {
      return (
        <MeetingEditor
          key={`edit:${m.id}`}
          meeting={m}
          series={series}
          today={today}
          onDirty={markDirty(`edit:${m.id}`)}
          onCancel={() => stopEditing(m.id)}
          onDiscard={() => { stopEditing(m.id); if (onDiscard) onDiscard(); }}
          onArchive={async () => { if (await archive(m)) stopEditing(m.id); }}
          onSubmit={async (patch, base, newName) => { await onSave(m, patch, base, newName); stopEditing(m.id); }}
        />
      );
    }
    return (
      <MeetingRow
        key={m.id}
        m={m}
        seriesName={m.series_id != null ? seriesName.get(String(m.series_id)) : null}
        open={!!expanded[m.id]}
        onToggle={() => toggle(m.id)}
        readOnly={readOnly}
        onEdit={(x) => setEditing((s) => ({ ...s, [x.id]: true }))}
        onRestore={(x) => onArchive(x, false)}
      />
    );
  };

  const shownPast = allPast ? past : past.slice(0, PAST_SHOWN);
  return (
    <section className="info-panel pm-panel pm2-panel" id={idKey ? undefined : 'meetings'} aria-labelledby={`pm2-h${idKey ? `-${idKey}` : ''}`}>
      <div className="info-head">
        <h2 className="notes-label sec-h" id={`pm2-h${idKey ? `-${idKey}` : ''}`}><IconCalendar size={14} /> Meetings <span>· upcoming ones go in the weekly owner report, never the minutes</span></h2>
        <div className="sec-actions">
          {(series.length > 0 || !readOnly) && (
            <button type="button" className="btn btn-plain btn-sm wi" onClick={() => setSeriesOpen(true)}>
              <IconTag size={13} /> Series{series.filter((s) => !s.archived).length ? ` (${series.filter((s) => !s.archived).length})` : ''}
            </button>
          )}
          {!readOnly && <button type="button" className="btn btn-lime btn-sm" onClick={() => setComposing(true)} disabled={composing}>+ Meeting</button>}
        </div>
      </div>
      {composing && !readOnly && (
        <MeetingEditor
          key="new"
          series={series}
          today={today}
          onDirty={markDirty('new')}
          onCancel={() => setComposing(false)}
          onSubmit={async (fields, _b, newName) => {
            const row = await onCreate(fields, newName);
            setComposing(false);
            if (row && row.id != null && hasMinutes(row)) setExpanded((s) => ({ ...s, [row.id]: true }));
          }}
        />
      )}
      <h3 className="pm2-h">Upcoming <span>{upcoming.length}</span></h3>
      {upcoming.length ? <div className="pm2-list" aria-label="Upcoming meetings">{upcoming.map(renderMeeting)}</div>
        : <p className="ov-empty pm2-empty">No upcoming meetings.</p>}
      {/* compact (the team page's weekly review): upcoming meetings only; the past ones stay on the project page. */}
      {!compact && <h3 className="pm2-h">Past <span>{past.length}</span></h3>}
      {!compact && (past.length ? <div className="pm2-list" aria-label="Past meetings">{shownPast.map(renderMeeting)}</div>
        : <p className="ov-empty pm2-empty">No past meetings.</p>)}
      {!compact && past.length > PAST_SHOWN && (
        <button type="button" className="btn btn-plain btn-sm pm2-more" aria-expanded={allPast} onClick={() => setAllPast((x) => !x)}>
          {allPast ? 'Show fewer' : `Show all past (${past.length})`}
        </button>
      )}
      {!compact && archived.length > 0 && (
        <div className="pm2-archived">
          <button type="button" className="btn btn-plain btn-sm wi" aria-expanded={showArchived} onClick={() => setShowArchived((x) => !x)}>
            <IconArchive size={13} /> {showArchived ? 'Hide archived' : `Show archived (${archived.length})`}
          </button>
          {showArchived && <div className="pm2-list" aria-label="Archived meetings">{archived.map(renderMeeting)}</div>}
        </div>
      )}
      {seriesOpen && (
        <SeriesDialog
          series={series}
          counts={counts}
          readOnly={readOnly}
          onAdd={onAddSeries}
          onRename={onRenameSeries}
          onArchive={onArchiveSeries}
          notice={seriesNotice}
          onClose={() => setSeriesOpen(false)}
        />
      )}
      {confirmUI}
    </section>
  );
}

export { NEW_SERIES };
export default ProjectMeetings;
