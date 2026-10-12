'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ConflictError } from '@/app/_ui/api';
import { ColorControl } from '@/app/_ui/ColorControl';
import { useConfirm } from '@/app/_ui/ConfirmDialog';
import { IconTag, IconCheck, IconAlert, IconUsers } from '@/app/icons';
import { PersonChoice } from '@/app/welcome/fields';
import { bestPersonMatch } from '@/app/welcome/match';

// Settings > Name on tasks (design §2.1, §5.3, §5.4). Task owners are "names on tasks" (the people table), kept
// separate from accounts; an admin links the two.
//   Linked: my name's spelling and color (PATCH /api/people/:id; the linked person or an admin may).
//   Waiting: "Waiting for admin approval" with Withdraw.
//   Neither: "Link me to an existing name" (a person_link request) or "None of these, add me" (my own name),
//   both through PUT /api/profile, as in the wizard. Linking never renames anything or moves tasks.
export default function NameOnTasks({ viewer, data }) {
  const router = useRouter();
  const [confirmUI, ask] = useConfirm();
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const linked = data.linked;
  const pending = data.requests.person_link;
  const declined = (data.requests.recent || []).filter((r) => r.kind === 'person_link' && r.status === 'declined');

  // ---- my linked name
  const [name, setName] = useState(linked?.name || '');
  const [nameBase, setNameBase] = useState(linked?.name || '');
  const [color, setColor] = useState(linked?.color || '#5B5859');
  const [conflict, setConflict] = useState(null);
  useEffect(() => {
    if (linked && name === nameBase) { setName(linked.name); setNameBase(linked.name); }
    if (linked) setColor(linked.color);
  }, [linked?.name, linked?.color]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveName = async (base = nameBase) => {
    const v = name.trim();
    setErr(''); setOk(''); setConflict(null);
    if (!v) { setErr('A name can’t be blank.'); return; }
    if (v === nameBase) return;
    try {
      const r = await api(`/api/people/${linked.id}`, { method: 'PATCH', body: { name: v, base: { name: base } } });
      const stored = r.row?.name ?? r.name ?? v;
      setName(stored); setNameBase(stored);
      setOk('Saved. Tasks show the new spelling.');
      router.refresh();
    } catch (e) {
      if (e instanceof ConflictError) setConflict(e.current?.name ?? '');
      else setErr(e.message);
    }
  };
  const saveColor = async (c) => {
    setErr(''); setOk('');
    setColor(c);
    try { await api(`/api/people/${linked.id}`, { method: 'PATCH', body: { color: c } }); setOk('Color saved.'); router.refresh(); }
    catch (e) { setErr(e.message); setColor(linked.color); }
  };

  // ---- link me / add me
  const suggestion = useMemo(
    () => bestPersonMatch({ displayName: viewer.name, username: viewer.username, people: data.people }),
    [viewer.name, viewer.username, data.people]);
  const [choice, setChoice] = useState('');
  const pick = choice || (suggestion ? String(suggestion.id) : '');
  const [busy, setBusy] = useState(false);
  const request = async () => {
    if (!pick) { setErr('Pick your name, or “None of these, add me”.'); return; }
    setErr(''); setOk(''); setBusy(true);
    try {
      await api('/api/profile', { method: 'PUT', body: pick === 'add_me' ? { add_me: true } : { person_id: pick } });
      setOk(pick === 'add_me' ? 'Done. You have your own name on tasks now.' : 'Sent. An admin will confirm it, usually within a day.');
      router.refresh();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const withdraw = async () => {
    if (!(await ask({ title: `Withdraw your request to be “${pending.person_name || 'that name'}”?`, confirmLabel: 'Withdraw' }))) return;
    setErr('');
    try { await api(`/api/profile/requests/${pending.id}`, { method: 'DELETE' }); router.refresh(); }
    catch (e) { setErr(e.message); }
  };

  return (
    <div className="pf-form">
      {confirmUI}
      <div className="pf-section">
        <h2 className="pf-h wi"><IconTag size={17} /> Your name on tasks</h2>
        <p className="pf-help">Tasks are assigned to names. Linking your account to your name lets TeamBoard show your tasks in My work and adds you to the projects where you own tasks.</p>

        {linked && (
          <div className="nt-linked">
            <span className="pf-person-dot nt-dot" style={{ background: color }} aria-hidden="true" />
            <div className="nt-fields">
              <label className="atm-label" htmlFor="nt-name">Name as it appears on tasks</label>
              <div className="pf-row">
                <input id="nt-name" className="field" value={name} maxLength={120}
                  onChange={(e) => { setName(e.target.value); setOk(''); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveName(); } }} />
                <button type="button" className="btn btn-ink btn-sm" onClick={() => saveName()} disabled={name.trim() === nameBase}>Save</button>
              </div>
              <label className="atm-label">Color</label>
              <ColorControl value={color} onChange={saveColor} />
              {linked.archived && <p className="pf-note">An admin archived this name, so it isn’t offered as an owner right now.</p>}
            </div>
          </div>
        )}

        {conflict != null && (
          <div className="conflict" role="alert">
            <div className="conflict-msg"><IconAlert size={15} /> Someone changed this name while you were editing. It’s now “{conflict}”.</div>
            <div className="conflict-actions">
              <button type="button" className="btn btn-ink btn-sm" onClick={() => { setNameBase(conflict); saveName(conflict); }}>Keep mine</button>
              <button type="button" className="btn btn-plain btn-sm" onClick={() => { setName(conflict); setNameBase(conflict); setConflict(null); }}>Use theirs</button>
            </div>
          </div>
        )}

        {!linked && pending && (
          <div className="pf-pending">
            <span>Waiting for admin approval: you’re <b>“{pending.person_name || 'that name'}”</b>. Tasks already assigned to that name become yours then.</span>
            <button type="button" className="btn btn-plain btn-sm" onClick={withdraw}>Withdraw</button>
          </div>
        )}

        {!linked && !pending && (
          <>
            {declined.slice(0, 1).map((r) => (
              <p key={r.id} className="pf-note">An admin declined your request to be “{r.person_name || 'that name'}”{r.decision_note ? `: “${r.decision_note}”` : '.'}</p>
            ))}
            <h3 className="pf-h3">Link me to an existing name</h3>
            <PersonChoice people={data.people} value={pick} onChange={setChoice} />
            <p className="pf-help">An admin will confirm this, usually within a day. Tasks already assigned to that name become yours then.</p>
            <button type="button" className="btn btn-ink" onClick={request} disabled={busy || !pick}>
              {busy ? 'Sending…' : pick === 'add_me' ? 'Add my name' : 'Ask to link this name'}
            </button>
          </>
        )}

        {ok && <p className="pf-ok wi" role="status"><IconCheck size={14} /> {ok}</p>}
        {err && <div className="bk-err" role="alert">{err}</div>}
      </div>

      <div className="pf-section">
        <h2 className="pf-h wi"><IconUsers size={17} /> Everyone’s names on tasks</h2>
        <p className="pf-help">Add a contractor or a group (like “Team Beaver”) as a task owner, or fix a spelling.</p>
        <Link href="/people/names" prefetch={false} className="btn btn-plain">Manage names on tasks</Link>
      </div>
    </div>
  );
}
