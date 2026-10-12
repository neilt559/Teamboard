'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/app/_ui/api';
import useServerState from '@/app/_ui/useServerState';
import { useRefreshOnFocus } from '@/app/_ui/useRefresh';
import { IconCheck, IconPencil, IconUser, IconBuilding, IconTag, IconAlert } from '@/app/icons';
import { initials } from '@/app/_ui/tasks';
import { fmtDay, DeptTag, useAct, PositionOptions } from '../_parts/kit';

// The approval queue (design §5.5): one card per item, oldest first, each with what approving would do.
// Approving anything else for someone also verifies their name and email unless "Name and email look right"
// is unticked. Every decision only applies to the state shown (the server answers 409 otherwise), and the
// list refreshes after each one.

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'position', label: 'Positions' },
  { key: 'office_change', label: 'Office changes' },
  { key: 'person_link', label: 'Name links' },
  { key: 'identity', label: 'Verify' },
];
const TITLE = {
  position: 'Position request', office_change: 'Office change', person_link: 'Name link', identity: 'Verify name and email',
};

function Who({ u, tz }) {
  return (
    <div className="apq-who">
      <div className="apq-name">
        <b>{u.name}</b>
        {u.name !== u.username && <span className="muted">@{u.username}</span>}
        {u.test_account && <span className="acct-tag test" title="Left over from testing the site">test account</span>}
        {u.legacy_user && <span className="acct-tag you" title="Had an account before the company update">legacy user</span>}
        {u.identity_verified
          ? <span className="acct-tag admin">verified</span>
          : <span className="unverified-chip" title="An admin hasn’t verified this account’s name and email yet">unverified</span>}
      </div>
      <div className="apq-tags">
        <span>{u.email || <span className="muted">no email</span>}</span>
        {u.office && <span className="wi"><IconBuilding size={13} /> {u.office}</span>}
        {u.department && <DeptTag name={u.department} color={u.department_color} />}
        {u.team && <span className="wi"><IconUser size={13} /> {u.team}</span>}
        {u.boss && <span>Reports to {u.boss}</span>}
        <span className="muted">Signed up {fmtDay(u.signed_up_at, tz)}</span>
      </div>
    </div>
  );
}

function What({ it }) {
  if (it.type === 'position') {
    return (
      <p className="apq-what">
        Asks to be <b>{it.requested.name}</b> (level {it.requested.level}). Approved now:{' '}
        {it.approved ? <b>{it.approved.name}</b> : <span className="muted">none (sees projects they’re added to)</span>}.
      </p>
    );
  }
  if (it.type === 'office_change') {
    return (
      <p className="apq-what">
        Wants to move from <b>{it.from_office || 'no office'}</b> to <b>{it.to_office || 'a deleted office'}</b>
        {it.to_team ? <>, team <b>{it.to_team}</b></> : null}.
      </p>
    );
  }
  if (it.type === 'person_link') {
    return (
      <p className="apq-what wi">
        Says they are{' '}
        <span className="avatar xs" style={{ background: it.person_color || '#5B5859' }}>{initials(it.person || '')}</span>
        <b>{it.person || 'a deleted name'}</b> on tasks.
      </p>
    );
  }
  return <p className="apq-what">Display name <b>{it.user.name}</b>, email <b>{it.user.email || 'none'}</b>.</p>;
}

