'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/app/_ui/api';
import { IconCaret, IconPin, IconCheck } from '@/app/icons';
import { withDefaults, MAX_FOLLOWED } from '@/lib/prefs';
import { projectTitle } from '@/lib/projects';

// Settings > Customize (design §11). Preferences follow the person across devices (users.prefs, PATCH
// /api/prefs). Each control saves on its own, right away, and the page refreshes so the shell picks it up
// (density, the sidebar's followed offices and pins). Follows and pins never grant access.

const LANDING = [
  ['home', 'Home'], ['my-work', 'My work'], ['projects', 'Projects'], ['tasks', 'All tasks'],
  ['threads', 'Threads'], ['culture', 'Culture'],
];
const WIDGET_LABELS = {
  my_tasks: 'My tasks', pinned_projects: 'Pinned projects', my_projects: 'My projects', announcements: 'Announcements',
  threads: 'Threads (your spaces)', challenge: 'This month’s challenge', events: 'Upcoming events', bracket: 'Bracket',
  geo: 'GeoGuessr', admin_queue: 'Approval queue (admins)',
};
// The challenge/events arrive in Release 3. Until then their Home cards render nothing, so they aren't offered
// here (the agents shipping them remove the key from this list). Threads and announcements shipped in Release 2.
const NOT_YET = new Set(['challenge', 'events']);
const NOT_YET_LANDING = new Set([]);

function Saved({ on }) {
  return on ? <span className="pf-ok wi" role="status"><IconCheck size={14} /> Saved</span> : null;
}

