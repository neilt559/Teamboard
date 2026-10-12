'use client';
import { useState } from 'react';
import { IconAlert, IconUsers } from '@/app/icons';
import { Headshot } from '@/app/_ui/Headshot';
import Modal from '@/app/_ui/Modal';
import NameLabel from '@/app/_ui/NameLabel';
import UserPicker from '@/app/_ui/UserPicker';

// Members panel (design §6): who is on this project. Anyone who can see the project can add people ("every
// position can add others to projects they're on"); removal is soft and allowed for yourself (Leave), the
// person who added them, L2+ and admins (the loader computes can_remove with lib/policy canRemoveMember).
// People also see projects through their office or position; this list is only explicit membership.

function sourceText(m) {
  switch (m.source) {
    case 'creator': return 'Created the project';
    case 'task': return 'Owns a task here';
    case 'manual': return m.added_by_name ? `Added by ${m.added_by_name}` : 'Added';
    case 'legacy': return 'Had access before the update';
    case 'admin': return 'Team access (admin)';
    default: return 'Member';
  }
}

export default function MembersPanel({ project, members, ro, actions, ask }) {
  const [picking, setPicking] = useState(false);
  const n = members.length;

  const remove = async (m) => {
    const ok = m.is_me
      ? await ask({
        title: 'Leave this project?',
        lines: ['You’ll lose access unless your office or position gives it to you.'],
        confirmLabel: 'Leave project', danger: true,
      })
      : await ask({
        title: `Remove ${m.name} from this project?`,
        lines: m.open_tasks > 0
          ? [`They still own ${m.open_tasks} open task${m.open_tasks === 1 ? '' : 's'} here and will no longer see them.`]
          : [],
        confirmLabel: 'Remove', danger: true,
      });
    if (ok) actions.removeMember(m);
  };

  return (
    <div className="info-panel members-panel" id="members">
      <div className="info-head">
        <label className="notes-label"><IconUsers size={14} /> Members <span>· {n} {n === 1 ? 'person is' : 'people are'} on this project</span></label>
        {!ro && <button type="button" className="btn btn-lime btn-sm" onClick={() => setPicking(true)}>+ Add people</button>}
      </div>
      {n === 0 ? (
        <p className="info-empty">Nobody has been added yet. People in this office and PMs can still open it.</p>
      ) : (
        <ul className="member-list">
          {members.map((m) => (
            <li key={m.user_id} className="member-row">
              <Headshot user={{ id: m.user_id, username: m.username, name: m.name, avatar_v: m.avatar_v }} size={32} />
              <div className="member-main">
                <NameLabel user={{ id: m.user_id, username: m.username, name: m.name, identity_verified: m.identity_verified, listed: m.listed }} link />
                {m.is_me && <span className="member-you">you</span>}
                <div className="member-meta">
                  {m.department && <span className="member-dept" style={{ '--dc': m.department_color || '#5B5859' }}>{m.department}</span>}
                  {m.office_name && <span>{m.office_name}</span>}
                  <span>{sourceText(m)}</span>
                </div>
              </div>
              {m.can_remove && !ro && (
                <button type="button" className="btn btn-plain btn-xs member-remove" onClick={() => remove(m)}>
                  {m.is_me ? 'Leave' : 'Remove'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="info-hint">Anyone on a project can add people to it. People also see projects through their office or their position.</p>
      {picking && (
        <AddPeople
          projectId={project.id}
          officeId={project.office_id}
          officeName={project.office_name}
          memberIds={members.map((m) => String(m.user_id))}
          onAdd={actions.addMembers}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

// Search people and add several at once with the shared picker (design §6: UserPicker over
// /api/users/search?project_id=, which lists public fields only and orders members first only for people who
// can see the project). Current members are left out. Someone outside the project's office gets the design's
// warning: "They'll see this project only."
function AddPeople({ projectId, officeId, officeName, memberIds, onAdd, onClose }) {
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const outside = picked.filter((u) => officeId == null || String(u.office_id) !== String(officeId));
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onAdd(picked.map((u) => u.id));
      onClose();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Add people to this project"
      icon={<IconUsers size={20} />}
      onClose={onClose}
      className="add-people-modal"
      actions={(
        <>
          <button type="button" className="btn btn-plain" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-ink" disabled={!picked.length || busy} onClick={submit}>
            {busy ? 'Adding…' : picked.length ? `Add ${picked.length} ${picked.length === 1 ? 'person' : 'people'}` : 'Add'}
          </button>
        </>
      )}
    >
      <UserPicker
        multiple
        autoFocus
        defaultOpen
        projectId={projectId}
        exclude={memberIds}
        value={picked}
        onChange={setPicked}
        limit={50}
        placeholder="Search by name or username"
        disabled={busy}
      />
      {outside.length > 0 && (
        <p className="pick-warn" role="status">
          <IconAlert size={14} />
          <span>
            {outside.map((u) => u.name).join(', ')} {outside.length === 1 ? 'isn’t' : 'aren’t'} in {officeName ? `the ${officeName} office` : 'this project’s office'}. They’ll see this project only.
          </span>
        </p>
      )}
      {err && <p className="pm-error" role="alert">{err}</p>}
    </Modal>
  );
}