function ApprovalCard({ it, positions, onDone, tz }) {
  const router = useRouter();
  const u = it.user;
  const [verify, setVerify] = useState(true);
  const [mode, setMode] = useState(null);                // 'set' | 'decline'
  const [pos, setPos] = useState(it.requested?.id || '');
  const [note, setNote] = useState('');
  const { busy, err, run } = useAct();
  const showVerify = it.type !== 'identity' && !u.identity_verified;
  const v = showVerify && verify;

  const act = (key, fn) => run(key, async () => {
    try {
      const r = await fn();
      onDone(it.key, r?.message || null);
    } catch (e) {
      if (e?.status === 409 || e?.status === 404) router.refresh();
      throw e;
    }
  });
  // A verification only applies to the name and email on this card (the server re-checks them in the same
  // UPDATE), so a rename after this page loaded is never verified unseen.
  const expected_identity = { display_name: u.display_name ?? '', email: u.email ?? '' };
  const position = (decision) => act(decision, () => api(`/api/admin/approvals/${u.id}`, {
    method: 'POST',
    body: { decision, expected_position_id: it.requested.id, ...(decision === 'set' ? { position_id: pos } : {}), verify_identity: v,
      ...(v ? { expected_identity } : {}) },
  }));
  const request = (decision) => act(decision, () => api(`/api/admin/requests/${it.id}`, {
    method: 'POST',
    body: { decision, note, verify_identity: decision === 'approve' && v, ...(decision === 'approve' && v ? { expected_identity } : {}) },
  }));
  const verifyNow = () => act('verify', () => api(`/api/admin/users/${u.id}`, {
    method: 'PATCH', body: { identity_verified: true, expected_identity },
  }));

  return (
    <article className={`apq-card apq-${it.type}`}>
      <div className="apq-head">
        <span className="apq-kind">{TITLE[it.type]}</span>
        <span className="muted">{fmtDay(it.at, tz)}</span>
      </div>
      <Who u={u} tz={tz} />
      <What it={it} />
      <p className={`apq-consequence${it.blocked ? ' warn' : ''}`}>
        {it.blocked ? <IconAlert size={14} /> : <IconTag size={14} />} <span>{it.consequence}</span>
      </p>
      {it.note && <p className="apq-note">Their note: “{it.note}”</p>}
      {showVerify && (
        <label className="apq-verify">
          <input type="checkbox" checked={verify} onChange={(e) => setVerify(e.target.checked)} />
          Name and email look right (approving also verifies them)
        </label>
      )}
      {err && <div className="bk-err" role="alert">{err}</div>}

      {mode === 'set' && (
        <div className="apq-inline">
          <label className="atm-label" htmlFor={`pos-${it.key}`}>Set position (applied and approved)</label>
          <div className="apq-inline-row">
            <select id={`pos-${it.key}`} className="field" value={pos} onChange={(e) => setPos(e.target.value)}>
              <PositionOptions positions={positions} current={pos} />
            </select>
            <button type="button" className="btn btn-ink" disabled={!!busy || !pos} onClick={() => position('set')}>
              {busy === 'set' ? 'Saving…' : 'Apply'}
            </button>
            <button type="button" className="btn btn-plain" disabled={!!busy} onClick={() => setMode(null)}>Cancel</button>
          </div>
        </div>
      )}
      {mode === 'decline' && (
        <div className="apq-inline">
          <label className="atm-label" htmlFor={`note-${it.key}`}>Note to keep with the decision (optional)</label>
          <div className="apq-inline-row">
            <input id={`note-${it.key}`} className="field" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Talked to them; they’re staying in Charlotte" />
            <button type="button" className="btn btn-danger" disabled={!!busy} onClick={() => request('decline')}>
              {busy === 'decline' ? 'Declining…' : 'Decline'}
            </button>
            <button type="button" className="btn btn-plain" disabled={!!busy} onClick={() => setMode(null)}>Cancel</button>
          </div>
        </div>
      )}

      {!mode && (
        <div className="apq-actions">
          {it.type === 'position' && (
            <>
              <button type="button" className="btn btn-lime wi" disabled={!!busy} onClick={() => position('approve')}>
                <IconCheck size={14} /> {busy === 'approve' ? 'Approving…' : 'Approve'}
              </button>
              <button type="button" className="btn btn-plain" disabled={!!busy} onClick={() => setMode('set')}>Set position…</button>
            </>
          )}
          {(it.type === 'office_change' || it.type === 'person_link') && (
            <>
              <button type="button" className="btn btn-lime wi" disabled={!!busy || it.blocked} onClick={() => request('approve')}
                title={it.blocked ? 'This can’t be approved as it stands; see the note above' : undefined}>
                <IconCheck size={14} /> {busy === 'approve' ? 'Approving…' : 'Approve'}
              </button>
              <button type="button" className="btn btn-plain" disabled={!!busy} onClick={() => setMode('decline')}>Decline…</button>
            </>
          )}
          {it.type === 'identity' && (
            <>
              <button type="button" className="btn btn-lime wi" disabled={!!busy} onClick={verifyNow}>
                <IconCheck size={14} /> {busy === 'verify' ? 'Verifying…' : 'Verify'}
              </button>
              <Link className="btn btn-plain wi" prefetch={false} href={`/admin/users?user=${u.id}`}><IconPencil size={14} /> Edit…</Link>
            </>
          )}
          {it.type !== 'identity' && (
            <Link className="bk-link apq-edit" prefetch={false} href={`/admin/users?user=${u.id}`}>Open account</Link>
          )}
        </div>
      )}
    </article>
  );
}

export default function ApprovalQueue({ initial, tz }) {
  const router = useRouter();
  useRefreshOnFocus(15_000);
  const [data, setData] = useServerState(initial);
  const [filter, setFilter] = useState('all');
  const [flash, setFlash] = useState(null);           // e.g. "Approved, but their name or email changed ..."
  const count = (k) => (k === 'all' ? data.items.length : data.items.filter((i) => i.type === k).length);
  const items = data.items.filter((i) => filter === 'all' || i.type === filter);
  const done = (key, message) => {
    setFlash(message || null);
    setData((d) => ({ ...d, items: d.items.filter((i) => i.key !== key) }));
    router.refresh();
  };
  return (
    <>
      {flash && (
        <div className="banner setup adm-sticky-msg" role="status">
          <IconAlert size={16} /><span>{flash}</span><span className="spacer" />
          <button type="button" className="btn btn-plain btn-sm" onClick={() => setFlash(null)}>Dismiss</button>
        </div>
      )}
      <div className="adm-chips" role="group" aria-label="Show">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className={`adm-chip${filter === f.key ? ' on' : ''}`} aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}>
            {f.label} <span className="adm-chip-n">{count(f.key)}</span>
          </button>
        ))}
      </div>
      {items.length === 0 ? (
        <div className="empty">
          <h3>Nothing is waiting{filter === 'all' ? ' for approval' : ' here'}.</h3>
          <p>New requests show up here, and as a number next to Admin in your menu.</p>
        </div>
      ) : (
        <div className="apq-list">
          {items.map((it) => <ApprovalCard key={it.key} it={it} positions={data.positions} onDone={done} tz={tz} />)}
        </div>
      )}
    </>
  );
}
