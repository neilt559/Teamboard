'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IconBuilding, IconUsers, IconChevronRight, IconArchive, IconRestore, IconTrash, IconLock, IconCaret } from '@/app/icons';
import Crumbs from '@/app/_ui/Crumbs';
import { api, ConflictError } from '@/app/_ui/api';
import { useConfirm } from '@/app/_ui/ConfirmDialog';
import { useRefreshOnFocus } from '@/app/_ui/useRefresh';
import useServerState from '@/app/_ui/useServerState';
import { canManageTeamsIn, isAdmin } from '@/lib/policy';
import LocalTime from '../LocalTime';
import NameDialog from '../_ui/NameDialog';
import MoreMenu from '../_ui/MoreMenu';
import ErrorBanner from '../_ui/ErrorBanner';
import PersonRow from '../_ui/PersonRow';
import OfficeMeetings from './OfficeMeetings';
import SpaceLink from '../../threads/_components/SpaceLink';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// One office (design §2.1, inventory §1.10 OfficeView): breadcrumb, header, teams grid (visible project names
// only), people, and the office-internal part (meetings, office thread) for people who may see it. Team
// management (add, rename, reorder within this office, archive, restore, delete) moved here from the old
// sidebar's prompt()/confirm() controls, with the same wording and double confirms (§2.3, rule 18).
export default function OfficeView({ viewer, data, now, threadSlot = null, spaceLink = null }) {
  const router = useRouter();
  useRefreshOnFocus(30_000);
  const [state, setState] = useServerState(data);
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(null);           // { kind: 'add' } | { kind: 'rename', team }
  const [showArchived, setShowArchived] = useState(false);
  const [confirmUI, ask] = useConfirm();
  const { office, teams, archived_teams: archivedTeams, people } = state;
  const canManage = canManageTeamsIn(viewer, office.id);
  const admin = isAdmin(viewer);
  const mine = (viewer.office_ids || []).map(String).includes(String(office.id));
  const followed = (viewer.prefs?.followed_office_ids || []).map(String).includes(String(office.id));

  const fail = (e) => { setError(e?.message || 'Request failed'); router.refresh(); };

  async function addTeam(name) {
    await api('/api/teams', { method: 'POST', body: { name, office_id: office.id } });
    router.refresh();
  }

  async function renameTeam(team, name) {
    try {
      const r = await api(`/api/teams/${team.id}`, { method: 'PATCH', body: { name, base: { name: team.name } } });
      setState((s) => ({ ...s, teams: s.teams.map((t) => (t.id === team.id ? { ...t, name: r.row?.name ?? name } : t)) }));
      router.refresh();
    } catch (e) {
      if (e instanceof ConflictError) {
        router.refresh();
        throw new Error(`${e.message} It's now called “${e.current?.name ?? ''}”.`);
      }
      throw e;
    }
  }

  // ▲/▼ within this office only, among its active teams (fixes the old cross-office moveTeam).
  async function moveTeam(team, dir) {
    const order = teams.map((t) => t.id);
    const i = order.indexOf(team.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    setState((s) => ({ ...s, teams: order.map((id) => s.teams.find((t) => t.id === id)) }));
    try {
      await api('/api/teams/reorder', { method: 'POST', body: { office_id: office.id, ids: order } });
      router.refresh();
    } catch (e) { fail(e); }
  }

  async function setArchived(team, archived) {
    setState((s) => (archived
      ? { ...s, teams: s.teams.filter((t) => t.id !== team.id), archived_teams: [...s.archived_teams, { ...team, project_count: team.project_count ?? 0 }] }
      : { ...s, archived_teams: s.archived_teams.filter((t) => t.id !== team.id) }));
    try {
      await api(`/api/teams/${team.id}`, { method: 'PATCH', body: { archived } });
      router.refresh();
    } catch (e) { fail(e); }
  }

  async function deleteTeam(team) {
    const n = Number(team.project_count) || 0;
    const extra = n ? ` and its ${n} project${n > 1 ? 's' : ''} (and all their tasks)` : '';
    if (!(await ask({ title: `Delete team “${team.name}”${extra}? This can’t be undone.`, confirmLabel: 'Delete', danger: true }))) return;
    if (!(await ask({ title: `Are you REALLY really sure? “${team.name}” and everything in it will be gone for good.`, confirmLabel: 'Delete for good', danger: true }))) return;
    setState((s) => ({ ...s, teams: s.teams.filter((t) => t.id !== team.id), archived_teams: s.archived_teams.filter((t) => t.id !== team.id) }));
    try {
      await api(`/api/teams/${team.id}`, { method: 'DELETE' });
      router.refresh();
    } catch (e) { fail(e); }
  }

  async function restoreOffice() {
    try {
      await api(`/api/offices/${office.id}`, { method: 'PATCH', body: { archived: false } });
      router.refresh();
    } catch (e) { fail(e); }
  }

  const teamMenu = (t, i) => (canManage ? [
    { label: 'Rename', onClick: () => setDialog({ kind: 'rename', team: t }) },
    i > 0 && { label: 'Move up', onClick: () => moveTeam(t, -1) },
    i < teams.length - 1 && { label: 'Move down', onClick: () => moveTeam(t, 1) },
    { label: 'Archive', icon: <IconArchive size={15} />, onClick: () => setArchived(t, true) },
    admin && { label: 'Delete', icon: <IconTrash size={15} />, danger: true, onClick: () => deleteTeam(t) },
  ] : null);

  const home = people.filter((p) => p.home);
  const extra = people.filter((p) => !p.home);

  return (
    <>
      <Crumbs items={[{ label: 'Offices', href: '/offices' }, { label: office.name }]} />
      {office.archived && (
        <div className="banner setup" role="status">
          <IconArchive size={16} />
          <span>This office is archived. Only admins can see it.</span>
          <span className="spacer" />
          {admin && <button type="button" className="btn btn-ink btn-sm" onClick={restoreOffice}>Restore</button>}
        </div>
      )}
      <div className="proj-head">
        <h1 className="wi-h"><IconBuilding size={24} /> {office.name}</h1>
        <LocalTime tz={office.tz} now={now} className="progress-label local-time" />
        {mine && <span className="ofc-badge ofc-badge-mine">Your office</span>}
        {!mine && followed && <span className="ofc-badge ofc-badge-follow">Following</span>}
        {spaceLink && <><div className="spacer" /><SpaceLink link={spaceLink} /></>}
      </div>
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div className="office-section office-block">
        <div className="section-head">
          <h2 className="section-title">Teams</h2>
          {canManage && <button type="button" className="btn btn-lime btn-sm" onClick={() => setDialog({ kind: 'add' })}>+ Add team</button>}
        </div>
        {teams.length === 0 ? (
          <p className="ov-empty">{canManage ? 'No teams yet — add one to start organizing projects.' : 'No teams yet.'}</p>
        ) : (
          <div className="home-grid">
            {teams.map((t, i) => (
              <div key={t.id} className="home-card ofc-team-card">
                <span className="home-card-icon"><IconUsers size={22} /></span>
                <span className="home-card-main">
                  <Link href={`/teams/${t.id}`} prefetch={false} className="home-card-name ofc-card-link">{t.name}</Link>
                  <span className="home-card-stats">{plural(t.projects.length, 'project')} · {plural(t.open, 'open task')}</span>
                  {t.projects.length > 0 && <span className="home-card-list">{t.projects.map((p) => p.name).join(' · ')}</span>}
                </span>
                <span className="ofc-card-side">
                  <MoreMenu items={teamMenu(t, i)} label={`Actions for ${t.name}`} />
                  <IconChevronRight size={18} />
                </span>
              </div>
            ))}
          </div>
        )}
        {canManage && archivedTeams.length > 0 && (
          <div className="archived-section">
            <button type="button" className="archived-toggle wi" aria-expanded={showArchived} onClick={() => setShowArchived((v) => !v)}>
              <IconCaret size={14} className={showArchived ? '' : 'caret-collapsed'} /> {`Archived teams (${archivedTeams.length})`}
            </button>
            {showArchived && (
              <ul className="ofc-archived-list">
                {archivedTeams.map((t) => (
                  <li key={t.id} className="ofc-archived-item">
                    <IconUsers size={15} />
                    <span className="ofc-archived-name" title={t.name}>{t.name}</span>
                    <button type="button" className="btn btn-plain btn-xs wi" onClick={() => setArchived(t, false)}><IconRestore size={14} /> Restore</button>
                    {admin && <button type="button" className="btn btn-plain btn-xs wi ofc-danger" onClick={() => deleteTeam(t)}><IconTrash size={14} /> Delete</button>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="office-section office-block">
        <div className="section-head">
          <h2 className="section-title">People</h2>
          <span className="progress-label">{home.length === 1 ? '1 person' : `${home.length} people`}</span>
        </div>
        {home.length === 0 && extra.length === 0 ? (
          <p className="ov-empty">Nobody has picked this office yet.</p>
        ) : (
          <ul className="ofc-people">
            {home.map((p) => <PersonRow key={p.id} person={p} />)}
            {extra.map((p) => <PersonRow key={p.id} person={p} extra={<span className="ofc-badge ofc-badge-follow">Also here</span>} />)}
          </ul>
        )}
      </div>

      {state.internal ? (
        <>
          <OfficeMeetings key={office.id} officeId={office.id} meetings={state.meetings} />
          {threadSlot}
        </>
      ) : (
        <div className="office-section office-block office-locked">
          <IconLock size={18} />
          <div>
            <b>{`${office.name} office members only`}</b>
            <p>Meeting minutes and the office’s thread space are for people in this office.</p>
          </div>
        </div>
      )}

      {dialog?.kind === 'add' && (
        <NameDialog
          title="New team" label="New team name" initial="New Team" fallback="New Team" mode="create"
          confirmLabel="Add team" busyLabel="Adding…"
          onSubmit={addTeam} onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'rename' && (
        <NameDialog
          title="Rename team" label="Team name" initial={dialog.team.name} mode="rename"
          onSubmit={(name) => renameTeam(dialog.team, name)} onClose={() => setDialog(null)}
        />
      )}
      {confirmUI}
    </>
  );
}
