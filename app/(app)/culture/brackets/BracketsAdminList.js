'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IconTrophy, IconRestore, IconArchive, IconTrash } from '@/app/icons';
import { api } from '@/app/_ui/api';
import ConfirmDialog from '@/app/_ui/ConfirmDialog';
import { fmtDay } from './format';

// The client half of /admin's Brackets section (app/(app)/admin/_sections/BracketsAdmin.js).
// data = listBracketsForAdmin(): { deleted, archived, live }.
export default function BracketsAdminList({ data, tz }) {
  const router = useRouter();
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);           // { kind: 'ok' | 'err', text }
  const [confirm, setConfirm] = useState(null);
  const { deleted = [], archived = [], live = null } = data || {};

  const run = async (b, body, okText) => {
    setBusy(b.id);
    setMsg(null);
    try {
      const r = await api(`/api/brackets/${b.id}`, { method: 'PATCH', body });
      setMsg({ kind: 'ok', text: typeof okText === 'function' ? okText(r) : okText });
      router.refresh();
    } catch (e) {
      setMsg({ kind: 'err', text: e.message });
    } finally {
      setBusy(null);
    }
  };
  const restore = (b) => run(b, { deleted: false }, (r) => (r.archived
    ? `Restored “${b.name}” to Past brackets.`
    : `Restored “${b.name}”.`));
  const unarchive = (b) => setConfirm({
    title: `Make “${b.name}” the live bracket again?`,
    lines: ['It comes back as the current bracket, with its votes and results as they were.'],
    confirmLabel: 'Un-archive',
    onConfirm: () => run(b, { archived: false }, `“${b.name}” is the live bracket again.`),
  });

  const row = (b, action) => (
    <div key={b.id} className="ba-row">
      <div className="ba-main">
        <Link className="ba-name" href={`/culture/brackets/${b.id}`} prefetch={false}>{b.name}</Link>
        <span className="ba-meta">
          {b.champion_name ? <><IconTrophy size={12} /> {b.champion_name}</> : <i>No champion</i>}
          {' · '}{fmtDay(b.completed_at || b.created_at, tz)}
          {b.deleted_at && <> · deleted {fmtDay(b.deleted_at, tz)}{b.deleted_by_name ? ` by ${b.deleted_by_name}` : ''}</>}
          {b.crown_policy === 'anyone' ? ' · open to everyone' : ' · organizers'}
        </span>
      </div>
      {action}
    </div>
  );

  return (
    <section className="ba-section" aria-labelledby="ba-h">
      <h2 id="ba-h" className="section-title wi"><IconTrophy size={16} /> Brackets</h2>
      <p className="ba-sub">
        Deleted brackets can be restored, and archived ones made live again.
        {live ? <> Live now: <b>{live.name}</b>.</> : ' No bracket is live right now.'}
      </p>
      {msg && <div className={msg.kind === 'err' ? 'bk-err' : 'ba-ok'} role="status">{msg.text}</div>}
      <h3 className="ba-h3 wi"><IconTrash size={14} /> Deleted ({deleted.length})</h3>
      {deleted.length ? deleted.map((b) => row(b, (
        <button type="button" className="btn btn-plain btn-sm wi" disabled={busy === b.id} onClick={() => restore(b)}>
          <IconRestore size={13} /> {busy === b.id ? 'Restoring…' : 'Restore'}
        </button>
      ))) : <p className="ba-empty">Nothing deleted.</p>}
      <h3 className="ba-h3 wi"><IconArchive size={14} /> Archived ({archived.length})</h3>
      {archived.length ? archived.map((b) => row(b, (
        <button
          type="button"
          className="btn btn-plain btn-sm wi"
          disabled={busy === b.id || !!live}
          title={live ? `“${live.name}” is live. Only one bracket can be live at a time.` : undefined}
          onClick={() => unarchive(b)}
        >
          <IconRestore size={13} /> {busy === b.id ? 'Working…' : 'Un-archive'}
        </button>
      ))) : <p className="ba-empty">No past brackets.</p>}
      {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}
    </section>
  );
}
