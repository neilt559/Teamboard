'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ConflictError } from '@/app/_ui/api';
import { DraftConflict } from '@/app/_ui/ConflictNotice';
import { NotesEditor } from '@/app/notes-format';
import { IconMedal, IconCheck, IconAlert } from '@/app/icons';
import { AGGREGATIONS, GROUP_RANKS, LIMITS, MAX_RANGE_DAYS, fmtRange, monthRange } from '@/lib/challenges';
import { addDays, daysBetween } from '@/lib/time';

// New / edit challenge (design §10(a) "Configuration"; organizers). A draft editor (design §7.4): the base is
// frozen when the form opens, Save sends only the changed fields (text ones with their base), and a 409 keeps the
// form open with each conflicting field's other version plus "Overwrite with mine" / "Discard mine and reload".

const IDEAS = [
  { key: 'steps', label: 'Steps', set: { metric_label: 'Steps', unit: 'steps', aggregation: 'sum', higher_is_better: true } },
  { key: 'miles', label: 'Miles walked or run', set: { metric_label: 'Miles', unit: 'mi', aggregation: 'sum', higher_is_better: true } },
  { key: 'workouts', label: 'Workouts', set: { metric_label: 'Workouts', unit: 'workouts', aggregation: 'count', higher_is_better: true } },
  { key: '5k', label: 'Fastest 5K', set: { metric_label: '5K time (minutes)', unit: 'min', aggregation: 'max', higher_is_better: false } },
];
const TEXT = ['title', 'description', 'metric_label', 'unit'];
const FIELDS = [...TEXT, 'aggregation', 'higher_is_better', 'group_rank', 'starts_on', 'ends_on', 'office_id'];
const LABELS = { title: 'Title', description: 'Description', metric_label: 'What people log', unit: 'Unit' };

const fromChallenge = (c) => ({
  title: c.title || '', description: c.description || '', metric_label: c.metric_label || 'Points', unit: c.unit || '',
  aggregation: c.aggregation || 'sum', higher_is_better: c.higher_is_better !== false, group_rank: c.group_rank || 'avg',
  starts_on: c.starts_on, ends_on: c.ends_on, office_id: c.office_id ? String(c.office_id) : '',
});

