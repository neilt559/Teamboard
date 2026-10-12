'use client';
import { useState } from 'react';
import Link from 'next/link';
import Modal from '@/app/_ui/Modal';

// "Add task" from a Team overview card (inventory §1.4 AddTaskModal, design §2.3): task name + who's
// responsible. Same behavior as before: Enter submits, a blank name is silently ignored, and the modal closes
// first while the task is created. New: names and groups are listed separately, and "Manage names…" opens
// /people/names, where anyone can add a name (a contractor, "Team X") to pick here.
export default function AddTaskModal({ people, projectName, onCreate, onClose }) {
  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  const active = (people || []).filter((p) => !p.archived);
  const persons = active.filter((p) => p.kind !== 'group');
  const groups = active.filter((p) => p.kind === 'group');
  const submit = () => { const n = name.trim(); if (!n) return; onCreate(n, owner || null); };
  return (
    <Modal
      title="Add task"
      className="add-task-modal"
      onClose={onClose}
      actions={(
        <>
          <button type="button" className="btn btn-plain" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-ink" onClick={submit}>Add task</button>
        </>
      )}
    >
      {projectName && <p className="atm-project">{projectName}</p>}
      <label className="atm-label" htmlFor="atm-name">Task name</label>
      <input
        id="atm-name"
        className="field"
        autoFocus
        placeholder="What needs doing?"
        value={name}
        maxLength={500}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
      />
      <label className="atm-label" htmlFor="atm-owner">Who’s responsible?</label>
      <select id="atm-owner" className="field" value={owner} onChange={(e) => setOwner(e.target.value)}>
        <option value="">Unassigned</option>
        {persons.length > 0 && (
          <optgroup label="People">
            {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </optgroup>
        )}
        {groups.length > 0 && (
          <optgroup label="Groups">
            {groups.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </optgroup>
        )}
      </select>
      <Link href="/people/names" prefetch={false} className="atm-manage">Manage names…</Link>
    </Modal>
  );
}
