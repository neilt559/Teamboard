'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, logout } from '@/app/_ui/api';
import { IconCheck, IconUser, IconBuilding, IconTag, IconCamera } from '@/app/icons';
import {
  OfficeCards, DeptChips, PositionGroups, TeamSelect, BossPicker, PersonChoice, PhotoEditor, positionNote,
} from './fields';
import { bestPersonMatch, guessFromUsername } from './match';

// The one-time profile wizard (design §5.2). Four steps, one per screen, with progress dots, Back and
// Continue; one submit at the end (PUT /api/profile), applied atomically on the server. The draft lives in
// sessionStorage.tb_welcome_draft, so a reload resumes where it was. The photo step saves straight away
// (PUT /api/avatar/:me works before the profile is finished) and is optional.

const DRAFT_KEY = 'tb_welcome_draft';
const STEPS = [
  { key: 'about', label: 'About you', Icon: IconUser },
  { key: 'work', label: 'Where you work', Icon: IconBuilding },
  { key: 'name', label: 'Your name on tasks', Icon: IconTag },
  { key: 'photo', label: 'Photo', Icon: IconCamera },
];
const EMAIL_DOMAIN = 'cagecivil.com';

function readDraft(uid) {
  try {
    const d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null');
    return d && d.uid === uid ? d : null;
  } catch { return null; }
}
function writeDraft(d) { try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch {} }
function clearDraft() { try { sessionStorage.removeItem(DRAFT_KEY); } catch {} }

