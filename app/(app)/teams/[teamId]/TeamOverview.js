'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IconCheck, IconArchive, IconTrash } from '@/app/icons';
import Crumbs from '@/app/_ui/Crumbs';
import { api, ConflictError } from '@/app/_ui/api';
import { useConfirm } from '@/app/_ui/ConfirmDialog';
import { useRefreshOnFocus } from '@/app/_ui/useRefresh';
import useServerState from '@/app/_ui/useServerState';
import { canManageTeamsIn, canCreateProjectIn, canManageProject, canDeleteProject, isAdmin, inMyOffices } from '@/lib/policy';
import NameDialog from '../../offices/_ui/NameDialog';
import MoreMenu from '../../offices/_ui/MoreMenu';
import ErrorBanner from '../../offices/_ui/ErrorBanner';
import TeamCard from './TeamCard';
import AddTaskModal from './AddTaskModal';
import { AddSubmittalModal, AddAttentionModal, AddMeetingModal } from './QuickAddModals';
import TeamRoster from './TeamRoster';
import CreateProjectDialog from '@/app/_ui/CreateProjectDialog';
import { projectTitle } from '@/lib/projects';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const same = (a, b) => a != null && b != null && String(a) === String(b);


// The Team page (inventory §1.10, design §2.1/§2.3), set up for the Friday review (Neil, 2026-10-15): the team's
// visible projects in project-number order as cards, three across on a computer (TeamCard: Status Report,
// submittals, attention items, upcoming meetings and the top-level tasks with who and when; no subtasks), plus the
// team's roster (A4: it drives project membership).
// Moving the team to another office needs team rights in both offices; project add / rename / archive /
// delete follow lib/policy.js exactly as the API does.
export default function TeamOverview({ viewer, data, boards = [], createOptions = null }) {
  const router = useRouter();
  useRefreshOnFocus(30_000);
  const [state, setState] = useServerState(data);
  const [dialog, setDialog] = useState(null);          // { kind: 'project' } | { kind: 'rename-project', project } | { kind: 'rename-team' }
  const [error, setError] = useState(null);
  const [addingTaskFor, setAddingTaskFor] = useState(null);
  const [quickAdd, setQuickAdd] = useState(null);       // { kind: 'submittal' | 'attention' | 'meeting', pid }
  const [notice, setNotice] = useState(null);
  const [confirmUI, ask] = useConfirm();
  const { team, office, projects, roster } = state;
  const setRoster = (fn) => setState((s) => ({ ...s, roster: fn(s.roster) }));
  const admin = isAdmin(viewer);
  const canManageTeam = canManageTeamsIn(viewer, team.office_id);
  const canAddProject = canCreateProjectIn(viewer, team);
  const fail = (e) => { setError(e?.message || 'Request failed'); router.refresh(); };

  // Office select: offices where you manage teams, plus the current one (labelled when it is archived).
  const officeOptions = state.offices.filter((o) => canManageTeamsIn(viewer, o.id));
  if (office && !officeOptions.some((o) => same(o.id, office.id))) {
    officeOptions.unshift({ id: office.id, name: office.archived ? `${office.name} (archived)` : office.name });
  }

  async function moveTeamToOffice(officeId) {
    if (!officeId || same(officeId, team.office_id)) return;
    const prev = team.office_id;
    setState((s) => ({ ...s, team: { ...s.team, office_id: String(officeId) } }));
    try {
      const r = await api(`/api/teams/${team.id}`, { method: 'PATCH', body: { office_id: officeId } });
      // Members who don't work in the new office lose the team (design §4.3); say so.
      const n = Number(r?.team_cleared) || 0;
      if (n > 0) {
        const to = state.offices.find((o) => same(o.id, officeId))?.name || 'the new office';
        setNotice(`${n} ${n === 1 ? 'member doesn’t' : 'members don’t'} work in ${to}, so their team was cleared. They can pick a team in Settings.`);
      }
      router.refresh();
    } catch (e) {
      setState((s) => ({ ...s, team: { ...s.team, office_id: prev } }));
      fail(e);
    }
  }

  // Close first, then create (as before). Assigning someone linked to an account adds them to the project.
  async function createTaskWithOwner(title, assigneeId) {
    const projectId = addingTaskFor;
    setAddingTaskFor(null);
    if (!projectId) return;
    try {
      const r = await api('/api/tasks', { method: 'POST', body: { project_id: projectId, title, assignee_id: assigneeId } });
      const added = Array.isArray(r?.added_members) ? r.added_members.filter((a) => a && a.name) : [];
      if (added.length) setNotice(`${added.map((a) => a.name).join(', ')} ${added.length === 1 ? 'was' : 'were'} added to this project.`);
      router.refresh();
    } catch (e) { fail(e); }
  }

  async function renameProject(p, name) {
    try {
      const r = await api(`/api/projects/${p.id}`, { method: 'PATCH', body: { name, base: { name: p.name } } });
      setState((s) => ({ ...s, projects: s.projects.map((x) => (x.id === p.id ? { ...x, name: r?.row?.name ?? name } : x)) }));
      router.refresh();
    } catch (e) {
      if (e instanceof ConflictError) {
        router.refresh();
        throw new Error(`${e.message} It's now called “${e.current?.name ?? ''}”.`);
      }
      throw e;
    }
  }

  async function archiveProject(p) {
    setState((s) => ({ ...s, projects: s.projects.filter((x) => x.id !== p.id) }));
    try {
      await api(`/api/projects/${p.id}`, { method: 'PATCH', body: { archived: true } });
      router.refresh();
    } catch (e) { fail(e); }
  }

  async function deleteProject(p) {
    if (!(await ask({ title: `Delete “${projectTitle(p)}” and all of its tasks?`, confirmLabel: 'Delete', danger: true }))) return;
    if (!(await ask({ title: `Are you REALLY really sure? “${projectTitle(p)}” and all its tasks will be gone for good.`, confirmLabel: 'Delete for good', danger: true }))) return;
    setState((s) => ({ ...s, projects: s.projects.filter((x) => x.id !== p.id), tasks: s.tasks.filter((t) => !same(t.project_id, p.id)) }));
    try {
      await api(`/api/projects/${p.id}`, { method: 'DELETE' });
      router.refresh();
    } catch (e) { fail(e); }
  }

  async function renameTeam(name) {
    try {
      const r = await api(`/api/teams/${team.id}`, { method: 'PATCH', body: { name, base: { name: team.name } } });
      setState((s) => ({ ...s, team: { ...s.team, name: r?.row?.name ?? name } }));
      router.refresh();
    } catch (e) {
      if (e instanceof ConflictError) {
        router.refresh();
        throw new Error(`${e.message} It's now called “${e.current?.name ?? ''}”.`);
      }
      throw e;
    }
  }

  async function setTeamArchived(archived) {
    try {
      await api(`/api/teams/${team.id}`, { method: 'PATCH', body: { archived } });
      // Archiving the team you are looking at falls back to its office (the old page fell through to Home).
      if (archived && office && !office.archived) router.push(`/offices/${office.id}`);
      else router.refresh();
    } catch (e) { fail(e); }
  }

  const projectMenu = (p) => [
    canManageProject(viewer, p) && { label: 'Rename', onClick: () => setDialog({ kind: 'rename-project', project: p }) },
    canManageProject(viewer, p) && { label: 'Archive', icon: <IconArchive size={15} />, onClick: () => archiveProject(p) },
    canDeleteProject(viewer) && { label: 'Delete', icon: <IconTrash size={15} />, danger: true, onClick: () => deleteProject(p) },
  ];

  const officeCrumb = office ? { label: office.name, href: office.archived && !admin ? null : `/offices/${office.id}` } : null;

  return (
    <>
      <Crumbs items={[{ label: 'Offices', href: '/offices' }, officeCrumb, { label: team.name }]} />
      {team.archived && (
        <div className="banner setup" role="status">
          <IconArchive size={16} />
          <span>This team is archived. It is hidden from the sidebar and the office page.</span>
          <span className="spacer" />
          {canManageTeam && <button type="button" className="btn btn-ink btn-sm" onClick={() => setTeamArchived(false)}>Restore</button>}
        </div>
      )}
      {!team.archived && office?.archived && (
        <div className="banner setup" role="status"><IconArchive size={16} /><span>This team’s office is archived.</span></div>
      )}
      <div className="proj-head team-head-row">
        <h1>{team.name}</h1>
        <span className="progress-label">{plural(projects.length, 'project')}</span>
        {canManageTeam ? (
          <label className="team-select-wrap">Office
            <select className="team-select" value={team.office_id ?? ''} onChange={(e) => moveTeamToOffice(e.target.value)} aria-label="Move this team to another office">
              {officeOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
        ) : office ? (
          <span className="team-select-wrap">Office {officeCrumb?.href ? <Link href={officeCrumb.href} prefetch={false} className="team-office-link">{office.name}</Link> : <b>{office.name}</b>}</span>
        ) : null}
        {canManageTeam && !team.archived && (
          <MoreMenu
            label={`Actions for ${team.name}`}
            items={[
              { label: 'Rename team', onClick: () => setDialog({ kind: 'rename-team' }) },
              { label: 'Archive team', icon: <IconArchive size={15} />, onClick: () => setTeamArchived(true) },
            ]}
          />
        )}
        <div className="spacer" />
        {canAddProject && !team.archived && <button type="button" className="btn btn-lime" onClick={() => setDialog({ kind: 'project' })}>+ Add Project</button>}
      </div>
      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      {notice && (
        <div className="banner setup dash-notice" role="status">
          <IconCheck size={16} /><span>{notice}</span><span className="spacer" />
          <button type="button" className="btn btn-plain btn-sm" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      {projects.length === 0 ? (
        <div className="empty">
          {/* Only L3+ and L2 in their own offices see every project here; others may just not see them. */}
          <h3>{viewer.level >= 3 || (viewer.level >= 2 && inMyOffices(viewer, team.office_id)) ? 'No projects in this team yet' : 'No projects you can see in this team yet'}</h3>
          <p>{canAddProject ? 'Click “+ Add Project” to create one.' : 'Projects you can see in this team show up here.'}</p>
        </div>
      ) : (
        <div className="overview-grid">
          {(boards || []).filter((b) => projects.some((x) => same(x.id, b.project.id))).map((b) => {
            const p = projects.find((x) => same(x.id, b.project.id)) || b.project;
            return (
              <TeamCard
                key={b.project.id}
                b={b}
                menu={<MoreMenu items={projectMenu(p)} label={`Actions for ${projectTitle(p)}`} />}
                onAddTask={(pid) => setAddingTaskFor(pid)}
                onQuickAdd={(kind, pid) => setQuickAdd({ kind, pid })}
                onError={fail}
                refresh={() => router.refresh()}
              />
            );
          })}
        </div>
      )}

      <TeamRoster
        team={team}
        office={office}
        roster={roster}
        setRoster={setRoster}
        archived={team.archived || !!office?.archived}
        ask={ask}
        refresh={() => router.refresh()}
        pmOnlyEditor={!admin && !canManageTeam}
      />

      {addingTaskFor && (() => {
        const ab = (boards || []).find((x) => same(x.project.id, addingTaskFor));
        return <AddTaskModal people={ab?.people || []} projectName={ab ? projectTitle(ab.project) : ''} onCreate={createTaskWithOwner} onClose={() => setAddingTaskFor(null)} />;
      })()}
      {quickAdd && (() => {
        const qb = (boards || []).find((x) => same(x.project.id, quickAdd.pid));
        const pid = quickAdd.pid;
        const name = qb ? projectTitle(qb.project) : '';
        const close = () => setQuickAdd(null);
        const post = (url, body) => api(url, { method: 'POST', body }).then(() => router.refresh());
        if (quickAdd.kind === 'submittal') return <AddSubmittalModal projectName={name} onClose={close} onSave={(body) => post(`/api/projects/${pid}/submittals`, body)} />;
        if (quickAdd.kind === 'attention') return <AddAttentionModal projectName={name} onClose={close} onSave={(body) => post(`/api/projects/${pid}/attention-items`, body)} />;
        return <AddMeetingModal projectName={name} today={qb?.today} onClose={close} onSave={(body) => post('/api/project-meetings', { project_id: pid, ...body })} />;
      })()}
      {dialog?.kind === 'project' && (
        <CreateProjectDialog
          teams={[{ id: team.id, name: team.name, office_id: team.office_id, office_name: office?.name || '' }]}
          teamId={team.id}
          fixedTeam
          teamName={team.name}
          owners={createOptions?.owners || []}
          jurisdictions={createOptions?.jurisdictions || []}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'rename-project' && (
        <NameDialog
          title="Rename project" label="Project name" initial={dialog.project.name} mode="rename"
          onSubmit={(name) => renameProject(dialog.project, name)} onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'rename-team' && (
        <NameDialog
          title="Rename team" label="Team name" initial={team.name} mode="rename"
          onSubmit={renameTeam} onClose={() => setDialog(null)}
        />
      )}
      {confirmUI}
    </>
  );
}
