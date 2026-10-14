'use client';
import { useId, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Modal from './Modal';
import { api } from './api';
import { STAGES } from '@/lib/projects';

// The one "New project" dialog (design-amendments A6.4), used wherever a project is created (the team page and
// /projects): Project number, Project name, Owner company and Jurisdiction (all required; owner and jurisdiction
// offer the values already in use through a datalist), the stages the project will go through (at least one,
// shown in the fixed order), which of them it starts in (defaults to the first chosen one), and the team.
// The schedule status starts unset. POST /api/projects validates all of it again; its 400 message shows here.
//   teams:   the teams the viewer may create in [{ id, name, office_id, office_name }] (loadCreateProjectOptions)
//   teamId:  preselect (the team page passes its own team and fixedTeam, so the team shows as text)
//   owners, jurisdictions: datalist values
// On success it opens the new project.
export default function CreateProjectDialog({ teams = [], teamId = null, fixedTeam = false, teamName = '', owners = [], jurisdictions = [], onClose }) {
  const router = useRouter();
  const uid = useId().replace(/:/g, '');
  const [f, setF] = useState({ project_number: '', name: '', owner_company: '', jurisdiction: '' });
  const [stages, setStages] = useState([]);
  const [current, setCurrent] = useState('');
  const [team, setTeam] = useState(() => (teamId != null ? String(teamId) : teams.length === 1 ? String(teams[0].id) : ''));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [tried, setTried] = useState(false);

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const chosen = STAGES.filter((s) => stages.includes(s.key));
  const startKey = chosen.some((s) => s.key === current) ? current : chosen[0]?.key || '';
  const toggleStage = (key) => setStages((st) => (st.includes(key) ? st.filter((k) => k !== key) : [...st, key]));

  // Teams grouped by office for the select.
  const groups = useMemo(() => {
    const out = [];
    for (const t of teams) {
      let g = out.find((x) => String(x.office_id) === String(t.office_id));
      if (!g) { g = { office_id: t.office_id, office_name: t.office_name || 'Office', teams: [] }; out.push(g); }
      g.teams.push(t);
    }
    return out;
  }, [teams]);

  const missing = {
    project_number: !f.project_number.trim() && 'Enter the project number.',
    name: !f.name.trim() && 'Enter the project name.',
    owner_company: !f.owner_company.trim() && 'Enter the owner company.',
    jurisdiction: !f.jurisdiction.trim() && 'Enter the jurisdiction.',
    stages: !stages.length && 'Pick at least one stage.',
    team: !team && 'Pick a team for the project.',
  };
  const firstMissing = Object.values(missing).find(Boolean) || null;
  const show = (k) => (tried && missing[k] ? <span className="cp-err" id={`${uid}-${k}-err`}>{missing[k]}</span> : null);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    setTried(true);
    if (firstMissing) { setErr(null); return; }
    setBusy(true);
    setErr(null);
    try {
      const row = await api('/api/projects', {
        method: 'POST',
        body: {
          project_number: f.project_number.trim(),
          name: f.name.trim(),
          owner_company: f.owner_company.trim(),
          jurisdiction: f.jurisdiction.trim(),
          stages: chosen.map((s) => s.key),
          current_stage: startKey,
          team_id: team,
        },
      });
      if (row && row.id != null) {
        router.push(`/projects/${row.id}`);
        router.refresh();
        return;                                   // the page changes; the dialog goes with it
      }
      router.refresh();
      onClose();
    } catch (e2) {
      setErr(e2?.message || 'Couldn’t create the project — please try again.');
      setBusy(false);
    }
  };

  const fieldProps = (k) => ({
    id: `${uid}-${k}`,
    className: `field${tried && missing[k] ? ' cp-bad' : ''}`,
    value: f[k],
    onChange: set(k),
    'aria-invalid': tried && missing[k] ? true : undefined,
    'aria-describedby': tried && missing[k] ? `${uid}-${k}-err` : undefined,
    required: true,
  });

  return (
    <Modal
      title="New project"
      className="cp-modal"
      onClose={busy ? undefined : onClose}
      actions={(
        <>
          <button type="button" className="btn btn-plain" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form={`${uid}-form`} className="btn btn-lime" disabled={busy}>{busy ? 'Creating…' : 'Create project'}</button>
        </>
      )}
    >
      <form id={`${uid}-form`} className="cp-form" onSubmit={submit} noValidate>
        <div className="cp-row">
          <label className="cp-field cp-num">
            <span className="atm-label">Project number</span>
            <input {...fieldProps('project_number')} autoFocus maxLength={40} placeholder="e.g. 260143" autoComplete="off" />
            {show('project_number')}
          </label>
          <label className="cp-field cp-grow">
            <span className="atm-label">Project name</span>
            <input {...fieldProps('name')} maxLength={200} placeholder="e.g. Randall Commons" autoComplete="off" />
            {show('name')}
          </label>
        </div>
        <label className="cp-field">
          <span className="atm-label">Owner company</span>
          <input {...fieldProps('owner_company')} maxLength={200} list={`${uid}-owners`} placeholder="Who the project is for" autoComplete="off" />
          <datalist id={`${uid}-owners`}>{owners.map((o) => <option key={o} value={o} />)}</datalist>
          {show('owner_company')}
        </label>
        <label className="cp-field">
          <span className="atm-label">Jurisdiction</span>
          <input {...fieldProps('jurisdiction')} maxLength={200} list={`${uid}-juris`} placeholder="e.g. Village of Lakeview" autoComplete="off" />
          <datalist id={`${uid}-juris`}>{jurisdictions.map((o) => <option key={o} value={o} />)}</datalist>
          {show('jurisdiction')}
        </label>

        <fieldset className={`cp-stages${tried && missing.stages ? ' cp-bad' : ''}`} aria-describedby={tried && missing.stages ? `${uid}-stages-err` : undefined}>
          <legend className="atm-label">Stages this project will go through</legend>
          <div className="cp-stage-list">
            {STAGES.map((s) => (
              <label key={s.key} className={`cp-stage${stages.includes(s.key) ? ' on' : ''}`}>
                <input type="checkbox" checked={stages.includes(s.key)} onChange={() => toggleStage(s.key)} />
                <span>{s.label}</span>
              </label>
            ))}
          </div>
          {show('stages')}
        </fieldset>
        {chosen.length > 1 && (
          <label className="cp-field cp-start">
            <span className="atm-label">It starts in</span>
            <select className="field" value={startKey} onChange={(e) => setCurrent(e.target.value)}>
              {chosen.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
        )}

        {fixedTeam ? (
          <p className="cp-team-fixed">Adding it to <b>{teamName}</b></p>
        ) : (
          <label className="cp-field">
            <span className="atm-label">Team</span>
            <select id={`${uid}-team`} className={`field${tried && missing.team ? ' cp-bad' : ''}`} value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="">Pick a team…</option>
              {groups.map((g) => (
                <optgroup key={g.office_id ?? 'none'} label={g.office_name}>
                  {g.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </optgroup>
              ))}
            </select>
            {show('team')}
          </label>
        )}
        {err && <p className="ofc-dialog-err" role="alert">{err}</p>}
        {tried && firstMissing && <p className="sr-only" role="alert">{firstMissing}</p>}
      </form>
    </Modal>
  );
}
