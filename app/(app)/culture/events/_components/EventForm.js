'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ConflictError } from '@/app/_ui/api';
import { DraftConflict } from '@/app/_ui/ConflictNotice';
import { NotesEditor } from '@/app/notes-format';
import { IconCalendar, IconCheck, IconClock } from '@/app/icons';
import { DEFAULT_TZ, LIMITS, ZONES, eventWhen, isZone, normalizeLink, scheduleProblem } from '@/lib/events';

// New / edit event (design §10(b); organizers). A draft editor (design §7.4): the base is frozen when the form opens,
// Save sends only the changed fields (text ones with their base; any date/time change sends the whole schedule), and
// a 409 keeps the form open with each conflicting field's other version plus "Overwrite with mine" / "Discard mine
// and reload". Times are entered in the event's zone (default: the chosen office's, else the organizer's own); the
// preview line shows how it reads, with the organizer's own time when the zones differ.

const TEXT = ['title', 'details', 'location', 'link_url'];
const SCHEDULE = ['all_day', 'starts_on', 'ends_on', 'start_time', 'end_time', 'tz'];
const FIELDS = [...TEXT, 'office_id', ...SCHEDULE];
const LABELS = { title: 'Title', details: 'Details', location: 'Where', link_url: 'Link' };

const fromEvent = (e) => ({
  title: e.title || '', details: e.details || '', location: e.location || '', link_url: e.link_url || '',
  office_id: e.office_id ? String(e.office_id) : '', all_day: e.all_day !== false, starts_on: e.starts_on, ends_on: e.ends_on,
  start_time: e.start_time || '', end_time: e.end_time || '', tz: e.tz || DEFAULT_TZ,
});