export default function ChallengeForm({ mode, challenge = null, defaults = null, offices = [], today }) {
  const router = useRouter();
  const start = challenge ? fromChallenge(challenge) : {
    title: '', description: '', metric_label: 'Miles', unit: 'mi', aggregation: 'sum', higher_is_better: true, group_rank: 'avg',
    starts_on: defaults?.starts_on, ends_on: defaults?.ends_on, office_id: '',
  };
  const [base, setBase] = useState(start);          // frozen when the form opened (edit)
  const [f, setF] = useState(start);
  const [editorKey, setEditorKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [bad, setBad] = useState({});
  const [conflict, setConflict] = useState(null);
  // Changing a field clears its error (either date clears both date errors).
  const setMany = (patch) => {
    setF((x) => ({ ...x, ...patch }));
    const keys = Object.keys(patch).flatMap((k) => (k === 'starts_on' || k === 'ends_on' ? ['starts_on', 'ends_on'] : [k]));
    setBad((b) => (keys.some((k) => b[k]) ? { ...b, ...Object.fromEntries(keys.map((k) => [k, undefined])) } : b));
  };
  const set = (k, v) => setMany({ [k]: v });
  const isEdit = mode === 'edit';
  const changed = FIELDS.filter((k) => f[k] !== base[k]);

  const thisMonth = monthRange(today);
  const nextMonth = monthRange(addDays(thisMonth.ends_on, 1));

  const validate = () => {
    const b = {};
    if (!f.title.trim()) b.title = 'Give the challenge a title.';
    if (!f.starts_on) b.starts_on = 'Pick the start date.';
    if (!f.ends_on) b.ends_on = 'Pick the end date.';
    if (f.starts_on && f.ends_on && f.ends_on < f.starts_on) b.ends_on = 'The end date can’t be before the start date.';
    else if (f.starts_on && f.ends_on && daysBetween(f.starts_on, f.ends_on) + 1 > MAX_RANGE_DAYS) b.ends_on = 'A challenge can run for a year at most.';
    setBad(b);
    return !Object.keys(b).length;
  };

  const send = async (baseOverride = null) => {
    if (busy || !validate()) return;
    setBusy(true);
    setErr('');
    try {
      if (!isEdit) {
        const r = await api('/api/culture/challenges', { method: 'POST', body: { ...f, office_id: f.office_id || null } });
        router.push(`/culture/challenges/${r.id}`);
        router.refresh();
        return;
      }
      if (!changed.length) { router.push(`/culture/challenges/${challenge.id}`); return; }
      const body = {};
      const bases = {};
      for (const k of changed) {
        body[k] = k === 'office_id' ? (f.office_id || null) : f[k];
        if (TEXT.includes(k)) bases[k] = baseOverride && k in baseOverride ? baseOverride[k] : base[k];
      }
      if (Object.keys(bases).length) body.base = bases;
      await api(`/api/culture/challenges/${challenge.id}`, { method: 'PATCH', body });
      setConflict(null);
      router.push(`/culture/challenges/${challenge.id}`);
      router.refresh();
    } catch (e) {
      if (e instanceof ConflictError) setConflict(e.json);
      else setErr(e.message || 'That didn’t save.');
      setBusy(false);
    }
  };

  const overwrite = () => {
    const cur = conflict?.current || {};
    const over = {};
    for (const k of TEXT) if (k in cur) over[k] = cur[k] ?? '';
    send(over);
  };
  const discard = () => {
    const cur = conflict?.current || {};
    const next = { ...f };
    for (const k of TEXT) if (k in cur) next[k] = cur[k] ?? '';
    setBase((b) => ({ ...b, ...Object.fromEntries(TEXT.filter((k) => k in cur).map((k) => [k, cur[k] ?? ''])) }));
    setF(next);
    setEditorKey((n) => n + 1);
    setConflict(null);
    router.refresh();
  };

  const range = f.starts_on && f.ends_on && f.ends_on >= f.starts_on ? fmtRange(f.starts_on, f.ends_on) : '';
  const datesMoved = isEdit && (f.starts_on !== base.starts_on || f.ends_on !== base.ends_on);
  return (
    <div className="ch-page ch-form-page">
      <div className="proj-head">
        <h1 className="wi-h"><IconMedal size={24} /> {isEdit ? 'Edit challenge' : 'New challenge'}</h1>
      </div>
      <form className="ch-form ch-panel" onSubmit={(e) => { e.preventDefault(); send(); }} noValidate>
        {!isEdit && (
          <div className="ch-ideas">
            <span className="ch-label">Start from an idea</span>
            <div className="ch-ideas-row">
              {IDEAS.map((i) => (
                <button key={i.key} type="button" className="ch-idea" onClick={() => setMany(i.set)}>{i.label}</button>
              ))}
            </div>
          </div>
        )}
        <label className="ch-field">
          <span className="ch-label">Title</span>
          <input className={`field ch-input${bad.title ? ' ch-bad' : ''}`} maxLength={LIMITS.title} value={f.title}
            onChange={(e) => set('title', e.target.value)} placeholder="October Step Challenge" />
          {bad.title && <span className="ch-field-err">{bad.title}</span>}
        </label>
        <div className="ch-field">
          <span className="ch-label">Description <span className="ch-opt">(rules, prizes, links)</span></span>
          <NotesEditor key={editorKey} value={f.description} onChange={(v) => set('description', v)}
            placeholder="How it works, what counts, what the winners get…" />
        </div>
        <div className="ch-form-row">
          <label className="ch-field">
            <span className="ch-label">What people log</span>
            <input className="field ch-input" maxLength={LIMITS.metric_label} value={f.metric_label}
              onChange={(e) => set('metric_label', e.target.value)} placeholder="Miles" />
          </label>
          <label className="ch-field ch-field-unit">
            <span className="ch-label">Unit <span className="ch-opt">(optional)</span></span>
            <input className="field ch-input" maxLength={LIMITS.unit} value={f.unit} onChange={(e) => set('unit', e.target.value)} placeholder="mi" />
          </label>
        </div>
        <fieldset className="ch-fieldset">
          <legend className="ch-label">How a person’s score adds up</legend>
          <div className="ch-seg" role="radiogroup">
            {Object.entries(AGGREGATIONS).map(([k, a]) => (
              <label key={k} className={`ch-seg-opt${f.aggregation === k ? ' on' : ''}`}>
                <input type="radio" name="aggregation" value={k} checked={f.aggregation === k} onChange={() => set('aggregation', k)} />
                {a.label}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="ch-fieldset">
          <legend className="ch-label">Who wins</legend>
          <div className="ch-seg" role="radiogroup">
            <label className={`ch-seg-opt${f.higher_is_better ? ' on' : ''}`}>
              <input type="radio" name="hib" checked={f.higher_is_better} onChange={() => set('higher_is_better', true)} /> Highest score
            </label>
            <label className={`ch-seg-opt${!f.higher_is_better ? ' on' : ''}`}>
              <input type="radio" name="hib" checked={!f.higher_is_better} onChange={() => set('higher_is_better', false)} /> Lowest score (times)
            </label>
          </div>
        </fieldset>
        <div className="ch-field">
          <span className="ch-label">Dates</span>
          <div className="ch-form-row ch-dates">
            <label className="ch-field">
              <span className="ch-sub">Starts</span>
              <input type="date" className={`field ch-input${bad.starts_on ? ' ch-bad' : ''}`} value={f.starts_on || ''} onChange={(e) => set('starts_on', e.target.value)} />
            </label>
            <label className="ch-field">
              <span className="ch-sub">Ends</span>
              <input type="date" className={`field ch-input${bad.ends_on ? ' ch-bad' : ''}`} value={f.ends_on || ''} onChange={(e) => set('ends_on', e.target.value)} />
            </label>
          </div>
          <div className="ch-ideas-row">
            <button type="button" className="ch-idea" onClick={() => setMany(thisMonth)}>This month</button>
            <button type="button" className="ch-idea" onClick={() => setMany(nextMonth)}>Next month</button>
            {range && <span className="ch-hint">{range}</span>}
          </div>
          {(bad.starts_on || bad.ends_on) && <span className="ch-field-err">{bad.starts_on || bad.ends_on}</span>}
          {datesMoved && <span className="ch-hint ch-warn"><IconAlert size={13} /> Entries outside the new dates stop counting (they’re kept, and count again if the dates move back).</span>}
        </div>
        <div className="ch-form-row">
          <label className="ch-field">
            <span className="ch-label">Who takes part</span>
            <select className="field ch-input" value={f.office_id} onChange={(e) => set('office_id', e.target.value)}>
              <option value="">The whole company</option>
              {offices.map((o) => <option key={o.id} value={o.id}>{o.name} office only{o.archived ? ' (archived)' : ''}</option>)}
            </select>
          </label>
          <label className="ch-field">
            <span className="ch-label">Office and department boards rank by</span>
            <select className="field ch-input" value={f.group_rank} onChange={(e) => set('group_rank', e.target.value)}>
              {Object.entries(GROUP_RANKS).map(([k, g]) => <option key={k} value={k}>{g.label} ({g.hint.toLowerCase()})</option>)}
            </select>
          </label>
        </div>
        <DraftConflict conflict={conflict} labels={LABELS} onOverwrite={overwrite} onDiscard={discard} />
        {err && <p className="ch-error" role="alert">{err}</p>}
        <div className="ch-form-actions">
          <Link href={isEdit ? `/culture/challenges/${challenge.id}` : '/culture/challenges'} prefetch={false} className="btn btn-plain">Cancel</Link>
          <button type="submit" className="btn btn-lime wi" disabled={busy || (isEdit && !changed.length)}>
            <IconCheck size={15} /> {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create challenge'}
          </button>
        </div>
      </form>
    </div>
  );
}
