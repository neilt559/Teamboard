'use client';
import { useEffect, useRef, useState } from 'react';
import { IconAlert, IconCheck, IconUsers } from '@/app/icons';
import { api } from '@/app/_ui/api';
import { Headshot } from '@/app/_ui/Headshot';
import DeptTag from '@/app/_ui/DeptTag';
import Modal from '@/app/_ui/Modal';
import NameLabel from '@/app/_ui/NameLabel';
import UserPicker from '@/app/_ui/UserPicker';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const same = (a, b) => a != null && b != null && String(a) === String(b);

// The team's roster (design-amendments A4): who is on the team, with a PM badge. The roster drives project
// membership: people on it join every current project of the team and every project later created in or moved
// into it ("via Team Potato" on a project's Members panel); removing someone takes away only those team
// memberships (a project where they own a task stays). Everyone who can see the team page sees the roster;
// roster editors (admins, PMs and up, project engineers in the team's office, the team's own PMs:
// roster.can_edit) add people, switch Member / PM and remove. Editors also see who picked this team in their
// profile but isn't on the roster, with an "Add" button: the profile pick alone never adds anyone to projects.
// The roster sits at the bottom of a long page, so its results and errors show here, in the section (scrolled
// into view), not in the page banner at the top.
//   roster: { my_role, can_edit, members: [{ id, name, username, avatar_v, department, position, office, role,
//             is_me, team_projects, task_projects }], picked: [person] }  (lib/queries/teams.js shapeRoster)
//   pmOnlyEditor: the viewer edits this roster only through the PM role (not an admin, L3+ or L2 in the office),
//             so switching themselves to Member or leaving ends their rights: both say so first.
export default function TeamRoster({ team, office, roster, setRoster, archived, ask, refresh, pmOnlyEditor = false }) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(null);                 // user id (or 'add-<id>') while a request runs
  const [notice, setNotice] = useState(null);
  const [err, setErr] = useState(null);
  const statusRef = useRef(null);
  const { members, picked, can_edit: canEdit } = roster;
  const editable = canEdit && !archived;
  const lockOut = `You won’t be able to change ${team.name}’s roster afterwards. An admin, a project manager or a project engineer in its office can make you PM again.`;

  // A new result or error scrolls into view (only as far as needed).
  useEffect(() => {
    if ((notice || err) && statusRef.current && typeof statusRef.current.scrollIntoView === 'function') {
      statusRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [notice, err]);

  const say = (text) => { setErr(null); setNotice(text); };
  async function run(key, fn) {
    setBusy(key);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setNotice(null);
      setErr(e?.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  // POST the picked people (the dialog's onAdd, and the picked list's "Add"). Throws for the caller to show.
  async function post(people, role = 'member') {
    const r = await api(`/api/teams/${team.id}/members`, { method: 'POST', body: { user_ids: people.map((u) => u.id), role } });
    const n = Number(r?.projects_added) || 0;
    const added = (r?.added || []).map(String);
    const who = people.filter((u) => added.includes(String(u.id))).map((u) => u.name);
    if (who.length) {
      say(`${who.join(', ')} ${who.length === 1 ? 'is' : 'are'} on ${team.name} now${n ? `, with ${plural(n, 'new project membership')}` : ''}.`);
    } else {
      say(`${people.map((u) => u.name).join(', ')} ${people.length === 1 ? 'was' : 'were'} already on ${team.name}.`);
    }
    refresh();
  }
  const add = (person) => run(`add-${person.id}`, () => post([person]));

  const setRole = async (m, role) => {
    if (m.role === role) return;
    if (m.is_me && role === 'member' && pmOnlyEditor) {
      const ok = await ask({ title: 'Switch yourself to Member?', lines: [lockOut], confirmLabel: 'Switch to Member', danger: true });
      if (!ok) return;
    }
    setRoster((r) => ({ ...r, members: r.members.map((x) => (same(x.id, m.id) ? { ...x, role } : x)) }));
    run(m.id, async () => {
      try {
        await api(`/api/teams/${team.id}/members/${m.id}`, { method: 'PATCH', body: { role } });
        say(role === 'pm' ? `${m.name} is a PM on ${team.name} now.` : `${m.name} is a member of ${team.name} now (not a PM).`);
      } finally {
        refresh();
      }
    });
  };

  const remove = async (m) => {
    const n = Number(m.team_projects) || 0;
    const kept = Number(m.task_projects) || 0;
    const them = m.is_me ? 'you' : m.name;
    const ok = await ask({
      title: m.is_me ? `Take yourself off ${team.name}?` : `Remove ${m.name} from ${team.name}?`,
      lines: [
        n
          ? `This removes ${plural(n, 'project membership')} ${them} got from the team.`
          : `${m.is_me ? 'You have' : `${m.name} has`} no project memberships from the team to remove, so no project access changes.`,
        kept
          ? `${m.is_me ? 'You keep' : 'They keep'} ${plural(kept, 'project')} from the team where ${m.is_me ? 'you' : 'they'} own tasks.`
          : null,
        'Access added by hand, from tasks, from creating a project or from before the update stays.',
        m.is_me && pmOnlyEditor ? lockOut : null,
      ],
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    setRoster((r) => ({ ...r, members: r.members.filter((x) => !same(x.id, m.id)) }));
    run(m.id, async () => {
      try {
        const r = await api(`/api/teams/${team.id}/members/${m.id}`, { method: 'DELETE' });
        const k = Number(r?.projects_removed) || 0;
        const t = Number(r?.projects_kept) || 0;
        say(`${m.name} is off ${team.name}${k ? `; ${plural(k, 'project membership')} removed` : ''}${t ? `; ${plural(t, 'project')} kept for their tasks` : ''}.`);
      } finally {
        refresh();
      }
    });
  };

  return (
    <div className="office-section office-block team-members roster" id="roster">
      <div className="section-head">
        <h2 className="section-title wi"><IconUsers size={16} /> Team members</h2>
        <span className="progress-label">{members.length === 1 ? '1 person' : `${members.length} people`}</span>
        <span className="spacer" />
        {editable && (
          <button type="button" className="btn btn-lime btn-sm" disabled={!!busy} onClick={() => setAdding(true)}>+ Add member</button>
        )}
      </div>
      <p className="roster-hint">People on the team (its roster) join its projects automatically.</p>
      <div ref={statusRef} className="roster-status">
        {err && (
          <div className="banner roster-banner" role="alert">
            <IconAlert size={16} /><span>{err}</span><span className="spacer" />
            <button type="button" className="btn btn-plain btn-sm" onClick={() => setErr(null)}>Dismiss</button>
          </div>
        )}
        {notice && !err && (
          <div className="banner setup roster-banner" role="status">
            <IconCheck size={16} /><span>{notice}</span><span className="spacer" />
            <button type="button" className="btn btn-plain btn-sm" onClick={() => setNotice(null)}>Dismiss</button>
          </div>
        )}
      </div>
      {members.length === 0 ? (
        <p className="ov-empty">{editable ? 'Nobody is on this team yet. Use “+ Add member”.' : 'Nobody is on this team yet.'}</p>
      ) : (
        <ul className="member-list roster-list">
          {members.map((m) => (
            <li key={m.id} className="member-row roster-row">
              <Headshot user={m} size={34} />
              <div className="member-main">
                <div className="roster-name">
                  <NameLabel user={m} link />
                  {m.role === 'pm' && <span className="acct-tag pm" title="Project manager on this team">PM</span>}
                  {m.is_me && <span className="member-you">you</span>}
                </div>
                <div className="member-meta">
                  {m.department && <DeptTag dept={m.department} />}
                  {m.position && <span>{m.position}</span>}
                  {m.office && <span>{m.office.name}</span>}
                </div>
              </div>
              {editable && (
                <div className="roster-actions">
                  <div className="roster-seg" role="group" aria-label={`Role of ${m.name} on ${team.name}`}>
                    {[['member', 'Member'], ['pm', 'PM']].map(([k, label]) => (
                      <button key={k} type="button" className={m.role === k ? 'on' : ''} aria-pressed={m.role === k}
                        disabled={!!busy} onClick={() => setRole(m, k)}>{label}</button>
                    ))}
                  </div>
                  <button type="button" className="btn btn-plain btn-xs member-remove" disabled={!!busy} onClick={() => remove(m)}>
                    Remove
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && picked.length > 0 && (
        <div className="roster-picked">
          <h3 className="roster-picked-h">Picked this team in their profile but not on the roster</h3>
          <ul className="roster-picked-list">
            {picked.map((p) => (
              <li key={p.id} className="roster-picked-row">
                <Headshot user={p} size={26} />
                <span className="roster-picked-main">
                  <NameLabel user={p} link />
                  {p.office && <span className="roster-picked-meta">{p.office.name}</span>}
                </span>
                <button type="button" className="btn btn-plain btn-xs roster-picked-add" disabled={!!busy}
                  onClick={() => add(p)} aria-label={`Add ${p.name} to ${team.name}`}>
                  {busy === `add-${p.id}` ? 'Adding…' : 'Add'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {adding && (
        <AddMembers
          team={team}
          office={office}
          memberIds={members.map((m) => String(m.id))}
          onAdd={post}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}

// "+ Add member": the shared people picker, people in the team's office first (anyone can be picked), and the
// role they join with. Adding someone gives them the team's current projects right away.
function AddMembers({ team, office, memberIds, onAdd, onClose }) {
  const [picked, setPicked] = useState([]);
  const [role, setRole] = useState('member');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const outside = picked.filter((u) => office && String(u.office_id ?? '') !== String(office.id));

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onAdd(picked, role);
      onClose();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Add people to ${team.name}`}
      icon={<IconUsers size={20} />}
      onClose={onClose}
      className="add-people-modal roster-add-modal"
      actions={(
        <>
          <button type="button" className="btn btn-plain" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-ink" disabled={!picked.length || busy} onClick={submit}>
            {busy ? 'Adding…' : picked.length ? `Add ${picked.length} ${picked.length === 1 ? 'person' : 'people'}` : 'Add'}
          </button>
        </>
      )}
    >
      <p className="roster-add-note">They join every current project of {team.name} now, and every project added to it later.</p>
      <div className="roster-add-role">
        <span className="roster-add-label" id="roster-add-role">Role</span>
        <div className="roster-seg" role="group" aria-labelledby="roster-add-role">
          {[['member', 'Member'], ['pm', 'PM']].map(([k, label]) => (
            <button key={k} type="button" className={role === k ? 'on' : ''} aria-pressed={role === k} disabled={busy}
              onClick={() => setRole(k)}>{label}</button>
          ))}
        </div>
      </div>
      {/* The office warning and errors sit above the picker: on a phone the list fills the dialog and Cancel / Add
          are pinned to its bottom edge, so anything below the list would be out of sight. */}
      {outside.length > 0 && (
        <p className="pick-warn" role="status">
          <IconAlert size={14} />
          <span>
            {outside.map((u) => u.name).join(', ')} {outside.length === 1 ? 'isn’t' : 'aren’t'} in the {office.name} office. They’ll still join this team’s projects.
          </span>
        </p>
      )}
      {err && <p className="pm-error" role="alert">{err}</p>}
      <UserPicker
        multiple
        autoFocus
        defaultOpen
        officeId={office?.id ?? null}
        exclude={memberIds}
        value={picked}
        onChange={setPicked}
        limit={50}
        placeholder={office ? `Search by name (${office.name} first)` : 'Search by name or username'}
        disabled={busy}
      />
    </Modal>
  );
}
