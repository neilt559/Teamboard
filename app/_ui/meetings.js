'use client';
import { useEffect, useRef, useState } from 'react';
import { FormattedNotes, NotesEditor } from '../notes-format';
import { IconCalendar, IconCaret, IconFolder, IconPencil, IconTrash } from '../icons';
import { ConflictError } from './api';
import { DraftConflict } from './ConflictNotice';
import { useConfirm } from './ConfirmDialog';
import Modal from './Modal';
import { byPos, localISO } from './tasks';

// Project meetings (moved from the old single page, design §2.3): one-off meetings and meeting series, each
// meeting written up in MeetingEditor and saved all at once with Post / Save (rule 34: read-only until Edit).
// Nothing is saved until Post / Save — so scrolling past a meeting can never change it.
//
// The editor freezes its base when it opens (design §7.4). Save sends only the fields that changed since then,
// each text field with the value it opened with, so a colleague's edit to a field you didn't touch is never
// overwritten (the old editor diffed against live data and could resend a stale value). On a 409 the editor
// stays open and lists the conflicting fields with "their version".

// "2026-09-29" -> "Mon, Sep 29, 2026" (read as a local date, not UTC). '' -> 'No date'.
export function fmtMeetingDate(s) {
  if (!s) return 'No date';
  const [y, m, d] = String(s).split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return isNaN(dt) ? s : dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

const FIELDS = ['title', 'meeting_date', 'attendance', 'notes'];
const TEXT_FIELDS = new Set(['title', 'attendance', 'notes']);
const LABELS = { title: 'Title', meeting_date: 'Date', attendance: 'Attendance', notes: 'Notes' };
const snapshot = (m) => ({
  title: m ? m.title || '' : '',
  meeting_date: m ? m.meeting_date || '' : localISO(new Date()),
  attendance: m ? m.attendance || '' : '',
  notes: m ? m.notes || '' : '',
});

// Write-up form for a meeting, used to create and to edit. Series meetings are known by their date, so they
// don't get a title box.
//   onSubmit(fields, base): new meeting -> every field, base undefined; edit -> only the changed fields plus
//   base { field: value when Edit opened } for the text ones. Resolve to close (the parent unmounts the
//   editor); throw to keep it open (ConflictError shows the conflict banner, anything else its message).
//   onDiscard(): "Discard mine and reload" after a conflict (the parent closes the editor and refreshes).
//   onDirty(bool): whether there are unsaved changes (pauses the page's background refresh).
export function MeetingEditor({ meeting, inSeries, onSubmit, onCancel, onDelete, onDiscard, onDirty }) {
  const [base, setBase] = useState(() => snapshot(meeting));      // frozen when Edit opens
  const [f, setF] = useState(base);
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

  const send = async (curBase) => {
    setBusy(true);
    setErr(null);
    const all = { ...f, title: inSeries ? 'Meeting' : (f.title.trim() || 'Meeting'), meeting_date: f.meeting_date || null };
    let fields = all;
    let b;
    if (meeting) {
      const ch = FIELDS.filter((k) => f[k] !== curBase[k]);
      fields = Object.fromEntries(ch.map((k) => [k, all[k]]));
      b = Object.fromEntries(ch.filter((k) => TEXT_FIELDS.has(k)).map((k) => [k, curBase[k]]));
    }
    try {
      await onSubmit(fields, b);
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
    <div className="pm pm-editing">
      {conflict && (
        <DraftConflict
          conflict={conflict}
          labels={LABELS}
          onOverwrite={overwrite}
          onDiscard={() => { setConflict(null); (onDiscard || onCancel)(); }}
        />
      )}
      <div className="pm-edit-grid">
        {!inSeries && (
          <label className="pm-field grow">
            <span className="pm-label">Title</span>
            <input className="field" autoFocus={!meeting} placeholder="e.g. Kickoff with the county" value={f.title} onChange={set('title')} maxLength={300} />
          </label>
        )}
        <label className="pm-field">
          <span className="pm-label">Date</span>
          <input type="date" className="field" value={f.meeting_date} onChange={set('meeting_date')} />
        </label>
      </div>
      <label className="pm-field">
        <span className="pm-label">Attendance</span>
        <input className="field" placeholder="Who attended — e.g. John, Kyler, Sam" value={f.attendance} onChange={set('attendance')} maxLength={4000} />
      </label>
      <div className="pm-field">
        <span className="pm-label">Notes</span>
        <NotesEditor
          value={f.notes}
          onChange={(v) => setF((x) => ({ ...x, notes: v }))}
          placeholder="Start typing — %t for a title, %h for a header, - for a bullet"
        />
      </div>
      {err && <p className="pm-error" role="alert">{err}</p>}
      <div className="pm-edit-actions">
        {onDelete && <button type="button" className="btn btn-plain btn-sm pm-delete wi" onClick={onDelete} disabled={busy}><IconTrash size={14} /> Delete meeting</button>}
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

// The prompt() replacement for naming a series: Enter saves, Escape or Cancel closes.
function NameDialog({ title, label, initial = '', confirmLabel, onSave, onClose }) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await onSave(v); onClose(); } catch { setBusy(false); }
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      className="add-task-modal"
      actions={(
        <>
          <button type="button" className="btn btn-plain" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-ink" disabled={busy} onClick={save}>{busy ? 'Saving…' : confirmLabel}</button>
        </>
      )}
    >
      <label className="atm-label" htmlFor="tb-name-dialog">{label}</label>
      <input
        id="tb-name-dialog"
        className="field"
        autoFocus
        value={v}
        maxLength={300}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
      />
    </Modal>
  );
}

// The "Meetings" panel of a project.
//   onCreate(seriesId|null, fields) -> the created row (throws on failure)
//   onSave(meeting, patch, base)    -> resolves when saved (throws ConflictError on 409)
//   onDelete(meeting)               -> resolves when deleted
//   onAddSeries(name), onRenameSeries(series, name), onDeleteSeries(series)
//   onDiscard()                     -> refresh after "Discard mine and reload"
//   onDirtyChange(bool)             -> some editor has unsaved changes
//   seriesNotice(series)            -> optional node under a series head (e.g. a rename conflict)
export function ProjectMeetings({
  meetings, series, readOnly = false, onCreate, onSave, onDelete, onAddSeries, onRenameSeries, onDeleteSeries,
  onDiscard, onDirtyChange, seriesNotice,
}) {
  const [composing, setComposing] = useState(null);   // 'solo' or a series id while writing up a new meeting
  const [editing, setEditing] = useState({});         // meeting id -> true while being edited
  const [expanded, setExpanded] = useState({});
  const [dirtyKeys, setDirtyKeys] = useState({});
  const [dialog, setDialog] = useState(null);         // { kind: 'add' } | { kind: 'rename', sv }
  const [confirmUI, ask] = useConfirm();

  const anyDirty = Object.values(dirtyKeys).some(Boolean);
  const dirtyRef = useRef(onDirtyChange);
  dirtyRef.current = onDirtyChange;
  useEffect(() => { if (dirtyRef.current) dirtyRef.current(anyDirty); }, [anyDirty]);
  const markDirty = (key) => (v) => setDirtyKeys((s) => (!!s[key] === !!v ? s : { ...s, [key]: !!v }));

  // In read-only mode (archived project) nothing is open for editing.
  useEffect(() => { if (readOnly) { setComposing(null); setEditing({}); } }, [readOnly]);

  const standalone = meetings.filter((m) => !m.series_id).sort(byPos);
  const stopEditing = (id) => setEditing((s) => { const n = { ...s }; delete n[id]; return n; });
  const toggle = (id) => setExpanded((s) => ({ ...s, [id]: !s[id] }));

  // Only one composer at a time; switching asks before dropping an unsaved write-up.
  const openComposer = async (key) => {
    const k = String(key);
    if (composing != null && String(composing) !== k && dirtyKeys[`new:${composing}`]) {
      if (!(await ask({ title: 'Discard your changes to this meeting?', confirmLabel: 'Discard', danger: true }))) return;
    }
    setComposing(k);
  };

  const deleteMeeting = async (m) => {
    const what = m.series_id ? `the ${fmtMeetingDate(m.meeting_date)} meeting` : `“${m.title || 'Meeting'}”`;
    if (!(await ask({ title: `Delete ${what}, including its attendance and notes?`, lines: ['This can’t be undone.'], confirmLabel: 'Delete meeting', danger: true }))) return false;
    await onDelete(m);
    return true;
  };

  const composer = (seriesId) => (
    <MeetingEditor
      key={`new:${seriesId || 'solo'}`}
      inSeries={!!seriesId}
      onDirty={markDirty(`new:${seriesId || 'solo'}`)}
      onCancel={() => setComposing(null)}
      onSubmit={async (fields) => {
        const row = await onCreate(seriesId || null, fields);
        setComposing(null);
        if (row && row.id != null) setExpanded((s) => ({ ...s, [row.id]: true }));
      }}
    />
  );

  const renderMeeting = (m) => {
    if (editing[m.id] && !readOnly) {
      return (
        <MeetingEditor
          key={`edit:${m.id}`}
          meeting={m}
          inSeries={!!m.series_id}
          onDirty={markDirty(`edit:${m.id}`)}
          onCancel={() => stopEditing(m.id)}
          onDiscard={() => { stopEditing(m.id); if (onDiscard) onDiscard(); }}
          onDelete={async () => { if (await deleteMeeting(m)) stopEditing(m.id); }}
          onSubmit={async (patch, base) => { await onSave(m, patch, base); stopEditing(m.id); }}
        />
      );
    }
    const open = !!expanded[m.id];
    return (
      <div key={m.id} className="pm">
        <div className="pm-head">
          <button type="button" className="pm-toggle" onClick={() => toggle(m.id)} aria-expanded={open}>
            <span className="team-caret" aria-hidden="true"><IconCaret size={13} className={open ? '' : 'caret-closed'} /></span>
            {m.series_id
              ? <span className="pm-title-read">{fmtMeetingDate(m.meeting_date)}</span>
              : <><span className="pm-title-read">{m.title || 'Meeting'}</span><span className="pm-date-read">{fmtMeetingDate(m.meeting_date)}</span></>}
          </button>
          {!readOnly && (
            <button type="button" className="btn btn-plain btn-xs wi pm-edit-btn" title="Edit this meeting" onClick={() => setEditing((s) => ({ ...s, [m.id]: true }))}>
              <IconPencil size={12} /> Edit
            </button>
          )}
        </div>
        {open && (
          <div className="pm-body pm-read">
            <div className="pm-label">Attendance</div>
            <div className={`pm-read-text${m.attendance ? '' : ' empty'}`}>{m.attendance || 'Not recorded'}</div>
            <div className="pm-label">Notes</div>
            <FormattedNotes text={m.notes} />
          </div>
        )}
      </div>
    );
  };

  const hasAny = meetings.length > 0 || series.length > 0;
  return (
    <div className="info-panel pm-panel">
      <div className="section-head">
        <label className="notes-label"><IconCalendar size={14} /> Meetings</label>
        {!readOnly && (
          <div className="pm-actions">
            <button type="button" className="btn btn-lime btn-sm" onClick={() => openComposer('solo')} disabled={composing === 'solo'}>+ Meeting</button>
            <button type="button" className="btn btn-plain btn-sm" onClick={() => setDialog({ kind: 'add' })}>+ Meeting series</button>
          </div>
        )}
      </div>
      {composing === 'solo' && !readOnly && composer(null)}
      {!hasAny && composing !== 'solo' && <p className="ov-empty">No meetings yet — create a one-off meeting or a series.</p>}
      {standalone.map(renderMeeting)}
      {[...series].sort(byPos).map((sv) => {
        const sm = meetings.filter((m) => String(m.series_id) === String(sv.id)).sort(byPos);
        const open = composing != null && String(composing) === String(sv.id) && !readOnly;
        return (
          <div key={sv.id} className="pm-series">
            <div className="pm-series-head">
              <span className="pm-series-name"><IconFolder size={14} /> {sv.name}</span>
              <div className="spacer" />
              {!readOnly && (
                <>
                  <button type="button" className="btn btn-plain btn-xs" onClick={() => openComposer(sv.id)} disabled={open}>+ Add meeting</button>
                  <button type="button" className="row-icon" title="Rename series" aria-label={`Rename series ${sv.name}`} onClick={() => setDialog({ kind: 'rename', sv })}><IconPencil size={14} /></button>
                  <button
                    type="button"
                    className="row-icon danger"
                    title="Delete series"
                    aria-label={`Delete series ${sv.name}`}
                    onClick={async () => {
                      if (await ask({ title: `Delete series “${sv.name}” and all meetings in it?`, confirmLabel: 'Delete series', danger: true })) onDeleteSeries(sv);
                    }}
                  ><IconTrash /></button>
                </>
              )}
            </div>
            {seriesNotice ? seriesNotice(sv) : null}
            {open && composer(sv.id)}
            {sm.length === 0 && !open && <p className="pm-series-empty">No meetings in this series yet.</p>}
            {sm.map(renderMeeting)}
          </div>
        );
      })}
      {dialog?.kind === 'add' && (
        <NameDialog
          title="New meeting series"
          label="Meeting series name"
          confirmLabel="Create series"
          onSave={(name) => onAddSeries(name.trim() || 'Series')}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'rename' && (
        <NameDialog
          title="Rename series"
          label="Series name"
          initial={dialog.sv.name}
          confirmLabel="Rename"
          onSave={async (name) => {
            if (name.trim() === '' || name === dialog.sv.name) return;
            await onRenameSeries(dialog.sv, name);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {confirmUI}
    </div>
  );
}

export default ProjectMeetings;
