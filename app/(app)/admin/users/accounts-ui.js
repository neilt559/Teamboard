'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ConflictError } from '@/app/_ui/api';
import useServerState, { mergeById } from '@/app/_ui/useServerState';
import { useRefreshOnFocus } from '@/app/_ui/useRefresh';
import { useConfirm } from '@/app/_ui/ConfirmDialog';
import { Headshot } from '@/app/_ui/Headshot';
import {
  IconShield, IconKey, IconCheck, IconPencil, IconSearch, IconBuilding, IconUser, IconLock, IconRestore, IconAlert,
} from '@/app/icons';
import { fmtDay, fmtWhen, plural, same, useAct, DeptTag, InlineText, PositionOptions } from '../_parts/kit';

// ---- Accounts (moved from app/accounts-ui.js, design §2.3) --------------------------------------------
// Admins only (the page 404s for everyone else). Lists every account with its profile; resets passwords
// (server-generated temporary password), makes and removes admins (at least one stays), and, new for the
// company launch: verify name and email, edit or clear them, organizer flag, office/team/department/boss/
// position, extra offices, sign-in lock, disable, and the legacy-access tools (§6).

const isTest = (u) => /^zz_/.test(u.username);
const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' });

// ---------------------------------------------------------------- temporary password

function ResetRow({ u, onCancel, onDone }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [copied, setCopied] = useState(false);
  const go = async () => {
    if (pw && pw.length < 8) { setErr('At least 8 characters, or leave it empty and one is made for you.'); return; }
    setBusy(true);
    setErr('');
    try {
      const r = await api(`/api/admin/users/${u.id}/reset`, { method: 'POST', body: pw ? { password: pw } : {} });
      setDone(r.password);
      onDone();
    } catch (x) { setErr(x.message); }
    setBusy(false);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(done); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  };
  if (done) {
    return (
      <div className="acct-reset done">
        <p><IconCheck size={15} /> Done. <b>{u.username}</b> has been signed out everywhere. Their temporary password is:</p>
        <div className="acct-temp"><code>{done}</code><button type="button" className="btn btn-plain btn-sm" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button></div>
        <p className="acct-note">Tell them in person or by message. They’ll be asked to pick their own password when they sign in.</p>
        <button type="button" className="btn btn-ink btn-sm" onClick={onCancel}>Close</button>
      </div>
    );
  }
  return (
    <div className="acct-reset">
      <label className="atm-label" htmlFor={`pw-${u.id}`}>Temporary password for {u.username}</label>
      <div className="acct-temp">
        <input id={`pw-${u.id}`} className="field" value={pw} onChange={(e) => setPw(e.target.value)} spellCheck={false} autoComplete="off"
          placeholder="Leave empty to get one like maple-river-cedar-otter-47" />
      </div>
      <p className="acct-note">This signs {u.username} out on every device. They’ll use this to sign in, then choose their own.</p>
      {err && <div className="bk-err">{err}</div>}
      <div className="acct-reset-actions">
        <button type="button" className="btn btn-plain btn-sm" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-danger btn-sm" onClick={go} disabled={busy}>{busy ? 'Resetting…' : 'Reset password'}</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- one account's editor

function Field({ label, htmlFor, children, hint }) {
  return (
    <div className="adm-field">
      <label className="atm-label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="adm-hint">{hint}</p>}
    </div>
  );
}

function AccountEditor({ u, me, lists, accounts, onPatch, onAfter, ask }) {
  const { busy, err, setErr, msg, setMsg, run } = useAct();
  const [grant, setGrant] = useState('');
  const isMe = same(u.id, me.id);
  const id = (k) => `acct-${u.id}-${k}`;

  const save = (key, body) => run(key, async () => {
    try {
      await onPatch(body);
    } catch (e) {
      if (e instanceof ConflictError) {
        const cur = e.current || {};
        throw new Error(`${e.message} It now reads “${cur.display_name || cur.username || ''}”${cur.email ? ` / ${cur.email}` : ''}.`);
      }
      throw e;
    }
  });
  const call = (key, path, opts, after) => run(key, async () => {
    const r = await api(path, opts);
    if (after) after(r);
    onAfter(r.user);
    return r;
  });

  const myOffices = [u.office_id, ...(u.extra_offices || []).map((o) => o.id)].filter(Boolean).map(String);
  const activeOffices = lists.offices.filter((o) => !o.archived || same(o.id, u.office_id));
  const teams = lists.teams.filter((t) => (myOffices.includes(String(t.office_id)) && !t.archived) || same(t.id, u.team_id));
  const officeName = (oid) => lists.offices.find((o) => same(o.id, oid))?.name || '';
  const grantable = lists.offices.filter((o) => !o.archived && !myOffices.includes(String(o.id)));
  const bosses = accounts.filter((x) => !same(x.id, u.id) && (!x.disabled_at || same(x.id, u.manager_id))).sort(byName);

  const prune = async () => {
    const ok = await ask({
      title: `Apply the new rules to ${u.name}?`,
      lines: [
        `They keep the projects of every team they’re on (their roster teams and the team in their profile) and the projects where they own tasks; the rest of their ${plural(u.legacy_count, 'legacy membership')} are removed.`,
        'You can undo this right after, or later from Legacy access on this page.',
      ],
      confirmLabel: 'Apply new rules',
    });
    if (!ok) return;
    await call('prune', `/api/admin/users/${u.id}/prune-legacy`, { method: 'POST' }, (r) => setMsg({
      text: r.removed ? `Removed ${plural(r.removed, 'legacy membership')}.` : 'Nothing to remove: every legacy project is their team’s or has their tasks.',
      batch: r.removed || r.relabeled ? r.batch : null,
    }));
  };
  const undo = (batch) => call('undo', `/api/admin/legacy/undo/${batch}`, { method: 'POST' },
    (r) => setMsg({ text: `Restored ${plural(r.restored, 'membership')}.` }));
  const revoke = async (o) => {
    const ok = await ask({
      title: `Remove ${o.name} from ${u.name}’s offices?`,
      lines: [
        `They stop seeing ${o.name}’s projects (except ones they’re a member of) and its meeting minutes and threads.`,
        same(teams.find((t) => same(t.id, u.team_id))?.office_id, o.id) ? `Their team (${u.team}) is in ${o.name}, so it is cleared too.` : '',
      ],
      confirmLabel: 'Remove office',
      danger: true,
    });
    if (ok) await call(`revoke-${o.id}`, `/api/admin/users/${u.id}/offices/${o.id}`, { method: 'DELETE' });
  };
  const toggleDisabled = async () => {
    const on = !u.disabled_at;
    if (on) {
      const ok = await ask({
        title: `Disable ${u.name}?`,
        lines: ['They’re signed out everywhere and can’t sign in until you enable the account again.', 'Nothing they made is deleted.'],
        confirmLabel: 'Disable account',
        danger: true,
      });
      if (!ok) return;
    }
    await save('disable', { disabled: on });
  };

  return (
    <div className="acct-editor">
      {err && <div className="bk-err" role="alert">{err}</div>}
      {msg && (
        <div className="adm-flash" role="status">
          <IconCheck size={14} /> <span>{msg.text}</span>
          {msg.batch && <button type="button" className="bk-link" disabled={!!busy} onClick={() => undo(msg.batch)}>Undo</button>}
        </div>
      )}
      <div className="acct-editor-grid">
        <section>
          <h3>Name and email</h3>
          <Field label="Display name" htmlFor={id('name')} hint="Empty shows the username.">
            <InlineText value={u.display_name || ''} placeholder={u.username} maxLength={80} label="Display name"
              onSave={(t, base) => save('name', { display_name: t.trim(), base: { display_name: base } })} />
          </Field>
          <Field label="Work email" htmlFor={id('email')} hint="Empty clears it (frees the address for its real owner).">
            <InlineText value={u.email || ''} placeholder="name@cagecivil.com" maxLength={254} label="Work email"
              onSave={(t, base) => save('email', { email: t.trim(), base: { email: base } })} />
          </Field>
          <div className="adm-field">
            {u.identity_verified_at ? (
              <p className="adm-ok"><IconCheck size={14} /> Verified {fmtDay(u.identity_verified_at, me.tz)}{u.identity_verified_by_name ? ` by ${u.identity_verified_by_name}` : ''}.
                {' '}<button type="button" className="bk-link" disabled={!!busy} onClick={() => save('verify', { identity_verified: false })}>Mark unverified</button></p>
            ) : (
              <>
                <p className="adm-warn"><IconAlert size={14} /> Name and email not verified (others see “unverified”).</p>
                <button type="button" className="btn btn-lime btn-sm wi adm-verify-btn" disabled={!!busy} onClick={() => save('verify', { identity_verified: true, expected_identity: { display_name: u.display_name ?? '', email: u.email ?? '' } })}>
                  <IconCheck size={13} /> {busy === 'verify' ? 'Verifying…' : 'Verify name and email'}
                </button>
              </>
            )}
          </div>
        </section>

        <section>
          <h3>Office and team</h3>
          <Field label="Home office" htmlFor={id('office')} hint="Takes effect at once. Their team is cleared if it isn’t in their offices any more.">
            <select id={id('office')} className="field" value={u.office_id || ''} disabled={!!busy}
              onChange={(e) => save('office', { office_id: e.target.value || null })}>
              <option value="">No office</option>
              {activeOffices.map((o) => <option key={o.id} value={o.id}>{o.name}{o.archived ? ' (archived)' : ''}</option>)}
            </select>
          </Field>
          <Field label="Team" htmlFor={id('team')}>
            <select id={id('team')} className="field" value={u.team_id || ''} disabled={!!busy}
              onChange={(e) => save('team', { team_id: e.target.value || null })}>
              <option value="">No team</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name} ({officeName(t.office_id)}){t.archived ? ' (archived)' : ''}</option>)}
            </select>
          </Field>
          <div className="adm-field">
            <span className="atm-label">Extra offices</span>
            <div className="adm-chiprow">
              {(u.extra_offices || []).length === 0 && <span className="muted">None</span>}
              {(u.extra_offices || []).map((o) => (
                <span key={o.id} className="adm-pill">
                  <IconBuilding size={13} /> {o.name}
                  <button type="button" className="adm-pill-x" aria-label={`Remove ${o.name}`} disabled={!!busy} onClick={() => revoke(o)}>×</button>
                </span>
              ))}
            </div>
            {grantable.length > 0 && (
              <div className="adm-row">
                <select className="field" value={grant} onChange={(e) => setGrant(e.target.value)} aria-label="Office to add">
                  <option value="">Add an office…</option>
                  {grantable.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
                <button type="button" className="btn btn-ink btn-sm" disabled={!grant || !!busy}
                  onClick={() => call('grant', `/api/admin/users/${u.id}/offices`, { method: 'POST', body: { office_id: grant } }, () => setGrant(''))}>
                  {busy === 'grant' ? 'Adding…' : 'Grant'}
                </button>
              </div>
            )}
          </div>
        </section>

        <section>
          <h3>Role</h3>
          <Field label="Position" htmlFor={id('pos')}
            hint={u.position_pending
              ? `Asked for ${u.position || '—'}; approved: ${u.approved_position || 'none'}. Picking one here sets and approves it.`
              : 'Picking one sets and approves it.'}>
            <select id={id('pos')} className="field" value={u.approved_position_id || ''} disabled={!!busy}
              onChange={(e) => e.target.value && save('pos', { position_id: e.target.value, expected_position_id: u.position_id })}>
              {!u.approved_position_id && <option value="" disabled>No approved position</option>}
              <PositionOptions positions={lists.positions} current={u.approved_position_id} />
            </select>
          </Field>
          {u.position_pending && u.position_id && (
            <button type="button" className="btn btn-lime btn-sm wi adm-approve-pos" disabled={!!busy}
              onClick={() => save('pos', { position_id: u.position_id, expected_position_id: u.position_id })}>
              <IconCheck size={13} /> Approve {u.position}
            </button>
          )}
          <Field label="Department" htmlFor={id('dept')}>
            <select id={id('dept')} className="field" value={u.department_id || ''} disabled={!!busy}
              onChange={(e) => save('dept', { department_id: e.target.value || null })}>
              <option value="">No department</option>
              {lists.departments.filter((d) => !d.archived || same(d.id, u.department_id)).map((d) => (
                <option key={d.id} value={d.id}>{d.name}{d.archived ? ' (archived)' : ''}</option>
              ))}
            </select>
          </Field>
          <Field label="Boss" htmlFor={id('boss')}>
            <select id={id('boss')} className="field" value={u.manager_id || ''} disabled={!!busy}
              onChange={(e) => save('boss', { manager_id: e.target.value || null })}>
              <option value="">No boss</option>
              {bosses.map((x) => <option key={x.id} value={x.id}>{x.name}{x.name !== x.username ? ` (@${x.username})` : ''}</option>)}
            </select>
          </Field>
          <label className="adm-check">
            <input type="checkbox" checked={!!u.is_organizer} disabled={!!busy} onChange={(e) => save('org', { is_organizer: e.target.checked })} />
            Culture organizer (creates and runs brackets, challenges and events)
          </label>
        </section>

        <section>
          <h3>Access</h3>
          <p className="adm-line">
            Sees <b>{plural(u.visible_count, 'project')}</b> ({plural(u.member_count, 'membership')}
            {u.legacy_count ? `, ${u.legacy_count} of them legacy` : ''}).
          </p>
          {u.legacy_count > 0 && (
            <button type="button" className="btn btn-plain btn-sm" disabled={!!busy} onClick={prune}>
              {busy === 'prune' ? 'Applying…' : `Apply new rules to ${u.name}`}
            </button>
          )}
          <p className="adm-line">
            {u.signin_locked
              ? <span className="adm-warn-inline"><IconLock size={13} /> Sign-in locked ({u.signin_failures} failed tries in 15 minutes).</span>
              : `${plural(u.signin_failures, 'recent failed sign-in')}.`}
            {u.signin_failures > 0 && (
              <>{' '}<button type="button" className="bk-link" disabled={!!busy}
                onClick={() => call('lock', `/api/admin/users/${u.id}/clear-lock`, { method: 'POST' }, () => setMsg({ text: 'Sign-in lock cleared.' }))}>
                Clear sign-in lock</button></>
            )}
          </p>
          <p className="adm-line">
            {u.avatar_set_by_name ? `Photo last set by ${u.avatar_set_by_name}, ${fmtWhen(u.avatar_set_at, me.tz)}.` : (u.avatar_v ? 'Has a photo.' : 'No photo.')}
          </p>
          {!isMe && (
            <button type="button" className={`btn btn-sm ${u.disabled_at ? 'btn-ink' : 'btn-danger'}`} disabled={!!busy} onClick={toggleDisabled}>
              {u.disabled_at ? <><IconRestore size={13} /> Enable account</> : 'Disable account'}
            </button>
          )}
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- legacy access tools (§6)

function LegacyTools({ totals, batches, ask, onChanged, tz }) {
  const { busy, err, msg, setMsg, run } = useAct();
  const apply = async () => {
    const ok = await ask({
      title: 'Apply the new rules to every legacy user?',
      lines: [
        'Each person keeps the projects of every team they’re on (roster teams and the team in their profile) and the projects where they own tasks; the rest of their legacy access is removed.',
        'People with an approved office-level or higher position still see what their position allows.',
        'You can undo this right after, or later from this list.',
      ],
      confirmLabel: 'Apply new rules',
    });
    if (!ok) return;
    await run('apply', async () => {
      const r = await api('/api/admin/legacy/apply-rules', { method: 'POST' });
      setMsg({
        text: r.removed ? `Removed ${plural(r.removed, 'legacy membership')} across ${plural(r.people, 'person', 'people')}.` : 'Nothing to remove.',
        batch: r.removed || r.relabeled ? r.batch : null,
      });
      onChanged();
    });
  };
  const undo = (batch) => run(`undo-${batch}`, async () => {
    const r = await api(`/api/admin/legacy/undo/${batch}`, { method: 'POST' });
    setMsg({ text: `Restored ${plural(r.restored, 'membership')}.` });
    onChanged();
  });
  return (
    <section className="adm-card adm-legacy" id="legacy">
      <div className="adm-card-head"><h2>Legacy access</h2></div>
      <p className="adm-line">
        Accounts that existed before the company update keep every pre-launch project until you apply the new rules:
        {' '}<b>{Number(totals.legacy_active || 0).toLocaleString('en-US')}</b> legacy memberships are active
        {totals.legacy_removed ? `, ${Number(totals.legacy_removed).toLocaleString('en-US')} removed` : ''}.
        Applying keeps the projects of each person’s teams (roster and profile) and the projects where they own tasks. It can be undone.
      </p>
      {err && <div className="bk-err" role="alert">{err}</div>}
      {msg && (
        <div className="adm-flash" role="status">
          <IconCheck size={14} /> <span>{msg.text}</span>
          {msg.batch && <button type="button" className="bk-link" disabled={!!busy} onClick={() => undo(msg.batch)}>Undo</button>}
        </div>
      )}
      <button type="button" className="btn btn-ink" disabled={!!busy || !Number(totals.legacy_active)} onClick={apply}>
        {busy === 'apply' ? 'Applying…' : 'Apply new rules to legacy users'}
      </button>
      {batches.length > 0 && (
        <ul className="adm-batches">
          {batches.map((b) => (
            <li key={b.id}>
              <span>{fmtWhen(b.at, tz)} · {b.target === 'all' ? 'everyone' : (b.target_name || `account ${b.target}`)} · by {b.actor || 'someone'}</span>
              <span className="muted">{b.still_removed ? `${plural(b.still_removed, 'membership')} still removed` : 'nothing removed now'}</span>
              {b.still_removed > 0 && (
                <button type="button" className="bk-link" disabled={!!busy} onClick={() => undo(b.id)}>
                  {busy === `undo-${b.id}` ? 'Undoing…' : 'Undo'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- the page

export default function AccountsView({ me, initial, openUserId }) {
  const router = useRouter();
  useRefreshOnFocus(30_000);
  const [data, setData] = useServerState(initial);
  const [q, setQ] = useState('');
  const [hideTest, setHideTest] = useState(false);
  const [hideDisabled, setHideDisabled] = useState(false);
  const [resetting, setResetting] = useState(null);
  const [editing, setEditing] = useState(openUserId || null);
  const [confirmUI, ask] = useConfirm();
  const { busy, err, run } = useAct();

  useEffect(() => {
    if (!openUserId) return;
    setEditing(openUserId);
    const el = document.getElementById(`acct-${openUserId}`);
    if (el) el.scrollIntoView({ block: 'start' });
  }, [openUserId]);

  const adopt = (user) => {
    if (user) setData((d) => ({ ...d, accounts: mergeById(d.accounts, user) }));
    router.refresh();
  };
  const patch = async (u, body) => {
    const r = await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body });
    adopt(r.user);
    return r.user;
  };
  const setAdmin = async (u, on) => {
    if (!on && !(await ask({ title: `Remove admin from ${u.username}?`, confirmLabel: 'Remove admin', danger: true }))) return;
    await run(`admin-${u.id}`, () => patch(u, { is_admin: on }));
  };

  const isMe = (u) => same(u.id, me.id);
  const needle = q.trim().toLowerCase();
  const list = data.accounts.filter((u) => (!hideTest || !isTest(u)) && (!hideDisabled || !u.disabled_at)
    && (!needle || [u.name, u.username, u.email, u.office, u.team, u.department, u.approved_position]
      .some((x) => x && String(x).toLowerCase().includes(needle))));
  const lists = { offices: data.offices, teams: data.teams, departments: data.departments, positions: data.positions };

  return (
    <>
      <div className="proj-head">
        <h1 className="wi-h"><IconShield size={24} /> Accounts</h1>
        <span className="progress-label">Admins only. {plural(data.accounts.length, 'account')}.</span>
      </div>
      {confirmUI}
      {err && <div className="bk-err" role="alert">{err}</div>}

      <LegacyTools totals={data.totals || {}} batches={data.batches || []} ask={ask} onChanged={() => router.refresh()} tz={me.tz} />

      <div className="adm-toolbar">
        <label className="adm-search">
          <IconSearch size={15} />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, office…" aria-label="Search accounts" />
        </label>
        <label className="adm-check"><input type="checkbox" checked={hideTest} onChange={(e) => setHideTest(e.target.checked)} /> Hide test accounts</label>
        <label className="adm-check"><input type="checkbox" checked={hideDisabled} onChange={(e) => setHideDisabled(e.target.checked)} /> Hide disabled</label>
      </div>

      {list.length === 0 && <p className="ov-empty">No accounts match.</p>}
      <div className="acct-list">
        {list.map((u) => {
          const open = same(editing, u.id);
          const pending = (u.pending_requests || []);
          return (
            <div key={u.id} id={`acct-${u.id}`} className={`acct-row${resetting === u.id || open ? ' open' : ''}${u.disabled_at ? ' disabled' : ''}`}>
              <Headshot user={u} size={36} className="acct-hs" />
              <div className="acct-main">
                <div className="acct-name">
                  {u.name}
                  {u.name !== u.username && <span className="acct-username">@{u.username}</span>}
                  {isMe(u) && <span className="acct-tag you">you</span>}
                  {u.is_admin && <span className="acct-tag admin">Admin</span>}
                  {u.is_organizer && <span className="acct-tag admin">Organizer</span>}
                  {u.must_change && <span className="acct-tag pending" title="Has a temporary password and hasn’t chosen a new one yet">Temp password</span>}
                  {isTest(u) && <span className="acct-tag test" title="Left over from testing the site">test account</span>}
                  {u.disabled_at && <span className="acct-tag disabled" title={`Disabled ${fmtDay(u.disabled_at, me.tz)}`}>Disabled</span>}
                  {!u.profile_completed_at && <span className="acct-tag pending" title="Hasn’t finished the one-time profile yet">Profile not finished</span>}
                  {u.profile_completed_at && !u.identity_verified_at && <span className="unverified-chip">unverified</span>}
                  {u.signin_locked && <span className="acct-tag pending wi" title="Too many failed sign-ins"><IconLock size={11} /> Locked</span>}
                  {u.position_pending && <span className="acct-tag pending" title={`Asked for ${u.position}`}>Position pending</span>}
                  {pending.map((p) => (
                    <span key={p.id} className="acct-tag pending">{p.kind === 'office_change' ? `Move to ${p.office || '?'} pending` : `Name “${p.person || '?'}” pending`}</span>
                  ))}
                </div>
                <div className="acct-profile">
                  {u.email && <span>{u.email}</span>}
                  {u.office && <span className="wi"><IconBuilding size={12} /> {u.office}</span>}
                  {u.team && <span className="wi"><IconUser size={12} /> {u.team}</span>}
                  {u.department && <DeptTag name={u.department} color={u.department_color} />}
                  {u.approved_position && <span>{u.approved_position}</span>}
                  {u.boss && <span>Reports to {u.boss}</span>}
                </div>
                <div className="acct-meta">
                  Joined {fmtDay(u.created_at, me.tz)} · Last sign-in {fmtDay(u.last_sign_in, me.tz)} · {u.devices} device{u.devices === 1 ? '' : 's'} signed in
                </div>
              </div>
              <div className="acct-actions">
                {isMe(u)
                  ? <Link className="btn btn-plain btn-sm wi" prefetch={false} href="/settings?tab=password"><IconKey size={13} /> Change my password</Link>
                  : <button type="button" className="btn btn-plain btn-sm wi" onClick={() => { setResetting(resetting === u.id ? null : u.id); }}><IconKey size={13} /> Reset password</button>}
                <button type="button" className="btn btn-plain btn-sm wi" aria-expanded={open} onClick={() => setEditing(open ? null : u.id)}>
                  <IconPencil size={13} /> {open ? 'Close' : 'Edit'}
                </button>
                {u.is_admin
                  ? !isMe(u) && <button type="button" className="bk-link" disabled={busy === `admin-${u.id}`} onClick={() => setAdmin(u, false)}>Remove admin</button>
                  : <button type="button" className="bk-link" disabled={busy === `admin-${u.id}`} onClick={() => setAdmin(u, true)}>Make admin</button>}
              </div>
              {resetting === u.id && <ResetRow u={u} onCancel={() => setResetting(null)} onDone={() => router.refresh()} />}
              {open && (
                <AccountEditor u={u} me={me} lists={lists} accounts={data.accounts} ask={ask}
                  onPatch={(body) => patch(u, body)} onAfter={adopt} />
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