export default function CustomizeForm({ viewer, data }) {
  const router = useRouter();
  const [p, setP] = useState(() => withDefaults(data.prefs, { isAdmin: viewer.is_admin }));
  const [pinned, setPinned] = useState(data.pinned);
  const [saved, setSaved] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { setP(withDefaults(data.prefs, { isAdmin: viewer.is_admin })); setPinned(data.pinned); }, [data, viewer.is_admin]);

  const save = async (patch, tag) => {
    setErr('');
    setSaved('');
    setP((x) => ({ ...x, ...patch }));                       // optimistic
    try {
      const r = await api('/api/prefs', { method: 'PATCH', body: patch });
      if (r.prefs) setP(r.prefs);
      setSaved(tag);
      router.refresh();
    } catch (e) {
      setErr(e.message || 'Couldn’t save that — please try again.');
      setP(withDefaults(data.prefs, { isAdmin: viewer.is_admin }));
    }
  };

  // Home cards: order (up/down) and on/off. Keys not yet released stay in place but aren't listed.
  const widgets = p.widgets.filter((w) => !NOT_YET.has(w.key));
  const moveWidget = (key, dir) => {
    const all = [...p.widgets];
    const shown = all.filter((w) => !NOT_YET.has(w.key)).map((w) => w.key);
    const i = shown.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= shown.length) return;
    const a = all.findIndex((w) => w.key === shown[i]);
    const b = all.findIndex((w) => w.key === shown[j]);
    [all[a], all[b]] = [all[b], all[a]];
    save({ widgets: all }, 'widgets');
  };
  const toggleWidget = (key) => save({ widgets: p.widgets.map((w) => (w.key === key ? { ...w, on: !w.on } : w)) }, 'widgets');

  const mine = viewer.office_ids.map(String);
  const otherOffices = data.offices.filter((o) => !o.archived && !mine.includes(String(o.id)));
  const followed = p.followed_office_ids.map(String);
  const toggleFollow = (id) => {
    const next = followed.includes(String(id)) ? followed.filter((x) => x !== String(id)) : [...followed, String(id)];
    if (next.length > MAX_FOLLOWED) { setErr(`You can follow up to ${MAX_FOLLOWED} offices.`); return; }
    save({ followed_office_ids: next }, 'follow');
  };

  const movePin = (i, dir) => {
    const ids = pinned.map((x) => x.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setPinned((list) => { const l = [...list]; [l[i], l[j]] = [l[j], l[i]]; return l; });
    save({ pinned_project_ids: ids }, 'pins');
  };
  const unpin = (id) => {
    setPinned((list) => list.filter((x) => x.id !== id));
    save({ pinned_project_ids: p.pinned_project_ids.filter((x) => String(x) !== String(id)) }, 'pins');
  };

  return (
    <div className="pf-form">
      {err && <div className="bk-err" role="alert">{err}</div>}

      <div className="pf-section">
        <h2 className="pf-h"><label htmlFor="cz-landing">Start page</label> <Saved on={saved === 'landing'} /></h2>
        <p className="pf-help">Where TeamBoard opens the first time in a browser tab.</p>
        <select id="cz-landing" className="field pf-select" value={p.landing}
          onChange={(e) => save({ landing: e.target.value }, 'landing')}>
          {LANDING.filter(([k]) => !NOT_YET_LANDING.has(k) || p.landing === k).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </div>

      <div className="pf-section">
        <h2 className="pf-h">Home page cards <Saved on={saved === 'widgets'} /></h2>
        <p className="pf-help">Pick which cards show on Home, and their order.</p>
        <ul className="cz-widgets">
          {widgets.map((w, i) => (
            <li key={w.key} className={`cz-widget${w.on ? '' : ' off'}`}>
              <label className="cz-check">
                <input type="checkbox" checked={w.on} onChange={() => toggleWidget(w.key)} />
                <span>{WIDGET_LABELS[w.key] || w.key}</span>
              </label>
              <button type="button" className="cz-move" onClick={() => moveWidget(w.key, -1)} disabled={i === 0} aria-label={`Move ${WIDGET_LABELS[w.key]} up`}>
                <IconCaret size={16} className="cz-up" />
              </button>
              <button type="button" className="cz-move" onClick={() => moveWidget(w.key, 1)} disabled={i === widgets.length - 1} aria-label={`Move ${WIDGET_LABELS[w.key]} down`}>
                <IconCaret size={16} />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="pf-section">
        <h2 className="pf-h">Offices you follow <Saved on={saved === 'follow'} /></h2>
        <p className="pf-help">Followed offices show in your sidebar and come first on the Offices page. Following only changes what you see listed; it doesn’t open anything up.</p>
        {otherOffices.length ? (
          <div className="cz-offices">
            {otherOffices.map((o) => (
              <label key={o.id} className={`cz-office${followed.includes(String(o.id)) ? ' on' : ''}`}>
                <input type="checkbox" checked={followed.includes(String(o.id))} onChange={() => toggleFollow(o.id)} />
                <span>{o.name}</span>
              </label>
            ))}
          </div>
        ) : <p className="pf-help">You already belong to every office.</p>}
      </div>

      <div className="pf-section">
        <h2 className="pf-h">Pinned projects <Saved on={saved === 'pins'} /></h2>
        {pinned.length ? (
          <ul className="cz-pins">
            {pinned.map((x, i) => (
              <li key={x.id} className="cz-pin">
                <IconPin size={15} />
                <Link href={`/projects/${x.id}`} prefetch={false} className="cz-pin-name">{projectTitle(x)}</Link>
                {x.archived && <span className="acct-tag test">Archived</span>}
                <button type="button" className="cz-move" onClick={() => movePin(i, -1)} disabled={i === 0} aria-label={`Move ${projectTitle(x)} up`}><IconCaret size={16} className="cz-up" /></button>
                <button type="button" className="cz-move" onClick={() => movePin(i, 1)} disabled={i === pinned.length - 1} aria-label={`Move ${projectTitle(x)} down`}><IconCaret size={16} /></button>
                <button type="button" className="btn btn-plain btn-sm" onClick={() => unpin(x.id)}>Unpin</button>
              </li>
            ))}
          </ul>
        ) : <p className="pf-help">Nothing pinned yet. Pin projects on the <Link href="/projects" prefetch={false}>Projects</Link> page to keep them at the top of your sidebar and Home.</p>}
      </div>

      <div className="pf-section">
        <h2 className="pf-h">Layout <Saved on={saved === 'density'} /></h2>
        <div className="seg" role="radiogroup" aria-label="Density">
          {[['comfortable', 'Comfortable'], ['compact', 'Compact']].map(([k, label]) => (
            <label key={k} className={`seg-opt${p.density === k ? ' on' : ''}`}>
              <input type="radio" name="cz-density" checked={p.density === k} onChange={() => save({ density: k }, 'density')} />
              {label}
            </label>
          ))}
        </div>
        <p className="pf-help">Compact tightens table rows and card spacing.</p>
      </div>

      <div className="pf-section">
        <h2 className="pf-h">My work <Saved on={saved === 'mywork'} /></h2>
        <div className="seg" role="radiogroup" aria-label="Group my tasks">
          {[['due', 'By due date'], ['project', 'By project']].map(([k, label]) => (
            <label key={k} className={`seg-opt${p.my_work_group === k ? ' on' : ''}`}>
              <input type="radio" name="cz-mywork" checked={p.my_work_group === k} onChange={() => save({ my_work_group: k }, 'mywork')} />
              {label}
            </label>
          ))}
        </div>
      </div>

      <div className="pf-section">
        <h2 className="pf-h">Calendar <Saved on={saved === 'cal'} /></h2>
        <div className="seg" role="radiogroup" aria-label="Calendar view">
          {[[null, 'Device default'], ['month', 'Month'], ['agenda', 'Agenda']].map(([k, label]) => (
            <label key={String(k)} className={`seg-opt${p.calendar_view === k ? ' on' : ''}`}>
              <input type="radio" name="cz-cal" checked={p.calendar_view === k} onChange={() => save({ calendar_view: k }, 'cal')} />
              {label}
            </label>
          ))}
        </div>
        <p className="pf-help">Device default shows the agenda on phones and the month grid on bigger screens.</p>
      </div>

      {p.dismissed.length > 0 && (
        <div className="pf-section">
          <h2 className="pf-h">Hidden cards <Saved on={saved === 'dismissed'} /></h2>
          <p className="pf-help">You’ve closed {p.dismissed.length === 1 ? 'a card' : `${p.dismissed.length} cards`} on Home (like “What’s new”).</p>
          <button type="button" className="btn btn-plain btn-sm" onClick={() => save({ dismissed: null }, 'dismissed')}>Show them again</button>
        </div>
      )}
    </div>
  );
}
