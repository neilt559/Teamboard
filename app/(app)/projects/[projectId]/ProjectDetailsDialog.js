'use client';
import { useId, useRef, useState } from 'react';
import Modal from '@/app/_ui/Modal';
import { api, ConflictError } from '@/app/_ui/api';
import { STAGES, parseStages } from '@/lib/projects';

// "Project details" (design-amendments A6.5), for people who may manage the project (canManageProject, the same
// rights as a rename): project number, name, owner company, jurisdiction (datalists of the values in use) and the
// stages. A draft editor (design §7.4): the values are frozen when it opens, Save sends only what changed, the
// text fields with their base, and adopts the stored row. A 409 keeps the dialog open with their version and
// "Overwrite with mine" / "Discard mine". Dropping the current stage moves it back (the server decides, in the
// same statement). Pre-A6 projects may have no number, owner or jurisdiction yet: a blank one can stay blank,
// but a value can't be emptied (the API refuses that).
const TEXT = [
  { key: 'project_number', label: 'Project number', max: 40, empty: 'Enter the project number.' },
  { key: 'name', label: 'Project name', max: 200, empty: 'A project needs a name.' },
  { key: 'owner_company', label: 'Owner company', max: 200, empty: 'Enter the owner company.', list: 'owners' },
  { key: 'jurisdiction', label: 'Jurisdiction', max: 200, empty: 'Enter the jurisdiction.', list: 'jurisdictions' },
];
const LABELS = Object.fromEntries([...TEXT.map((t) => [t.key, t.label]), ['stages', 'Stages']]);

export default function ProjectDetailsDialog({ project, options, onSaved, onClose }) {
  const uid = useId().replace(/:/g, '');
  // Frozen at open: the base every text field is compared against.
  const base = useRef(null);
  if (!base.current) {
    base.current = {
      ...Object.fromEntries(TEXT.map((t) => [t.key, String(project[t.key] ?? '')])),
      stages: parseStages(project.stages),
    };
  }
  const [f, setF] = useState(() => ({ ...base.current }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [conflict, setConflict] = useState(null);          // { message, fields, current }

  const sameStages = (a, b) => a.length === b.length && a.every((k, i) => k === b[i]);
  const ordered = (keys) => STAGES.map((s) => s.key).filter((k) => keys.includes(k));
  const toggle = (key) => setF((x) => ({ ...x, stages: ordered(x.stages.includes(key) ? x.stages.filter((k) => k !== key) : [...x.stages, key]) }));

  // bases: what each field is compared against and sent as its base (the values at open; after a 409, theirs).
  const save = async (e, bases = base.current) => {
    e?.preventDefault?.();
    if (busy) return;
    const body = {};
    const baseOut = {};
    for (const t of TEXT) {
      const v = f[t.key].trim();
      const was = String(bases[t.key] ?? '');
      if (v === was.trim()) continue;
      if (!v) { setErr(t.empty); return; }
      body[t.key] = v;
      baseOut[t.key] = was;
    }
    if (!sameStages(f.stages, parseStages(bases.stages))) {
      if (!f.stages.length) { setErr('Pick at least one stage.'); return; }
      body.stages = f.stages;
    }
    if (!Object.keys(body).length) { onClose(); return; }
    if (Object.keys(baseOut).length) body.base = baseOut;
    setBusy(true);
    setErr(null);
    try {
      const r = await api(`/api/projects/${project.id}`, { method: 'PATCH', body });
      onSaved(r?.row || null);
      onClose();
    } catch (e2) {
      setBusy(false);
      if (e2 instanceof ConflictError) {
        setConflict({ message: e2.message, fields: e2.fields || [], current: e2.current || {} });
      } else {
        setErr(e2?.message || 'Couldn’t save — please try again.');
      }
    }
  };

  // Overwrite: resend with their values as the base (only the fields still different from theirs go out).
  const overwrite = () => {
    const cur = conflict?.current || {};
    setConflict(null);
    save(null, { ...Object.fromEntries(TEXT.map((t) => [t.key, String(cur[t.key] ?? base.current[t.key])])), stages: cur.stages ?? base.current.stages });
  };
  const discard = () => {
    const cur = conflict?.current || null;
    setConflict(null);
    onSaved(cur, { wrote: false });                       // theirs on screen; nothing of ours was written
    onClose();
  };

  return (
    <Modal
      title="Project details"
      className="cp-modal pd-modal"
      onClose={busy ? undefined : onClose}
      actions={conflict ? (
        <>
          <button type="button" className="btn btn-plain" onClick={discard}>Discard mine</button>
          <button type="button" className="btn btn-ink" onClick={overwrite}>Overwrite with mine</button>
        </>
      ) : (
        <>
          <button type="button" className="btn btn-plain" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form={`${uid}-form`} className="btn btn-lime" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      )}
    >
      <form id={`${uid}-form`} className="cp-form" onSubmit={save} noValidate>
        {conflict && (
          <div className="pd-conflict" role="alert">
            <p><b>{conflict.message}</b></p>
            <ul>
              {(conflict.fields.length ? conflict.fields : Object.keys(LABELS)).filter((k) => LABELS[k]).map((k) => (
                <li key={k}>{LABELS[k]}: <b>{k === 'stages'
                  ? parseStages(conflict.current?.stages).map((s) => STAGES.find((x) => x.key === s)?.label).join(', ') || '(none)'
                  : String(conflict.current?.[k] ?? '') || '(blank)'}</b></li>
              ))}
            </ul>
          </div>
        )}
        <div className="cp-row">
          {TEXT.slice(0, 2).map((t) => (
            <label key={t.key} className={`cp-field${t.key === 'name' ? ' cp-grow' : ' cp-num'}`}>
              <span className="atm-label">{t.label}</span>
              <input className="field" value={f[t.key]} maxLength={t.max} autoComplete="off"
                onChange={(e) => setF((x) => ({ ...x, [t.key]: e.target.value }))} />
            </label>
          ))}
        </div>
        {TEXT.slice(2).map((t) => (
          <label key={t.key} className="cp-field">
            <span className="atm-label">{t.label}</span>
            <input className="field" value={f[t.key]} maxLength={t.max} autoComplete="off" list={`${uid}-${t.list}`}
              onChange={(e) => setF((x) => ({ ...x, [t.key]: e.target.value }))} />
            <datalist id={`${uid}-${t.list}`}>{(options?.[t.list] || []).map((o) => <option key={o} value={o} />)}</datalist>
          </label>
        ))}
        <fieldset className="cp-stages">
          <legend className="atm-label">Stages this project goes through</legend>
          <div className="cp-stage-list">
            {STAGES.map((s) => (
              <label key={s.key} className={`cp-stage${f.stages.includes(s.key) ? ' on' : ''}`}>
                <input type="checkbox" checked={f.stages.includes(s.key)} onChange={() => toggle(s.key)} />
                <span>{s.label}</span>
              </label>
            ))}
          </div>
          <p className="cp-hint">Removing the current stage moves the project back to the closest earlier stage you kept.</p>
        </fieldset>
        {err && <p className="ofc-dialog-err" role="alert">{err}</p>}
      </form>
    </Modal>
  );
}
