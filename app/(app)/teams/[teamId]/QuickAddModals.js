'use client';
import { useState } from 'react';
import Modal from '@/app/_ui/Modal';
import { SUBMITTAL_STATUSES } from '@/lib/projects';

// Quick adds from a team page card (Neil, 2026-10-15: "little popups with the basic info needed that can be
// entered quickly", like Add task). Each one posts to the same API as the project page and stays open with the
// server's message when that refuses (a bad date, a project gone); everything else is edited on the project page.
//   onSave(body) -> resolves when stored (throws with a message otherwise); onClose() closes.

// The one date asked for with each submittal status (the one the owner report's log leads with).
const STATUS_DATE = {
  not_submitted: { field: 'target_date', label: 'Target date' },
  comments_received: { field: 'reply_by_date', label: 'Our reply due' },
  under_review: { field: 'submitted_date', label: 'Submitted' },
  approved: { field: 'approved_date', label: 'Approved' },
};

function useSave(onSave, onClose) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async (body) => {
    setBusy(true);
    setErr('');
    try { await onSave(body); onClose(); } catch (e) { setErr(e?.message || 'That didn’t save. Try again.'); setBusy(false); }
  };
  return { busy, err, setErr, save };
}

const enter = (fn) => (e) => { if (e.key === 'Enter') { e.preventDefault(); fn(); } };

function Shell({ title, projectName, busy, err, label, onSubmit, onClose, children, className }) {
  return (
    <Modal
      title={title}
      className={`add-task-modal qa-modal ${className}`}
      onClose={onClose}
      actions={(
        <>
          <button type="button" className="btn btn-plain" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-ink" onClick={onSubmit} disabled={busy}>{busy ? 'Saving…' : label}</button>
        </>
      )}
    >
      {projectName && <p className="atm-project">{projectName}</p>}
      {children}
      {err && <p className="pm-error qa-error" role="alert">{err}</p>}
    </Modal>
  );
}

export function AddSubmittalModal({ projectName, onSave, onClose }) {
  const [agency, setAgency] = useState('');
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('not_submitted');
  const [date, setDate] = useState('');
  const { busy, err, setErr, save } = useSave(onSave, onClose);
  const d = STATUS_DATE[status];
  const submit = () => {
    if (!agency.trim() && !title.trim()) { setErr('Say who it goes to or what it is.'); return; }
    save({ agency: agency.trim(), title: title.trim(), status, ...(date ? { [d.field]: date } : {}) });
  };
  return (
    <Shell title="Add submittal" projectName={projectName} busy={busy} err={err} label="Add submittal" onSubmit={submit} onClose={onClose} className="qa-sub">
      <label className="atm-label" htmlFor="qa-to">To</label>
      <input id="qa-to" className="field" autoFocus placeholder="e.g. Village of Lakeview" value={agency} maxLength={200}
        onChange={(e) => setAgency(e.target.value)} onKeyDown={enter(submit)} />
      <label className="atm-label" htmlFor="qa-title">Submittal</label>
      <input id="qa-title" className="field" placeholder="e.g. Final engineering submittal" value={title} maxLength={300}
        onChange={(e) => setTitle(e.target.value)} onKeyDown={enter(submit)} />
      <div className="qa-two">
        <div>
          <label className="atm-label" htmlFor="qa-status">Status</label>
          <select id="qa-status" className="field" value={status} onChange={(e) => setStatus(e.target.value)}>
            {SUBMITTAL_STATUSES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </div>
        <div>
          <label className="atm-label" htmlFor="qa-date">{d.label} <i>(optional)</i></label>
          <input id="qa-date" type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
    </Shell>
  );
}

export function AddAttentionModal({ projectName, onSave, onClose }) {
  const [item, setItem] = useState('');
  const [from, setFrom] = useState('');
  const [needBy, setNeedBy] = useState('');
  const { busy, err, setErr, save } = useSave(onSave, onClose);
  const submit = () => {
    if (!item.trim()) { setErr('Say what we need.'); return; }
    save({ item: item.trim(), from_party: from.trim(), need_by: needBy || '' });
  };
  return (
    <Shell title="Add attention item" projectName={projectName} busy={busy} err={err} label="Add item" onSubmit={submit} onClose={onClose} className="qa-att">
      <label className="atm-label" htmlFor="qa-item">What we need</label>
      <input id="qa-item" className="field" autoFocus placeholder="e.g. Signed plat of survey" value={item} maxLength={300}
        onChange={(e) => setItem(e.target.value)} onKeyDown={enter(submit)} />
      <div className="qa-two">
        <div>
          <label className="atm-label" htmlFor="qa-from">From <i>(optional)</i></label>
          <input id="qa-from" className="field" placeholder="e.g. Owner" value={from} maxLength={200}
            onChange={(e) => setFrom(e.target.value)} onKeyDown={enter(submit)} />
        </div>
        <div>
          <label className="atm-label" htmlFor="qa-needby">Need by <i>(optional)</i></label>
          <input id="qa-needby" type="date" className="field" value={needBy} onChange={(e) => setNeedBy(e.target.value)} />
        </div>
      </div>
    </Shell>
  );
}

export function AddMeetingModal({ projectName, today, onSave, onClose }) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(today || '');
  const [time, setTime] = useState('');
  const [where, setWhere] = useState('');
  const { busy, err, setErr, save } = useSave(onSave, onClose);
  const submit = () => {
    if (!title.trim()) { setErr('Say what the meeting is (and with whom).'); return; }
    if (!date) { setErr('Pick the meeting date.'); return; }
    save({ title: title.trim(), meeting_date: date, meeting_time: time || '', location: where.trim() });
  };
  return (
    <Shell title="Add meeting" projectName={projectName} busy={busy} err={err} label="Add meeting" onSubmit={submit} onClose={onClose} className="qa-meet">
      <label className="atm-label" htmlFor="qa-mtitle">What / with whom</label>
      <input id="qa-mtitle" className="field" autoFocus placeholder="e.g. Pre-application meeting with Village staff" value={title} maxLength={300}
        onChange={(e) => setTitle(e.target.value)} onKeyDown={enter(submit)} />
      <div className="qa-two">
        <div>
          <label className="atm-label" htmlFor="qa-mdate">Date</label>
          <input id="qa-mdate" type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className="atm-label" htmlFor="qa-mtime">Time <i>(optional)</i></label>
          <input id="qa-mtime" type="time" className="field" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
      </div>
      <label className="atm-label" htmlFor="qa-mwhere">Where <i>(optional)</i></label>
      <input id="qa-mwhere" className="field" placeholder="e.g. Village Hall, or Teams" value={where} maxLength={300}
        onChange={(e) => setWhere(e.target.value)} onKeyDown={enter(submit)} />
    </Shell>
  );
}