export default function WelcomeWizard({ viewer, data }) {
  const me = data.me;
  const guessed = useMemo(() => guessFromUsername(me.username, data.people), [me.username, data.people]);
  const initial = useMemo(() => ({
    uid: me.id,
    step: 0,
    display_name: me.display_name || guessed?.name || '',
    email: me.email || (/^[^@\s]+@[^@\s]+$/.test(me.username) ? me.username.toLowerCase() : ''),
    office_id: me.office_id || '',
    department_id: me.department_id || '',
    position_id: me.position_id || '',
    team_id: me.team_id || '',
    manager: me.manager && !me.manager.disabled ? me.manager : null,
    person: null,              // null = not chosen yet (the best match is offered); then an id, 'add_me' or ''
  }), [me, guessed]);
  const [d, setD] = useState(initial);
  const [restored, setRestored] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState({ avatar_v: me.avatar_v, avatar_crop: me.avatar_crop, has_src: me.has_src });
  const [done, setDone] = useState(null);
  const head = useRef(null);

  // Resume a draft after a reload (read after mount, so the server HTML and the first browser render match).
  useEffect(() => {
    const saved = readDraft(me.id);
    if (saved) setD((x) => ({ ...x, ...saved }));
    setRestored(true);
  }, [me.id]);
  useEffect(() => { if (restored && !done) writeDraft(d); }, [d, restored, done]);
  // A new step: move focus to its heading (screen readers announce it) and scroll up. Not on first load,
  // where the name field has focus.
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) { firstStep.current = false; return; }
    head.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [d.step]);

  const set = (patch) => setD((x) => ({ ...x, ...patch }));
  const step = Math.min(Math.max(0, Number(d.step) || 0), STEPS.length - 1);

  const approvedLevel = data.positions.find((p) => String(p.id) === String(me.approved_position_id ?? ''))?.level || 1;
  const officeTeams = data.teams.filter((t) => String(t.office_id) === String(d.office_id) && !t.archived);
  const linked = data.linked;
  const suggestion = useMemo(
    () => bestPersonMatch({ displayName: d.display_name, username: me.username, people: data.people }),
    [d.display_name, me.username, data.people]);
  const personValue = linked ? '' : (d.person ?? (suggestion ? String(suggestion.id) : (data.people.length ? '' : 'add_me')));

  // The team has to be in the chosen office.
  useEffect(() => {
    if (d.team_id && !officeTeams.some((t) => String(t.id) === String(d.team_id))) set({ team_id: '' });
  }, [d.office_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const checkStep = (i) => {
    if (i === 0) {
      const n = d.display_name.trim();
      if (n.length < 2 || n.length > 80) return 'Enter your full name (2-80 characters).';
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email.trim())) return 'Enter your work email.';
    }
    if (i === 1) {
      if (!d.office_id) return 'Pick your office.';
      if (!d.department_id) return 'Pick your department.';
      if (!d.position_id) return 'Pick your position.';
    }
    if (i === 2 && !linked && personValue === '' && data.people.length) return 'Pick your name, or “None of these, add me”.';
    return '';
  };
  const next = () => {
    const e = checkStep(step);
    setErr(e);
    if (!e) set({ step: step + 1 });
  };
  const back = () => { setErr(''); set({ step: Math.max(0, step - 1) }); };

  const submit = async () => {
    for (let i = 0; i < STEPS.length; i++) {
      const e = checkStep(i);
      if (e) { setErr(e); set({ step: i }); return; }
    }
    setErr('');
    setBusy(true);
    const body = {
      display_name: d.display_name.trim(),
      email: d.email.trim(),
      office_id: d.office_id,
      department_id: d.department_id,
      position_id: d.position_id,
      team_id: d.team_id || null,
      manager_id: d.manager ? d.manager.id : null,
      base: { display_name: me.display_name || '', email: me.email || '' },
    };
    if (!linked) {
      if (personValue === 'add_me') body.add_me = true;
      else if (personValue) body.person_id = personValue;
    }
    try {
      const r = await api('/api/profile', { method: 'PUT', body });
      clearDraft();
      setDone(r);
    } catch (e) {
      setErr(e.message || 'Something went wrong — please try again.');
      // Send them back to the step the problem is on.
      if (/name|email/i.test(e.message || '') && !/team/i.test(e.message || '')) set({ step: 0 });
      else if (/office|team|department|position|boss|loop|account/i.test(e.message || '')) set({ step: 1 });
      else if (/linked/i.test(e.message || '')) set({ step: 2 });
    }
    setBusy(false);
  };

  if (done) {
    const pos = data.positions.find((p) => String(p.id) === String(d.position_id));
    const person = data.people.find((p) => String(p.id) === String(personValue));
    return (
      <Frame>
        <h1 className="login-h wi-h" ref={head} tabIndex={-1}><IconCheck size={22} /> You’re all set</h1>
        <ul className="wz-summary">
          {done.pending_position && pos && <li>{pos.name}: pending admin approval. Until then you see the projects you’re assigned to. You’ll keep working normally meanwhile.</li>}
          {done.pending_link && person && <li>An admin will confirm that you’re “{person.name}”, usually within a day. Tasks already assigned to that name become yours then.</li>}
          {!done.pending_position && !done.pending_link && <li>Your profile is saved. You can change it any time in Settings.</li>}
        </ul>
        {done.warning && <div className="banner setup">{done.warning}</div>}
        <div className="wz-nav">
          <span />
          <button type="button" className="btn btn-lime" autoFocus onClick={() => { window.location.href = done.next || '/'; }}>Open TeamBoard</button>
        </div>
      </Frame>
    );
  }

  const posNote = positionNote({ positions: data.positions, positionId: d.position_id, approvedId: me.approved_position_id, approvedLevel, isAdmin: me.is_admin });
  const S = STEPS[step];
  return (
    <Frame>
      <div className="wz-progress" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
        {STEPS.map((s, i) => (
          <span key={s.key} className={`wz-dot${i === step ? ' on' : ''}${i < step ? ' done' : ''}`} aria-hidden="true" />
        ))}
        <span className="wz-count">Step {step + 1} of {STEPS.length}</span>
      </div>
      <h1 className="login-h wi-h" ref={head} tabIndex={-1}><S.Icon size={22} /> {S.label}</h1>

      {step === 0 && (
        <div className="wz-step">
          <p className="login-sub">
            {me.legacy ? 'TeamBoard now covers all seven CAGE offices. ' : ''}
            Tell us a bit about you so we can show you the right projects. About a minute.
          </p>
          <label className="atm-label" htmlFor="wz-name">Your name</label>
          <input id="wz-name" className="field" value={d.display_name} onChange={(e) => set({ display_name: e.target.value })}
            autoComplete="name" maxLength={80} placeholder="First Last" autoFocus />
          <label className="atm-label" htmlFor="wz-email">Work email</label>
          <input id="wz-email" className="field" type="email" inputMode="email" value={d.email}
            onChange={(e) => set({ email: e.target.value })} autoComplete="email" spellCheck={false} autoCapitalize="none"
            maxLength={254} placeholder={`you@${EMAIL_DOMAIN}`} />
          <p className="pf-help">Signed in as <b>{viewer.username}</b>. People see your name; your email is only shown to admins.</p>
        </div>
      )}

      {step === 1 && (
        <div className="wz-step">
          <h2 className="pf-h">Office</h2>
          <p className="pf-help">Where you usually work. This first choice applies right away; later moves go through an admin.</p>
          <OfficeCards offices={data.offices} value={d.office_id} onChange={(v) => set({ office_id: v })} />

          <h2 className="pf-h">Department</h2>
          <DeptChips departments={data.departments} value={d.department_id} onChange={(v) => set({ department_id: v })} />

          <h2 className="pf-h">Position</h2>
          <PositionGroups positions={data.positions} value={d.position_id} onChange={(v) => set({ position_id: v })}
            approvedLevel={approvedLevel} isAdmin={me.is_admin} currentIds={[me.position_id, me.approved_position_id]} />
          {posNote && <p className="pf-note">{posNote}</p>}

          <h2 className="pf-h"><label htmlFor="wz-team">Team</label></h2>
          {d.office_id ? (
            <TeamSelect id="wz-team" teams={data.teams} officeIds={[d.office_id]} value={d.team_id} onChange={(v) => set({ team_id: v || '' })}
              offices={data.offices} />
          ) : <p className="pf-help">Pick your office first.</p>}

          <h2 className="pf-h">Boss</h2>
          <p className="pf-help">Who you report to. If they haven’t signed up yet, pick “Not listed yet”.</p>
          <BossPicker bosses={data.bosses} value={d.manager} onChange={(u) => set({ manager: u })} />
        </div>
      )}

      {step === 2 && (
        <div className="wz-step">
          {linked ? (
            <p className="login-sub">You’re already on tasks as <b>{linked.name}</b>. Nothing to do here.</p>
          ) : data.people.length ? (
            <>
              <p className="login-sub">Is one of these you? These are the names already used as owners on tasks.</p>
              <PersonChoice people={data.people} value={personValue} onChange={(v) => set({ person: v })} />
              <p className="pf-help">An admin will confirm this, usually within a day. Tasks already assigned to that name become yours then.</p>
            </>
          ) : (
            <p className="login-sub">You’ll get your own name on tasks, so people can assign work to you.</p>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="wz-step">
          <p className="login-sub">Optional. Your photo shows next to your name, your votes and your posts.</p>
          <PhotoEditor me={viewer} photo={photo} onChange={(p) => setPhoto({ avatar_v: p.avatar_v, avatar_crop: p.avatar_crop, has_src: p.has_src })} />
        </div>
      )}

      {err && <div className="login-err wz-err" role="alert">{err}</div>}
      <div className="wz-nav">
        {step > 0 ? <button type="button" className="btn btn-plain" onClick={back} disabled={busy}>Back</button> : <span />}
        {step < STEPS.length - 1
          ? <button type="button" className="btn btn-lime" onClick={next}>Continue</button>
          : <button type="button" className="btn btn-lime" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Finish'}</button>}
      </div>
    </Frame>
  );
}

function Frame({ children }) {
  return (
    <div className="login-wrap wz-wrap">
      <div className="login-card wz-card">
        <div className="wz-top">
          <div className="login-brand"><span className="dot" /> TeamBoard</div>
          <button type="button" className="login-toggle wz-logout" onClick={() => logout()}>Log out</button>
        </div>
        {children}
      </div>
    </div>
  );
}