export default function EventForm({ mode, event = null, date = null, offices = [], viewerTz = DEFAULT_TZ }) {
  const router = useRouter();
  const myTz = isZone(viewerTz) ? viewerTz : DEFAULT_TZ;
  const start = event ? fromEvent(event) : {
    title: '', details: '', location: '', link_url: '', office_id: '', all_day: true, starts_on: date || '', ends_on: date || '',
    start_time: '', end_time: '', tz: myTz,
  };
  const [base, setBase] = useState(start);          // frozen when the form opened (edit)
  const [f, setF] = useState(start);
  const [tzTouched, setTzTouched] = useState(!!event);
  const [editorKey, setEditorKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [bad, setBad] = useState({});
  const [conflict, setConflict] = useState(null);
  const isEdit = mode === 'edit';

  const setMany = (patch) => {
    setF((x) => ({ ...x, ...patch }));
    setBad((b) => {
      const keys = Object.keys(patch);
      const sched = keys.some((k) => SCHEDULE.includes(k));
      const clear = sched ? [...keys, ...SCHEDULE] : keys;
      return clear.some((k) => b[k]) ? { ...b, ...Object.fromEntries(clear.map((k) => [k, undefined])) } : b;
    });
  };
  const set = (k, v) => setMany({ [k]: v });
  const zoneOf = (officeId) => {
    const o = offices.find((x) => String(x.id) === String(officeId));
    return o && isZone(o.tz) ? o.tz : myTz;
  };
  const pickOffice = (id) => setMany(tzTouched ? { office_id: id } : { office_id: id, tz: zoneOf(id) });
  const pickStart = (d) => {
    // A one-day event moves as a whole; a longer one keeps its end unless the end would come first.
    const keepEnd = f.ends_on && f.starts_on && f.ends_on !== f.starts_on && f.ends_on >= d;
    setMany({ starts_on: d, ends_on: keepEnd ? f.ends_on : d });
  };

  const sched = { all_day: f.all_day, starts_on: f.starts_on, ends_on: f.ends_on, start_time: f.start_time || null,
    end_time: f.end_time || null, tz: f.tz };
  const preview = useMemo(() => {
    if (scheduleProblem(sched)) return '';
    return eventWhen(sched, myTz).line;
  }, [f.all_day, f.starts_on, f.ends_on, f.start_time, f.end_time, f.tz, myTz]); // eslint-disable-line react-hooks/exhaustive-deps

  const validate = () => {
    const b = {};
    if (!f.title.trim()) b.title = 'Give the event a title.';
    const p = scheduleProblem(sched);
    if (p) b[p.field] = p.message;
    if (normalizeLink(f.link_url) == null) b.link_url = 'The link must be a web address (https://…).';
    setBad(b);
    return !Object.keys(b).length;
  };

  const changed = FIELDS.filter((k) => f[k] !== base[k]);
  const send = async (baseOverride = null) => {
    if (busy || !validate()) return;
    setBusy(true);
    setErr('');
    try {
      const schedBody = { all_day: f.all_day, starts_on: f.starts_on, ends_on: f.ends_on,
        start_time: f.all_day ? null : (f.start_time || null), end_time: f.all_day ? null : (f.end_time || null), tz: f.tz };
      if (!isEdit) {
        const r = await api('/api/culture/events', { method: 'POST', body: {
          title: f.title, details: f.details, location: f.location, link_url: f.link_url, office_id: f.office_id || null, ...schedBody,
        } });
        router.push(`/culture/events/${r.id}`);
        router.refresh();
        return;
      }
      if (!changed.length) { router.push(`/culture/events/${event.id}`); return; }
      const body = {};
      const bases = {};
      for (const k of changed) {
        if (TEXT.includes(k)) {
          body[k] = f[k];
          bases[k] = baseOverride && k in baseOverride ? baseOverride[k] : base[k];
        } else if (k === 'office_id') body.office_id = f.office_id || null;
      }
      if (changed.some((k) => SCHEDULE.includes(k))) Object.assign(body, schedBody);
      if (Object.keys(bases).length) body.base = bases;
      await api(`/api/culture/events/${event.id}`, { method: 'PATCH', body });
      setConflict(null);
      router.push(`/culture/events/${event.id}`);
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

  const zones = ZONES;
  return (
    <div className="ev-page ev-form-page">
      <div className="proj-head">
        <h1 className="wi-h"><IconCalendar size={24} /> {isEdit ? 'Edit event' : 'New event'}</h1>
      </div>
      <form className="ev-form ev-panel" onSubmit={(e) => { e.preventDefault(); send(); }} noValidate>
        <label className="ev-field">
          <span className="ev-label">Title</span>
          <input className={`field ev-input${bad.title ? ' ev-bad' : ''}`} maxLength={LIMITS.title} value={f.title} name="title"
            onChange={(e) => set('title', e.target.value)} placeholder="Fall potluck" />
          {bad.title && <span className="ev-field-err">{bad.title}</span>}
        </label>

        <label className="ev-field">
          <span className="ev-label">Who it’s for</span>
          <select className="field ev-input" name="office_id" value={f.office_id} onChange={(e) => pickOffice(e.target.value)}>
            <option value="">The whole company</option>
            {offices.map((o) => <option key={o.id} value={o.id}>{o.name} office{o.archived ? ' (archived)' : ''}</option>)}
          </select>
          <span className="ev-hint">Everyone can see every event; office events are for that office’s people.</span>
        </label>

        <fieldset className="ev-fieldset">
          <legend className="ev-label">When</legend>
          <div className="seg ev-seg" role="radiogroup" aria-label="All day or at a time">
            <label className={`seg-opt${f.all_day ? ' on' : ''}`}>
              <input type="radio" name="all_day" checked={f.all_day} onChange={() => set('all_day', true)} /> All day
            </label>
            <label className={`seg-opt${!f.all_day ? ' on' : ''}`}>
              <input type="radio" name="all_day" checked={!f.all_day} onChange={() => set('all_day', false)} /> At a time
            </label>
          </div>
          <div className="ev-row2">
            <label className="ev-field">
              <span className="ev-sub">Starts</span>
              <input type="date" name="starts_on" className={`field ev-input${bad.starts_on ? ' ev-bad' : ''}`} value={f.starts_on || ''}
                onChange={(e) => pickStart(e.target.value)} />
            </label>
            {!f.all_day && (
              <label className="ev-field">
                <span className="ev-sub">Start time</span>
                <input type="time" name="start_time" step="300" className={`field ev-input${bad.start_time ? ' ev-bad' : ''}`} value={f.start_time || ''}
                  onChange={(e) => set('start_time', e.target.value)} />
              </label>
            )}
          </div>
          <div className="ev-row2">
            <label className="ev-field">
              <span className="ev-sub">Ends</span>
              <input type="date" name="ends_on" className={`field ev-input${bad.ends_on ? ' ev-bad' : ''}`} value={f.ends_on || ''}
                min={f.starts_on || undefined} onChange={(e) => set('ends_on', e.target.value)} />
            </label>
            {!f.all_day && (
              <label className="ev-field">
                <span className="ev-sub">End time <span className="ev-opt">(optional)</span></span>
                <input type="time" name="end_time" step="300" className={`field ev-input${bad.end_time ? ' ev-bad' : ''}`} value={f.end_time || ''}
                  onChange={(e) => set('end_time', e.target.value)} />
              </label>
            )}
          </div>
          {!f.all_day && (
            <label className="ev-field ev-tz">
              <span className="ev-sub">Time zone of these times</span>
              <select className={`field ev-input${bad.tz ? ' ev-bad' : ''}`} name="tz" value={f.tz}
                onChange={(e) => { setTzTouched(true); set('tz', e.target.value); }}>
                {zones.map((z) => <option key={z.tz} value={z.tz}>{z.label}</option>)}
              </select>
            </label>
          )}
          {(bad.starts_on || bad.ends_on || bad.start_time || bad.end_time || bad.tz) && (
            <span className="ev-field-err">{bad.starts_on || bad.ends_on || bad.start_time || bad.end_time || bad.tz}</span>
          )}
          {preview && <p className="ev-preview"><IconClock size={14} /> <span>{preview}</span></p>}
        </fieldset>

        <label className="ev-field">
          <span className="ev-label">Where <span className="ev-opt">(optional)</span></span>
          <input className="field ev-input" maxLength={LIMITS.location} value={f.location} name="location"
            onChange={(e) => set('location', e.target.value)} placeholder="Lisle office, break room" />
        </label>
        <label className="ev-field">
          <span className="ev-label">Link <span className="ev-opt">(optional: sign-up sheet, map, Teams meeting)</span></span>
          <input className={`field ev-input${bad.link_url ? ' ev-bad' : ''}`} maxLength={LIMITS.link_url} value={f.link_url} name="link_url"
            inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false}
            onChange={(e) => set('link_url', e.target.value)} placeholder="https://…" />
          {bad.link_url && <span className="ev-field-err">{bad.link_url}</span>}
        </label>
        <div className="ev-field">
          <span className="ev-label">Details <span className="ev-opt">(what to bring, who to ask)</span></span>
          <NotesEditor key={editorKey} value={f.details} onChange={(v) => set('details', v)} placeholder="What it is, what to bring, who to ask…" />
        </div>

        <DraftConflict conflict={conflict} labels={LABELS} onOverwrite={overwrite} onDiscard={discard} />
        {err && <p className="ev-error" role="alert">{err}</p>}
        <div className="ev-form-actions">
          <Link href={isEdit ? `/culture/events/${event.id}` : '/culture/calendar'} prefetch={false} className="btn btn-plain">Cancel</Link>
          <button type="submit" className="btn btn-lime wi" disabled={busy || (isEdit && !changed.length)}>
            <IconCheck size={15} /> {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Add to calendar'}
          </button>
        </div>
      </form>
    </div>
  );
}
