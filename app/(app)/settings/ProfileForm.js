'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ConflictError } from '@/app/_ui/api';
import { IconCheck, IconAlert, IconShield } from '@/app/icons';
import { useConfirm } from '@/app/_ui/ConfirmDialog';
import {
  OfficeCards, DeptChips, PositionGroups, TeamSelect, BossPicker, RosterLine, positionNote,
} from '@/app/welcome/fields';

// Settings > Profile (design §5.3): the wizard's form, saved with the same PUT /api/profile.
// Name, email, department, team and boss save at once; a different office becomes a request ("Waiting for
// admin approval: move to Lisle", with Withdraw); a position above my approved level waits for an admin.
// Only changed fields are sent. Name and email carry the values the form started from (base), so an admin's
// edit made meanwhile is reported (409) instead of silently overwritten.

const fromData = (data) => ({
  display_name: data.me.display_name || '',
  email: data.me.email || '',
  office_id: data.me.office_id || '',
  team_id: data.me.team_id || '',
  department_id: data.me.department_id || '',
  position_id: data.me.position_id || '',
  manager: data.me.manager && !data.me.manager.disabled ? data.me.manager : null,
});
const same = (a, b) => String(a ?? '') === String(b ?? '');

export default function ProfileForm({ viewer, data }) {
  const router = useRouter();
  const start = useMemo(() => fromData(data), [data]);
  const [base, setBase] = useState(start);          // frozen while editing (§7.4 draft editors)
  const [f, setF] = useState(start);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [conflict, setConflict] = useState(null);
  const [confirmUI, ask] = useConfirm();
  const me = data.me;

  const dirty = Object.keys(f).some((k) => (k === 'manager' ? !same(f.manager?.id, base.manager?.id) : !same(f[k], base[k])));
  // New server data (after a save or a focus refresh) is adopted only while nothing is being edited.
  useEffect(() => { if (!dirty) { setBase(start); setF(start); } }, [start]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch) => { setOk(''); setErr(''); setF((x) => ({ ...x, ...patch })); };
  const myOffice = me.office_id;
  const officeChanging = !!f.office_id && !same(f.office_id, myOffice);
  const teamOffices = officeChanging ? [f.office_id] : (viewer.office_ids?.length ? viewer.office_ids : [myOffice]);
  const approvedLevel = data.positions.find((p) => same(p.id, me.approved_position_id))?.level || 1;
  const pendingOffice = data.requests.office_change;
  const officeName = (id) => data.offices.find((o) => same(o.id, id))?.name || 'another office';
  const posName = (id) => data.positions.find((p) => same(p.id, id))?.name || '';

  // Picking another office: the team list switches to that office (the team goes into the request).
  useEffect(() => {
    if (f.team_id && !data.teams.some((t) => same(t.id, f.team_id) && teamOffices.map(String).includes(String(t.office_id)))) {
      setF((x) => ({ ...x, team_id: officeChanging ? '' : base.team_id }));
    }
  }, [f.office_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (overrideBase) => {
    setErr(''); setOk(''); setConflict(null);
    const b = {};
    if (!same(f.display_name, base.display_name)) b.display_name = f.display_name.trim();
    if (!same(f.email, base.email)) b.email = f.email.trim();
    if (!same(f.office_id, base.office_id)) b.office_id = f.office_id;
    if (!same(f.team_id, base.team_id) || (officeChanging && f.team_id)) b.team_id = f.team_id || null;
    if (!same(f.department_id, base.department_id)) b.department_id = f.department_id;
    if (!same(f.position_id, base.position_id)) b.position_id = f.position_id;
    if (!same(f.manager?.id, base.manager?.id)) b.manager_id = f.manager ? f.manager.id : null;
    if (!Object.keys(b).length) return;
    const bb = overrideBase || base;
    b.base = { display_name: bb.display_name, email: bb.email };
    if (officeChanging && !(await ask({
      title: `Ask to move to ${officeName(f.office_id)}?`,
      lines: [`An admin approves office moves. Until then you stay in ${officeName(myOffice)} and see what you see today.`],
      confirmLabel: 'Send request',
    }))) return;
    setBusy(true);
    try {
      const r = await api('/api/profile', { method: 'PUT', body: b });
      const notes = [];
      if (r.pending_office && b.office_id) notes.push(`Office move sent to an admin: ${officeName(b.office_id)}.`);
      if (r.pending_position && b.position_id) notes.push(`${posName(b.position_id)}: pending admin approval.`);
      setOk(['Saved.', ...notes].join(' '));
      if (r.warning) setErr(r.warning);
      // The office stays put until approved; the rest is now the new baseline.
      const nextBase = { ...f, office_id: myOffice || '', team_id: b.office_id ? base.team_id : f.team_id };
      setBase(nextBase);
      setF(nextBase);
      router.refresh();
    } catch (e) {
      if (e instanceof ConflictError || e?.status === 409 && e?.json?.error === 'conflict') {
        setConflict(e.current || e.json?.current || null);
      } else {
        setErr(e.message || 'Something went wrong — please try again.');
      }
    }
    setBusy(false);
  };

  const withdraw = async (req) => {
    if (!(await ask({ title: `Withdraw your request to move to ${req.office_name || 'that office'}?`, confirmLabel: 'Withdraw' }))) return;
    setErr('');
    try { await api(`/api/profile/requests/${req.id}`, { method: 'DELETE' }); router.refresh(); }
    catch (e) { setErr(e.message); }
  };

  const posNote = positionNote({ positions: data.positions, positionId: f.position_id, approvedId: me.approved_position_id, approvedLevel, isAdmin: me.is_admin });
  const declined = (data.requests.recent || []).filter((r) => r.kind === 'office_change' && r.status === 'declined');

  return (
    <form className="pf-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
      {confirmUI}
      <div className="pf-section">
        <h2 className="pf-h">About you</h2>
        <div className="pf-grid">
          <div>
            <label className="atm-label" htmlFor="pf-name">Name</label>
            <input id="pf-name" className="field" value={f.display_name} maxLength={80} autoComplete="name"
              onChange={(e) => set({ display_name: e.target.value })} />
          </div>
          <div>
            <label className="atm-label" htmlFor="pf-email">Work email</label>
            <input id="pf-email" className="field" type="email" inputMode="email" value={f.email} maxLength={254}
              autoComplete="email" spellCheck={false} autoCapitalize="none" onChange={(e) => set({ email: e.target.value })} />
          </div>
        </div>
        {/* One text item next to the icon: the row is a flex box, so loose text and <b> would become columns. */}
        <p className="pf-help wi">
          <IconShield size={14} />
          <span>
            {me.identity_verified
              ? 'An admin has verified your name and email. Changing either one asks them to check again.'
              : 'An admin hasn’t verified your name and email yet. Until then people see “unverified” next to your name.'}
            {' '}Signed in as <b>{me.username}</b>.
          </span>
        </p>
      </div>

      <div className="pf-section">
        <h2 className="pf-h">Office</h2>
        {pendingOffice && (
          <div className="pf-pending">
            <span>Waiting for admin approval: move to <b>{pendingOffice.office_name || 'another office'}</b>
              {pendingOffice.team_name ? <> (team {pendingOffice.team_name})</> : null}.</span>
            <button type="button" className="btn btn-plain btn-sm" onClick={() => withdraw(pendingOffice)}>Withdraw</button>
          </div>
        )}
        {declined.map((r) => (
          <p key={r.id} className="pf-note">An admin declined your move to {r.office_name || 'that office'}{r.decision_note ? `: “${r.decision_note}”` : '.'}</p>
        ))}
        <OfficeCards offices={data.offices} value={f.office_id} currentId={myOffice} onChange={(v) => set({ office_id: v })} />
        {officeChanging && <p className="pf-note">Moving offices needs an admin. Saving sends the request; until it’s approved you stay in {officeName(myOffice)}.</p>}
      </div>

      <div className="pf-section">
        <h2 className="pf-h"><label htmlFor="pf-team">Team</label></h2>
        <p className="pf-help">Your home team. Your team’s PM or an admin adds you to the team roster. The roster is what adds you to the team’s projects.</p>
        <TeamSelect id="pf-team" teams={data.teams} officeIds={teamOffices} offices={data.offices} value={f.team_id}
          currentId={officeChanging ? null : base.team_id} onChange={(v) => set({ team_id: v || '' })} />
        <RosterLine rosters={data.rosters} />
      </div>

      <div className="pf-section">
        <h2 className="pf-h">Department</h2>
        <DeptChips departments={data.departments} value={f.department_id} currentId={base.department_id} onChange={(v) => set({ department_id: v })} />
      </div>

      <div className="pf-section">
        <h2 className="pf-h">Position</h2>
        {me.position_pending && me.position_id && (
          <p className="pf-pending-line"><span className="acct-tag pending">Pending</span> {posName(me.position_id)} is waiting for an admin.
            {me.approved_position_id ? <> Approved: {posName(me.approved_position_id)}.</> : null} Pick your approved position again to cancel the request.</p>
        )}
        <PositionGroups positions={data.positions} value={f.position_id} onChange={(v) => set({ position_id: v })}
          approvedLevel={approvedLevel} isAdmin={me.is_admin} currentIds={[me.position_id, me.approved_position_id]} />
        {posNote && !same(f.position_id, base.position_id) && <p className="pf-note">{posNote}</p>}
      </div>

      <div className="pf-section">
        <h2 className="pf-h">Boss</h2>
        <BossPicker bosses={data.bosses} value={f.manager} onChange={(u) => set({ manager: u })} />
      </div>

      {conflict && (
        <div className="conflict" role="alert">
          <div className="conflict-msg"><IconAlert size={15} /> Your name or email was changed somewhere else while you were editing.</div>
          <dl className="conflict-fields">
            <dt>Name now</dt><dd>{conflict.display_name || '(blank)'}</dd>
            <dt>Email now</dt><dd>{conflict.email || '(blank)'}</dd>
          </dl>
          <div className="conflict-actions">
            <button type="button" className="btn btn-ink btn-sm" onClick={() => {
              const nb = { ...base, display_name: conflict.display_name || '', email: conflict.email || '' };
              setBase(nb); setConflict(null); save(nb);
            }}>Overwrite with mine</button>
            <button type="button" className="btn btn-plain btn-sm" onClick={() => {
              const nb = { ...base, display_name: conflict.display_name || '', email: conflict.email || '' };
              setBase(nb); setF((x) => ({ ...x, display_name: nb.display_name, email: nb.email })); setConflict(null);
            }}>Discard mine</button>
          </div>
        </div>
      )}
      {err && <div className="bk-err" role="alert">{err}</div>}
      <div className="pf-actions">
        {ok && <span className="pf-ok wi" role="status"><IconCheck size={15} /> {ok}</span>}
        <span className="spacer" />
        <button type="button" className="btn btn-plain" disabled={!dirty || busy} onClick={() => { setF(base); setErr(''); setOk(''); setConflict(null); }}>Undo changes</button>
        <button type="submit" className="btn btn-ink" disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save profile'}</button>
      </div>
    </form>
  );
}
