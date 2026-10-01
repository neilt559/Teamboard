'use client';
import { useEffect, useState, useRef, useCallback, Fragment } from 'react';
import BracketView from './bracket-ui';
import { SyncedField, SyncedTextarea } from './synced';
import SuggestionsView from './suggestions-ui';
import {
  IconArchive, IconTrash, IconRestore, IconUsers, IconList, IconGlobe, IconTrophy, IconBuilding, IconFile,
  IconNote, IconPencil, IconPaperclip, IconCalendar, IconFolder, IconAlert, IconMenu, IconExternal, IconStar, IconBulb,
} from './icons';
import { nextSlot } from '@/lib/bracket';

const STATUSES = {
  not_started: { label: 'Not Started', color: '#b6b6b7', text: '#6f6c6d' },
  working: { label: 'Working on it', color: '#fdab3d', text: '#b9760a' },
  stuck: { label: 'Stuck', color: '#e2445c', text: '#cf3350' },
  done: { label: 'Done', color: '#00c875', text: '#029457' },
};
const STATUS_ORDER = ['not_started', 'working', 'stuck', 'done'];
const STOPLIGHT_ORDER = ['red', 'yellow', 'green'];
const STOPLIGHTS = { red: '#e5484d', yellow: '#f4be0d', green: '#2fb344' };
const PERSON_COLORS = ['#5B5859', '#CBCE00', '#0086c0', '#e2445c', '#fdab3d', '#00c875', '#a25ddc', '#ff158a', '#037f4c', '#7f5347'];

const byPos = (a, b) => (Number(a.position) - Number(b.position)) || (Number(a.id) - Number(b.id));
const byName = (a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' });

function initials(name) {
  if (!name) return '?';
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?';
}

// Compact "date added" label, e.g. 9/14/26 — deliberately small so it never
// competes with the target finish (Due) date.
function fmtAdded(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
}

// Normalize a typed hex ("5b5859", "#ABC", "#5B5859") to "#rrggbb", or null if invalid.
function normHex(s) {
  if (!s) return null;
  let h = String(s).trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(h)) h = h.split('').map((c) => c + c).join('');
  if (/^[0-9a-fA-F]{6}$/.test(h)) return '#' + h.toLowerCase();
  return null;
}
function toHex(v) { return normHex(v) || '#5b5859'; }

function isWebUrl(s) { return /^https?:\/\//i.test((s || '').trim()); }
function isFilePath(s) { const v = (s || '').trim(); return /^(\\\\|[a-zA-Z]:[\\/])/.test(v); }
async function copyText(s) {
  try { await navigator.clipboard.writeText(s); return true; } catch { return false; }
}

function ColorControl({ value, onChange }) {
  const [local, setLocal] = useState(toHex(value));
  const timer = useRef(null);
  useEffect(() => { setLocal(toHex(value)); }, [value]);
  const pick = (c) => {
    setLocal(c); // instant preview while dragging
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange(c), 250); // save once they settle
  };
  return (
    <div className="color-control">
      <input type="color" className="color-picker" value={local} onChange={(e) => pick(e.target.value)} title="Pick a color" />
      <input
        type="text"
        className="hex-input"
        key={value}
        defaultValue={value}
        maxLength={7}
        placeholder="#5B5859"
        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
        onBlur={(e) => { const v = normHex(e.target.value); if (v && v !== normHex(value)) onChange(v); else e.target.value = value; }}
      />
    </div>
  );
}

async function api(path, opts) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (res.status === 401) { if (typeof window !== 'undefined') window.location.href = '/login'; throw new Error('Please sign in'); }
  if (!res.ok) {
    let msg = 'Request failed';
    try { const j = await res.json(); msg = j.error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export default function Page() {
  const [data, setData] = useState({ people: [], offices: [], teams: [], projects: [], tasks: [], info: [], meetings: [], geo: [], pseries: [], pmeetings: [], users: [], brackets: [], bentrants: [], bmatches: [], bvotes: [], suggestions: [] });
  const [selected, setSelected] = useState(null);
  const [teamView, setTeamView] = useState(null);
  // Full-page views reached from the header: false | 'tasks' (All Tasks) | 'geo' (GeoGuessr) | 'bracket' | 'ideas' (Suggestions).
  const [globalView, setGlobalView] = useState(false);
  const [officeView, setOfficeView] = useState(null);
  const [expandedMeetings, setExpandedMeetings] = useState({});
  const [expandedPMeetings, setExpandedPMeetings] = useState({});
  const [addingTaskFor, setAddingTaskFor] = useState(null);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [collapsedTeams, setCollapsedTeams] = useState({});
  const [collapsedOffices, setCollapsedOffices] = useState({});
  const [expandedSubtasks, setExpandedSubtasks] = useState({});
  const [expandedNotes, setExpandedNotes] = useState({});
  const [sidebarWidth, setSidebarWidth] = useState(250);
  const [showArchivedSidebar, setShowArchivedSidebar] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const guard = useRef(0);

  const load = useCallback(async (force = false) => {
    if (!force && Date.now() < guard.current) return;
    try {
      const d = await api('/api/state');
      setData(d);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { load(true); }, [load]);
  useEffect(() => {
    fetch('/api/auth/me').then((r) => r.json()).then((j) => setCurrentUser(j.user || null)).catch(() => {});
  }, []);
  async function logout() {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
    window.location.href = '/login';
  }
  useEffect(() => {
    const t = setInterval(() => load(false), 4000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const saved = Number(localStorage.getItem('tb_sidebar_w'));
    if (saved >= 180 && saved <= 600) setSidebarWidth(saved);
  }, []);

  // keep a valid (non-archived) project selected (only matters when not viewing a team)
  useEffect(() => {
    const active = data.projects.filter((p) => !p.archived);
    const cur = data.projects.find((p) => String(p.id) === String(selected));
    if (selected !== null && cur && !cur.archived) return;
    setSelected(active.length ? [...active].sort(byPos)[0].id : null);
  }, [data.projects, selected]);

  const touch = () => { guard.current = Date.now() + 2500; };

  function startResize(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev) => setSidebarWidth(Math.min(600, Math.max(180, startW + (ev.clientX - startX))));
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      setSidebarWidth((w) => { localStorage.setItem('tb_sidebar_w', String(Math.round(w))); return w; });
    };
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // ---- offices ----
  async function addOffice() {
    const name = prompt('New office name', 'New Office');
    if (name === null) return;
    touch();
    try { await api('/api/offices', { method: 'POST', body: JSON.stringify({ name: name.trim() || 'New Office' }) }); await load(true); }
    catch (e) { setError(e.message); }
  }
  async function renameOffice(office) {
    const name = prompt('Rename office', office.name);
    if (name === null || name.trim() === '' || name === office.name) return;
    setData((d) => ({ ...d, offices: d.offices.map((x) => (x.id === office.id ? { ...x, name } : x)) }));
    touch();
    try { await api(`/api/offices/${office.id}`, { method: 'PATCH', body: JSON.stringify({ name }) }); }
    catch (e) { setError(e.message); }
  }
  async function deleteOffice(office) {
    // GeoGuessr history must never be lost, so an office that has any can only
    // be archived (the server and database refuse the delete too).
    const geoCount = data.geo.filter((g) => String(g.office_id) === String(office.id)).length;
    if (geoCount || Number(office.fivek) > 0) {
      alert(`“${office.name}” has GeoGuessr history (${geoCount} score${geoCount === 1 ? '' : 's'}, ${Number(office.fivek) || 0} 5Ks), so it can’t be deleted — that data is kept for good.\n\nUse the archive button instead to hide it from the sidebar.`);
      return;
    }
    const teamCount = data.teams.filter((t) => String(t.office_id) === String(office.id)).length;
    const extra = teamCount ? ` and its ${teamCount} team${teamCount > 1 ? 's' : ''} (and everything in them)` : '';
    if (!confirm(`Delete office “${office.name}”${extra}? This can’t be undone.`)) return;
    if (!confirm(`Are you REALLY really sure? “${office.name}” and everything in it will be gone for good.`)) return;
    setData((d) => ({
      ...d,
      offices: d.offices.filter((x) => x.id !== office.id),
      teams: d.teams.filter((t) => String(t.office_id) !== String(office.id)),
    }));
    touch();
    try { await api(`/api/offices/${office.id}`, { method: 'DELETE' }); await load(true); }
    catch (e) { setError(e.message); load(true); }
  }
  async function setOfficeArchived(office, archived) {
    setData((d) => ({ ...d, offices: d.offices.map((x) => (x.id === office.id ? { ...x, archived } : x)) }));
    touch();
    try { await api(`/api/offices/${office.id}`, { method: 'PATCH', body: JSON.stringify({ archived }) }); }
    catch (e) { setError(e.message); }
  }
  function toggleOffice(id) { setCollapsedOffices((c) => ({ ...c, [id]: !c[id] })); }
  async function moveOffice(office, dir) {
    const sorted = [...data.offices].filter((o) => !o.archived).sort(byPos);
    const i = sorted.findIndex((x) => String(x.id) === String(office.id));
    const j = i + dir;
    if (j < 0 || j >= sorted.length) return;
    const other = sorted[j];
    const pi = Number(office.position), pj = Number(other.position);
    setData((d) => ({ ...d, offices: d.offices.map((x) => (String(x.id) === String(office.id) ? { ...x, position: pj } : String(x.id) === String(other.id) ? { ...x, position: pi } : x)) }));
    touch();
    try {
      await api(`/api/offices/${office.id}`, { method: 'PATCH', body: JSON.stringify({ position: pj }) });
      await api(`/api/offices/${other.id}`, { method: 'PATCH', body: JSON.stringify({ position: pi }) });
    } catch (e) { setError(e.message); }
  }
  async function moveTeamToOffice(teamId, officeId) {
    setData((d) => ({ ...d, teams: d.teams.map((t) => (t.id === teamId ? { ...t, office_id: officeId } : t)) }));
    touch();
    try { await api(`/api/teams/${teamId}`, { method: 'PATCH', body: JSON.stringify({ office_id: officeId }) }); }
    catch (e) { setError(e.message); }
  }

  // ---- meetings ----
  async function addMeeting(officeId) {
    const title = prompt('Meeting name', 'Meeting');
    if (title === null) return;
    const today = new Date().toISOString().slice(0, 10);
    touch();
    try {
      const m = await api('/api/meetings', { method: 'POST', body: JSON.stringify({ office_id: officeId, title: title.trim() || 'Meeting', meeting_date: today }) });
      await load(true);
      if (m && m.id) setExpandedMeetings((s) => ({ ...s, [m.id]: true }));
    } catch (e) { setError(e.message); }
  }
  async function updateMeeting(id, patch) {
    setData((d) => ({ ...d, meetings: d.meetings.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
    touch();
    try { await api(`/api/meetings/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }); }
    catch (e) { setError(e.message); }
  }
  async function deleteMeeting(m) {
    if (!confirm(`Delete meeting “${m.title}” and its minutes?`)) return;
    setData((d) => ({ ...d, meetings: d.meetings.filter((x) => x.id !== m.id) }));
    touch();
    try { await api(`/api/meetings/${m.id}`, { method: 'DELETE' }); }
    catch (e) { setError(e.message); }
  }
  function toggleMeeting(id) { setExpandedMeetings((s) => ({ ...s, [id]: !s[id] })); }

  // ---- geoguessr ----
  async function addGeo(officeId, score, date) {
    touch();
    try { await api('/api/geo', { method: 'POST', body: JSON.stringify({ office_id: officeId, score, score_date: date }) }); await load(true); }
    catch (e) { setError(e.message); }
  }
  async function deleteGeo(id) {
    const g = data.geo.find((x) => String(x.id) === String(id));
    const office = g && data.offices.find((o) => String(o.id) === String(g.office_id));
    const what = g ? `the ${Number(g.score).toLocaleString()} score${g.score_date ? ` from ${g.score_date}` : ''}${office ? ` (${office.name})` : ''}` : 'this score';
    if (!confirm(`Delete ${what}?\n\nOnly do this to fix a mistake — it can’t be undone.`)) return;
    setData((d) => ({ ...d, geo: d.geo.filter((x) => x.id !== id) }));
    touch();
    try { await api(`/api/geo/${id}`, { method: 'DELETE' }); }
    catch (e) { setError(e.message); }
  }
  // ---- bracket ----
  // Mirrors the server: set/clear a match winner and fill/empty the slot it
  // feeds (or the bracket's champion), so the board updates instantly.
  function applyWinnerLocal(d, matchId, winnerId) {
    const m = d.bmatches.find((x) => String(x.id) === String(matchId));
    if (!m) return d;
    const winnerTo = winnerId || null;
    let bmatches = d.bmatches.map((x) => (x.id === m.id ? { ...x, winner_id: winnerTo } : x));
    let bvotes = d.bvotes;
    let brackets = d.brackets;
    const nx = nextSlot(m.round, m.idx);
    if (nx) {
      const key = nx.side === 'a' ? 'a_id' : 'b_id';
      const n = bmatches.find((x) => String(x.bracket_id) === String(m.bracket_id) && Number(x.round) === nx.round && Number(x.idx) === nx.idx);
      if (n) {
        bmatches = bmatches.map((x) => (x.id === n.id ? { ...x, [key]: winnerTo } : x));
        if (!winnerTo) bvotes = bvotes.filter((v) => String(v.match_id) !== String(n.id));
      }
    } else {
      const champName = winnerTo ? (d.bentrants.find((e) => String(e.id) === String(winnerTo)) || {}).name : null;
      brackets = brackets.map((b) => (String(b.id) === String(m.bracket_id)
        ? { ...b, champion_id: winnerTo, champion_name: champName, completed_at: winnerTo ? new Date().toISOString() : null }
        : b));
    }
    return { ...d, bmatches, bvotes, brackets };
  }
  async function castVote(matchId, entrantId) {
    const uid = currentUser && currentUser.id;
    if (!uid) return;
    setData((d) => ({
      ...d,
      bvotes: [
        ...d.bvotes.filter((v) => !(String(v.match_id) === String(matchId) && String(v.user_id) === String(uid))),
        ...(entrantId ? [{ match_id: matchId, user_id: uid, entrant_id: entrantId }] : []),
      ],
    }));
    touch();
    try { await api('/api/bracket-votes', { method: 'POST', body: JSON.stringify({ match_id: matchId, entrant_id: entrantId }) }); }
    catch (e) { setError(e.message); load(true); }
  }
  async function declareWinner(matchId, entrantId) {
    setData((d) => applyWinnerLocal(d, matchId, entrantId));
    touch();
    try { await api(`/api/bracket-matches/${matchId}/winner`, { method: 'POST', body: JSON.stringify({ entrant_id: entrantId }) }); await load(true); }
    catch (e) { setError(e.message); load(true); }
  }
  async function undoWinner(matchId) {
    setData((d) => applyWinnerLocal(d, matchId, null));
    touch();
    try { await api(`/api/bracket-matches/${matchId}/winner`, { method: 'DELETE' }); await load(true); }
    catch (e) { setError(e.message); load(true); }
  }
  async function createBracket(payload) {
    touch();
    try {
      await api('/api/brackets', { method: 'POST', body: JSON.stringify(payload) });
      await load(true);
      return true;
    } catch (e) { setError(e.message); return false; }
  }
  async function patchBracket(id, patch) {
    const local = { ...patch };
    if (Array.isArray(local.regions)) local.regions = JSON.stringify(local.regions);
    setData((d) => ({ ...d, brackets: d.brackets.map((b) => (String(b.id) === String(id) ? { ...b, ...local } : b)) }));
    touch();
    try { await api(`/api/brackets/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }); }
    catch (e) { setError(e.message); }
  }
  async function renameEntrant(id, name) {
    setData((d) => ({ ...d, bentrants: d.bentrants.map((e) => (String(e.id) === String(id) ? { ...e, name } : e)) }));
    touch();
    try { await api(`/api/bracket-entrants/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }); }
    catch (e) { setError(e.message); }
  }
  async function deleteBracket(id) {
    setData((d) => ({ ...d, brackets: d.brackets.filter((b) => String(b.id) !== String(id)) }));
    touch();
    try { await api(`/api/brackets/${id}`, { method: 'DELETE' }); }
    catch (e) { setError(e.message); }
  }
  // ---- suggestions ----
  const patchSuggestionLocal = (id, patch) => setData((d) => ({ ...d, suggestions: d.suggestions.map((s) => (String(s.id) === String(id) ? { ...s, ...patch } : s)) }));
  async function addSuggestion(p) {
    touch();
    try { await api('/api/suggestions', { method: 'POST', body: JSON.stringify(p) }); await load(true); return true; }
    catch (e) { setError(e.message); return false; }
  }
  async function patchSuggestion(id, patch) {
    patchSuggestionLocal(id, patch);
    touch();
    try { await api(`/api/suggestions/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }); return true; }
    catch (e) { setError(e.message); load(true); return false; }
  }
  async function deleteSuggestion(id) {
    setData((d) => ({ ...d, suggestions: d.suggestions.filter((s) => String(s.id) !== String(id)) }));
    touch();
    try { await api(`/api/suggestions/${id}`, { method: 'DELETE' }); }
    catch (e) { setError(e.message); load(true); }
  }
  async function voteSuggestion(id, on) {
    setData((d) => ({ ...d, suggestions: d.suggestions.map((s) => (String(s.id) === String(id) && !!s.voted !== on ? { ...s, voted: on, votes: s.votes + (on ? 1 : -1) } : s)) }));
    touch();
    try { await api(`/api/suggestions/${id}/vote`, { method: 'POST', body: JSON.stringify({ on }) }); }
    catch (e) { setError(e.message); load(true); }
  }

  // payload = { image, crop, source? } from the photo cropper, or null to remove.
  async function setAvatar(userId, payload) {
    touch();
    if (payload) {
      const r = await api(`/api/avatar/${userId}`, { method: 'PUT', body: JSON.stringify(payload) });
      setData((d) => ({ ...d, users: d.users.map((u) => (String(u.id) === String(userId) ? { ...u, avatar_v: r.avatar_v, avatar_crop: r.avatar_crop, has_src: r.has_src } : u)) }));
    } else {
      setData((d) => ({ ...d, users: d.users.map((u) => (String(u.id) === String(userId) ? { ...u, avatar_v: null, avatar_crop: null, has_src: false } : u)) }));
      try { await api(`/api/avatar/${userId}`, { method: 'DELETE' }); }
      catch (e) { setError(e.message); }
    }
  }

  // Joining GeoGuessr is one-way: there's deliberately no way to take an
  // office back off the GeoGuessr page.
  async function joinGeo(office) {
    setData((d) => ({ ...d, offices: d.offices.map((x) => (x.id === office.id ? { ...x, geo_on: true } : x)) }));
    touch();
    try { await api(`/api/offices/${office.id}`, { method: 'PATCH', body: JSON.stringify({ geo_on: true }) }); }
    catch (e) { setError(e.message); }
  }
  async function createGeoOffice(name) {
    touch();
    try { await api('/api/offices', { method: 'POST', body: JSON.stringify({ name, geo_on: true }) }); await load(true); }
    catch (e) { setError(e.message); }
  }
  async function bumpFiveK(officeId, delta) {
    setData((d) => ({
      ...d,
      offices: d.offices.map((o) => (String(o.id) === String(officeId) ? { ...o, fivek: Math.max(0, (Number(o.fivek) || 0) + delta) } : o)),
    }));
    touch();
    try { await api('/api/fivek', { method: 'POST', body: JSON.stringify({ office_id: officeId, delta }) }); }
    catch (e) { setError(e.message); }
  }

  // ---- project meetings ----
  async function addPMeeting(projectId, seriesId) {
    touch();
    try {
      const today = new Date().toISOString().slice(0, 10);
      const m = await api('/api/project-meetings', { method: 'POST', body: JSON.stringify({ project_id: projectId, series_id: seriesId || null, title: 'Meeting', meeting_date: today }) });
      await load(true);
      if (m && m.id) setExpandedPMeetings((s) => ({ ...s, [m.id]: true }));
    } catch (e) { setError(e.message); }
  }
  async function updatePMeeting(id, patch) {
    setData((d) => ({ ...d, pmeetings: d.pmeetings.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
    touch();
    try { await api(`/api/project-meetings/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }); }
    catch (e) { setError(e.message); }
  }
  async function deletePMeeting(m) {
    if (!confirm(`Delete meeting “${m.title}”?`)) return;
    setData((d) => ({ ...d, pmeetings: d.pmeetings.filter((x) => x.id !== m.id) }));
    touch();
    try { await api(`/api/project-meetings/${m.id}`, { method: 'DELETE' }); }
    catch (e) { setError(e.message); }
  }
  function togglePMeeting(id) { setExpandedPMeetings((s) => ({ ...s, [id]: !s[id] })); }
  async function addPSeries(projectId) {
    const name = prompt('Meeting series name', '');
    if (name === null) return;
    touch();
    try { await api('/api/meeting-series', { method: 'POST', body: JSON.stringify({ project_id: projectId, name: name.trim() || 'Series' }) }); await load(true); }
    catch (e) { setError(e.message); }
  }
  async function renamePSeries(sv) {
    const name = prompt('Rename series', sv.name);
    if (name === null || name.trim() === '' || name === sv.name) return;
    setData((d) => ({ ...d, pseries: d.pseries.map((x) => (x.id === sv.id ? { ...x, name } : x)) }));
    touch();
    try { await api(`/api/meeting-series/${sv.id}`, { method: 'PATCH', body: JSON.stringify({ name }) }); }
    catch (e) { setError(e.message); }
  }
  async function deletePSeries(sv) {
    if (!confirm(`Delete series “${sv.name}” and all meetings in it?`)) return;
    setData((d) => ({ ...d, pseries: d.pseries.filter((x) => x.id !== sv.id), pmeetings: d.pmeetings.filter((m) => String(m.series_id) !== String(sv.id)) }));
    touch();
    try { await api(`/api/meeting-series/${sv.id}`, { method: 'DELETE' }); await load(true); }
    catch (e) { setError(e.message); }
  }

  // ---- teams ----
  async function addTeam(officeId) {
    const name = prompt('New team name', 'New Team');
    if (name === null) return;
    touch();
    try { await api('/api/teams', { method: 'POST', body: JSON.stringify({ name: name.trim() || 'New Team', office_id: officeId }) }); await load(true); setCollapsedOffices((c) => ({ ...c, [officeId]: false })); }
    catch (e) { setError(e.message); }
  }
  async function renameTeam(team) {
    const name = prompt('Rename team', team.name);
    if (name === null || name.trim() === '' || name === team.name) return;
    setData((d) => ({ ...d, teams: d.teams.map((x) => (x.id === team.id ? { ...x, name } : x)) }));
    touch();
    try { await api(`/api/teams/${team.id}`, { method: 'PATCH', body: JSON.stringify({ name }) }); }
    catch (e) { setError(e.message); }
  }
  async function deleteTeam(team) {
    const projCount = data.projects.filter((p) => String(p.team_id) === String(team.id)).length;
    const extra = projCount ? ` and its ${projCount} project${projCount > 1 ? 's' : ''} (and all their tasks)` : '';
    if (!confirm(`Delete team “${team.name}”${extra}? This can’t be undone.`)) return;
    if (!confirm(`Are you REALLY really sure? “${team.name}” and everything in it will be gone for good.`)) return;
    if (String(teamView) === String(team.id)) setTeamView(null);
    setData((d) => ({
      ...d,
      teams: d.teams.filter((x) => x.id !== team.id),
      projects: d.projects.filter((p) => String(p.team_id) !== String(team.id)),
    }));
    touch();
    try { await api(`/api/teams/${team.id}`, { method: 'DELETE' }); await load(true); }
    catch (e) { setError(e.message); }
  }
  async function setTeamArchived(team, archived) {
    if (archived && String(teamView) === String(team.id)) setTeamView(null);
    setData((d) => ({ ...d, teams: d.teams.map((x) => (x.id === team.id ? { ...x, archived } : x)) }));
    touch();
    try { await api(`/api/teams/${team.id}`, { method: 'PATCH', body: JSON.stringify({ archived }) }); }
    catch (e) { setError(e.message); }
  }
  function toggleTeam(id) { setCollapsedTeams((c) => ({ ...c, [id]: !c[id] })); }
  async function moveTeam(team, dir) {
    const sorted = [...data.teams].sort(byPos);
    const i = sorted.findIndex((x) => String(x.id) === String(team.id));
    const j = i + dir;
    if (j < 0 || j >= sorted.length) return;
    const other = sorted[j];
    const pi = Number(team.position), pj = Number(other.position);
    setData((d) => ({ ...d, teams: d.teams.map((x) => (String(x.id) === String(team.id) ? { ...x, position: pj } : String(x.id) === String(other.id) ? { ...x, position: pi } : x)) }));
    touch();
    try {
      await api(`/api/teams/${team.id}`, { method: 'PATCH', body: JSON.stringify({ position: pj }) });
      await api(`/api/teams/${other.id}`, { method: 'PATCH', body: JSON.stringify({ position: pi }) });
    } catch (e) { setError(e.message); }
  }

  // ---- projects ----
  async function addProject(teamId) {
    const name = prompt('New project name', 'New Project');
    if (name === null) return;
    touch();
    try {
      const np = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: name.trim() || 'New Project', team_id: teamId }) });
      await load(true);
      if (np && np.id) { setSelected(np.id); setTeamView(null); setCollapsedTeams((c) => ({ ...c, [teamId]: false })); setSidebarOpen(false); }
    } catch (e) { setError(e.message); }
  }
  async function renameProject(p) {
    const name = prompt('Rename project', p.name);
    if (name === null || name.trim() === '' || name === p.name) return;
    setData((d) => ({ ...d, projects: d.projects.map((x) => (x.id === p.id ? { ...x, name } : x)) }));
    touch();
    try { await api(`/api/projects/${p.id}`, { method: 'PATCH', body: JSON.stringify({ name }) }); }
    catch (e) { setError(e.message); }
  }
  async function deleteProject(p) {
    if (!confirm(`Delete “${p.name}” and all of its tasks?`)) return;
    if (!confirm(`Are you REALLY really sure? “${p.name}” and all its tasks will be gone for good.`)) return;
    setData((d) => ({
      ...d,
      projects: d.projects.filter((x) => x.id !== p.id),
      tasks: d.tasks.filter((t) => t.project_id !== p.id),
    }));
    touch();
    try { await api(`/api/projects/${p.id}`, { method: 'DELETE' }); await load(true); }
    catch (e) { setError(e.message); }
  }
  async function setProjectArchived(p, archived) {
    if (archived && String(selected) === String(p.id)) { setSelected(null); }
    setData((d) => ({ ...d, projects: d.projects.map((x) => (x.id === p.id ? { ...x, archived } : x)) }));
    touch();
    try { await api(`/api/projects/${p.id}`, { method: 'PATCH', body: JSON.stringify({ archived }) }); }
    catch (e) { setError(e.message); }
  }
  async function saveProjectNotes(id, notes) {
    setData((d) => ({ ...d, projects: d.projects.map((p) => (p.id === id ? { ...p, notes } : p)) }));
    touch();
    try { await api(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ notes }) }); }
    catch (e) { setError(e.message); }
  }
  async function moveProject(id, teamId) {
    setData((d) => ({ ...d, projects: d.projects.map((p) => (p.id === id ? { ...p, team_id: teamId } : p)) }));
    touch();
    try { await api(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ team_id: teamId }) }); }
    catch (e) { setError(e.message); }
  }
  async function moveProjectOrder(p, dir) {
    const siblings = data.projects.filter((x) => String(x.team_id) === String(p.team_id)).sort(byPos);
    const i = siblings.findIndex((x) => String(x.id) === String(p.id));
    const j = i + dir;
    if (j < 0 || j >= siblings.length) return;
    const other = siblings[j];
    const pi = Number(p.position), pj = Number(other.position);
    setData((d) => ({ ...d, projects: d.projects.map((x) => (String(x.id) === String(p.id) ? { ...x, position: pj } : String(x.id) === String(other.id) ? { ...x, position: pi } : x)) }));
    touch();
    try {
      await api(`/api/projects/${p.id}`, { method: 'PATCH', body: JSON.stringify({ position: pj }) });
      await api(`/api/projects/${other.id}`, { method: 'PATCH', body: JSON.stringify({ position: pi }) });
    } catch (e) { setError(e.message); }
  }

  // ---- tasks ----
  async function addTask() {
    if (selected === null) return;
    touch();
    try { await api('/api/tasks', { method: 'POST', body: JSON.stringify({ project_id: selected }) }); await load(true); }
    catch (e) { setError(e.message); }
  }
  async function createTaskWithOwner(title, assigneeId) {
    const projectId = addingTaskFor;
    setAddingTaskFor(null);
    if (!projectId) return;
    touch();
    try { await api('/api/tasks', { method: 'POST', body: JSON.stringify({ project_id: projectId, title, assignee_id: assigneeId }) }); await load(true); }
    catch (e) { setError(e.message); }
  }
  async function addSubtask(parentId) {
    if (selected === null) return;
    touch();
    try {
      await api('/api/tasks', { method: 'POST', body: JSON.stringify({ project_id: selected, parent_id: parentId }) });
      await load(true);
      setExpandedSubtasks((s) => ({ ...s, [parentId]: true }));
    } catch (e) { setError(e.message); }
  }
  function toggleSubtasks(id) { setExpandedSubtasks((s) => ({ ...s, [id]: !s[id] })); }
  function toggleNotes(id) { setExpandedNotes((s) => ({ ...s, [id]: !s[id] })); }
  async function updateTask(id, patch) {
    setData((d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
    touch();
    try { await api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }); }
    catch (e) { setError(e.message); }
  }
  function changeStatus(id, status) {
    updateTask(id, status === 'done' ? { status, archived: true } : { status });
  }
  function restoreTask(id) { updateTask(id, { archived: false }); }
  async function deleteTask(id) {
    if (!confirm('Delete this task? This can’t be undone.')) return;
    setData((d) => ({ ...d, tasks: d.tasks.filter((t) => t.id !== id && String(t.parent_id) !== String(id)) }));
    touch();
    try { await api(`/api/tasks/${id}`, { method: 'DELETE' }); }
    catch (e) { setError(e.message); }
  }

  // ---- people ----
  async function addPerson(name, color) {
    touch();
    try { await api('/api/people', { method: 'POST', body: JSON.stringify({ name, color }) }); await load(true); }
    catch (e) { setError(e.message); }
  }
  async function updatePerson(id, patch) {
    setData((d) => ({ ...d, people: d.people.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
    touch();
    try { await api(`/api/people/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }); }
    catch (e) { setError(e.message); }
  }
  async function deletePerson(id) {
    setData((d) => ({
      ...d,
      people: d.people.filter((p) => p.id !== id),
      tasks: d.tasks.map((t) => (t.assignee_id === id ? { ...t, assignee_id: null } : t)),
    }));
    touch();
    try { await api(`/api/people/${id}`, { method: 'DELETE' }); }
    catch (e) { setError(e.message); }
  }

  // ---- additional project info ----
  async function addInfo() {
    if (selected === null) return;
    touch();
    try { await api('/api/info', { method: 'POST', body: JSON.stringify({ project_id: selected }) }); await load(true); }
    catch (e) { setError(e.message); }
  }
  async function updateInfo(id, patch) {
    setData((d) => ({ ...d, info: d.info.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
    touch();
    try { await api(`/api/info/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }); }
    catch (e) { setError(e.message); }
  }
  async function deleteInfo(id) {
    setData((d) => ({ ...d, info: d.info.filter((r) => r.id !== id) }));
    touch();
    try { await api(`/api/info/${id}`, { method: 'DELETE' }); }
    catch (e) { setError(e.message); }
  }

  const viewedTeam = teamView != null ? data.teams.find((t) => String(t.id) === String(teamView) && !t.archived) : null;
  const viewedOffice = officeView != null ? data.offices.find((o) => String(o.id) === String(officeView) && !o.archived) : null;
  const project = data.projects.find((p) => String(p.id) === String(selected)) || null;
  const allTasks = data.tasks.filter((t) => String(t.project_id) === String(selected));
  const topTasks = allTasks.filter((t) => !t.parent_id);
  const tasks = topTasks.filter((t) => !t.archived);
  const archivedTasks = topTasks.filter((t) => t.archived);
  const doneCount = topTasks.filter((t) => t.status === 'done').length;
  const pct = topTasks.length ? Math.round((doneCount / topTasks.length) * 100) : 0;
  const subtasksByParent = {};
  allTasks.forEach((t) => {
    if (t.parent_id) {
      const k = String(t.parent_id);
      if (!subtasksByParent[k]) subtasksByParent[k] = [];
      subtasksByParent[k].push(t);
    }
  });
  const infoRows = data.info.filter((r) => String(r.project_id) === String(selected)).sort(byPos);
  const activeProjectIdSet = new Set(data.projects.filter((p) => !p.archived).map((p) => String(p.id)));
  const globalTasks = data.tasks.filter((t) => !t.archived && activeProjectIdSet.has(String(t.project_id)));
  const activeOffices = [...data.offices].filter((o) => !o.archived).sort(byPos);
  const archivedOffices = data.offices.filter((o) => o.archived);
  const archivedTeams = data.teams.filter((t) => t.archived);
  const archivedProjects = data.projects.filter((p) => p.archived);
  const isSetup = error && /POSTGRES_URL|connection string|connect/i.test(error);

  // Renders one task row plus its (optional) subtask rows and notes editors.
  function renderTaskRow(t, isSub) {
    const owner = data.people.find((p) => String(p.id) === String(t.assignee_id));
    const st = STATUSES[t.status] || STATUSES.not_started;
    const hasNotes = (t.notes || '').trim().length > 0;
    const notesOpen = !!expandedNotes[t.id];
    const subs = isSub ? [] : (subtasksByParent[String(t.id)] || []);
    const subExpanded = !!expandedSubtasks[t.id];
    const subDone = subs.filter((s) => s.status === 'done').length;
    return (
      <Fragment key={t.id}>
        <tr className={`${isSub ? 'subtask-row' : ''}${hasNotes && !notesOpen ? ' has-note-below' : ''}`}>
          <td>
            <div className={isSub ? 'subtask-title-cell' : 'title-cell'}>
              {isSub ? (
                <span className="subtask-arrow">↳</span>
              ) : (
                <button className="subtask-toggle" title="Show / add subtasks" onClick={() => toggleSubtasks(t.id)}>
                  <span className="caret">{subExpanded ? '▾' : '▸'}</span>
                  {subs.length > 0 && <span className="sub-badge">{subDone}/{subs.length}</span>}
                </button>
              )}
              <div className="title-main">
                <SyncedField
                  className="task-title"
                  value={t.title}
                  placeholder={isSub ? 'Untitled subtask' : 'Untitled task'}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                  onSave={(v) => updateTask(t.id, { title: v })}
                />
              </div>
            </div>
          </td>
          <td>
            <div className="cell-owner">
              {owner ? (
                <span className="avatar" style={{ background: owner.color }}>{initials(owner.name)}</span>
              ) : (
                <span className="avatar" style={{ background: '#dcdcdc', color: '#8a8788' }}>–</span>
              )}
              <select className="owner-select" value={t.assignee_id ?? ''} onChange={(e) => updateTask(t.id, { assignee_id: e.target.value || null })}>
                <option value="">Unassigned</option>
                {data.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </td>
          <td>
            <div className="stoplight">
              {t.stoplight && STOPLIGHTS[t.stoplight] ? (
                <button
                  type="button"
                  className="sl-dot on solo"
                  style={{ '--sl': STOPLIGHTS[t.stoplight] }}
                  title="Click to clear priority"
                  onClick={() => updateTask(t.id, { stoplight: '' })}
                />
              ) : (
                STOPLIGHT_ORDER.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="sl-dot"
                    style={{ '--sl': STOPLIGHTS[c] }}
                    title={c === 'red' ? 'Urgent' : c === 'yellow' ? 'Priority' : 'When there is time'}
                    onClick={() => updateTask(t.id, { stoplight: c })}
                  />
                ))
              )}
            </div>
          </td>
          <td>
            <input type="date" className="date-input" value={t.due_date ?? ''} onChange={(e) => updateTask(t.id, { due_date: e.target.value || null })} />
          </td>
          <td>
            <select
              className="status-select"
              value={t.status}
              style={{ background: '#fff', color: st.text, borderColor: st.color }}
              onChange={(e) => (isSub ? updateTask(t.id, { status: e.target.value }) : changeStatus(t.id, e.target.value))}
            >
              {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUSES[s].label}</option>)}
            </select>
          </td>
          <td className="added-cell" title={t.created_at ? `Added ${new Date(t.created_at).toLocaleString()}` : ''}>
            {isSub ? '' : fmtAdded(t.created_at)}
          </td>
          <td className="row-actions">
            <button
              className={`notes-btn ${hasNotes ? 'has-notes' : ''}`}
              title={hasNotes ? 'Edit note' : 'Add a note'}
              onClick={() => toggleNotes(t.id)}
            ><IconNote size={15} /></button>
            <button className="row-x" title={isSub ? 'Delete subtask' : 'Delete task'} onClick={() => deleteTask(t.id)}>×</button>
          </td>
        </tr>

        {hasNotes && !notesOpen && (
          <tr className="note-preview-row">
            <td colSpan={7}>
              <div className="note-preview" title="Click to edit note" onClick={() => toggleNotes(t.id)}><IconNote size={13} /> {t.notes}</div>
            </td>
          </tr>
        )}

        {notesOpen && (
          <tr className="task-notes-row">
            <td colSpan={7}>
              <SyncedTextarea
                className="task-notes-area"
                value={t.notes || ''}
                placeholder="Notes — details, blockers, links. Everyone on the team can see this."
                onSave={(v) => updateTask(t.id, { notes: v })}
              />
            </td>
          </tr>
        )}

        {!isSub && subExpanded && (
          <>
            {subs.map((sub) => renderTaskRow(sub, true))}
            <tr className="subtask-add-row">
              <td colSpan={7}><button className="add-subtask-btn" onClick={() => addSubtask(t.id)}>+ Add subtask</button></td>
            </tr>
          </>
        )}
      </Fragment>
    );
  }

  return (
    <>
      <header className="app-header">
        <div className="brand">
          <button className="menu-btn btn-ghost" onClick={() => setSidebarOpen((s) => !s)} aria-label="Toggle teams"><IconMenu size={18} /></button>
          <span className="dot" /> TeamBoard <small>shared project board</small>
        </div>
        <div className="header-actions">
          {[['tasks', IconList, 'All Tasks'], ['geo', IconGlobe, 'GeoGuessr'], ['bracket', IconTrophy, 'Bracket'], ['ideas', IconBulb, 'Suggestions']].map(([key, Icon, label]) => (
            <button
              key={key}
              className={`btn btn-ghost wi ${globalView === key ? 'tab-on' : ''}`}
              onClick={() => { setGlobalView(key); setTeamView(null); setOfficeView(null); setSidebarOpen(false); }}
            ><Icon size={16} /> {label}</button>
          ))}
          <button className="btn btn-ghost people-btn" onClick={() => setPeopleOpen(true)}><IconUsers /> People ({data.people.length})</button>
          <button className="btn btn-lime" onClick={addOffice}>+ New Office</button>
          {currentUser && <span className="user-chip" title={`Signed in as ${currentUser.username}`}>{currentUser.username}</span>}
          <button className="btn btn-ghost" onClick={logout} title="Log out">Log out</button>
        </div>
      </header>

      <div className="layout">
        <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`} style={{ width: sidebarWidth, flex: `0 0 ${sidebarWidth}px` }}>
          <h2>Offices <button className="add-mini" onClick={addOffice} aria-label="Add office">+</button></h2>
          {activeOffices.map((office) => {
            const officeTeams = data.teams.filter((t) => String(t.office_id) === String(office.id) && !t.archived).sort(byPos);
            const oCollapsed = collapsedOffices[office.id];
            return (
              <div key={office.id} className="office">
                <div className="office-head">
                  <button className="team-caret" onClick={() => toggleOffice(office.id)} aria-label="Collapse office">{oCollapsed ? '▶︎' : '▼'}</button>
                  <span className={`office-name ${String(officeView) === String(office.id) ? 'viewing' : ''}`} onClick={() => { setOfficeView(office.id); setTeamView(null); setGlobalView(false); setSidebarOpen(false); }} onDoubleClick={() => renameOffice(office)} title="Click to open office page · double-click to rename">{office.name}</span>
                  <span className="reorder">
                    <button onClick={() => moveOffice(office, -1)} title="Move up">▲</button>
                    <button onClick={() => moveOffice(office, 1)} title="Move down">▼</button>
                  </span>
                  <button className="row-icon" title="Add team to this office" onClick={() => addTeam(office.id)}>+</button>
                  <button className="row-icon" title="Archive office" onClick={() => setOfficeArchived(office, true)}><IconArchive /></button>
                  <button className="row-icon danger" title="Delete office" onClick={() => deleteOffice(office)}><IconTrash /></button>
                </div>
                {!oCollapsed && (
                  <div className="office-teams">
                    {officeTeams.map((team) => {
                      const teamProjects = data.projects.filter((p) => String(p.team_id) === String(team.id) && !p.archived).sort(byName);
                      const collapsed = collapsedTeams[team.id];
                      return (
                        <div key={team.id} className="team">
                          <div className={`team-head ${String(teamView) === String(team.id) ? 'viewing' : ''}`}>
                            <button className="team-caret" onClick={() => toggleTeam(team.id)} aria-label="Collapse team">{collapsed ? '▶︎' : '▼'}</button>
                            <span className="team-name" onClick={() => { setTeamView(team.id); setGlobalView(false); setOfficeView(null); setSidebarOpen(false); }} onDoubleClick={() => renameTeam(team)} title="Click to view team · double-click to rename">{team.name}</span>
                            <span className="reorder">
                              <button onClick={() => moveTeam(team, -1)} title="Move up">▲</button>
                              <button onClick={() => moveTeam(team, 1)} title="Move down">▼</button>
                            </span>
                            <button className="row-icon" title="Add project to this team" onClick={() => addProject(team.id)}>+</button>
                            <button className="row-icon" title="Archive team" onClick={() => setTeamArchived(team, true)}><IconArchive /></button>
                            <button className="row-icon danger" title="Delete team" onClick={() => deleteTeam(team)}><IconTrash /></button>
                          </div>
                          {!collapsed && teamProjects.map((p) => {
                            const count = data.tasks.filter((t) => t.project_id === p.id && !t.archived && !t.parent_id).length;
                            return (
                              <div
                                key={p.id}
                                className={`proj ${String(p.id) === String(selected) && teamView == null && !globalView ? 'active' : ''}`}
                                onClick={() => { setSelected(p.id); setTeamView(null); setGlobalView(false); setOfficeView(null); setSidebarOpen(false); }}
                                onDoubleClick={() => renameProject(p)}
                                title="Click to open · double-click to rename"
                              >
                                <span className="name">{p.name}</span>
                                <span className="count">{count}</span>
                                <button className="row-icon" title="Archive project" onClick={(e) => { e.stopPropagation(); setProjectArchived(p, true); }}><IconArchive /></button>
                                <button className="row-icon danger" title="Delete project" onClick={(e) => { e.stopPropagation(); deleteProject(p); }}><IconTrash /></button>
                              </div>
                            );
                          })}
                          {!collapsed && teamProjects.length === 0 && (
                            <p className="team-empty">No projects — click <b>+</b> to add one.</p>
                          )}
                        </div>
                      );
                    })}
                    {officeTeams.length === 0 && (
                      <p className="team-empty">No teams — click <b>+</b> to add one.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {!activeOffices.length && loaded && (
            <p style={{ color: '#8a8788', fontSize: 13, padding: '0 8px' }}>No offices yet. Click + to add one.</p>
          )}

          {(archivedOffices.length > 0 || archivedTeams.length > 0 || archivedProjects.length > 0) && (
            <div className="archived-section">
              <button className="archived-toggle" onClick={() => setShowArchivedSidebar((s) => !s)}>
                <IconArchive size={14} /> Archived ({archivedOffices.length + archivedTeams.length + archivedProjects.length}) {showArchivedSidebar ? '▾' : '▸'}
              </button>
              {showArchivedSidebar && (
                <div className="archived-list">
                  {archivedOffices.map((office) => (
                    <div key={`o${office.id}`} className="archived-item">
                      <span className="ai-name" title={office.name}><IconBuilding size={13} /> {office.name}</span>
                      <button className="row-icon" title="Restore office" onClick={() => setOfficeArchived(office, false)}><IconRestore /></button>
                      <button className="row-icon danger" title="Delete office" onClick={() => deleteOffice(office)}><IconTrash /></button>
                    </div>
                  ))}
                  {archivedTeams.map((team) => (
                    <div key={`t${team.id}`} className="archived-item">
                      <span className="ai-name" title={team.name}><IconUsers size={13} /> {team.name}</span>
                      <button className="row-icon" title="Restore team" onClick={() => setTeamArchived(team, false)}><IconRestore /></button>
                      <button className="row-icon danger" title="Delete team" onClick={() => deleteTeam(team)}><IconTrash /></button>
                    </div>
                  ))}
                  {archivedProjects.map((p) => (
                    <div key={`p${p.id}`} className="archived-item">
                      <span className="ai-name" title={p.name}><IconFile size={13} /> {p.name}</span>
                      <button className="row-icon" title="Restore project" onClick={() => setProjectArchived(p, false)}><IconRestore /></button>
                      <button className="row-icon danger" title="Delete project" onClick={() => deleteProject(p)}><IconTrash /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="sidebar-resizer" onMouseDown={startResize} title="Drag to resize" />
        </aside>

        <main className="main">
          {error && (
            <div className={`banner ${isSetup ? 'setup' : ''}`}>
              <IconAlert size={16} />
              <span>{isSetup ? (<><b>Database not connected yet.</b> Connect a Postgres database in Vercel and redeploy.</>) : error}</span>
            </div>
          )}

          {globalView === 'ideas' ? (
            <SuggestionsView
              suggestions={data.suggestions}
              users={data.users}
              onAdd={addSuggestion}
              onPatch={patchSuggestion}
              onDelete={deleteSuggestion}
              onVote={voteSuggestion}
            />
          ) : globalView === 'bracket' ? (
            <BracketView
              brackets={data.brackets}
              entrants={data.bentrants}
              matches={data.bmatches}
              votes={data.bvotes}
              users={data.users}
              me={currentUser}
              onVote={castVote}
              onDeclare={declareWinner}
              onUndo={undoWinner}
              onCreate={createBracket}
              onPatch={patchBracket}
              onRenameEntrant={renameEntrant}
              onDeletePast={deleteBracket}
              onFetchPast={(id) => api(`/api/brackets/${id}`)}
              onSetAvatar={setAvatar}
            />
          ) : globalView === 'geo' ? (
            <GeoPage
              // Archived offices stay on the GeoGuessr page — once an office
              // plays, its column (and its scores) never disappear.
              offices={[...data.offices].filter((o) => o.geo_on !== false).sort(byPos)}
              available={activeOffices.filter((o) => o.geo_on === false)}
              geo={data.geo}
              onAddGeo={addGeo}
              onDeleteGeo={deleteGeo}
              onFiveK={bumpFiveK}
              onJoin={joinGeo}
              onCreate={createGeoOffice}
            />
          ) : globalView ? (
            <GlobalTasks
              tasks={globalTasks}
              people={data.people}
              projects={data.projects}
              onUpdate={updateTask}
              onOpenProject={(id) => { setGlobalView(false); setTeamView(null); setOfficeView(null); setSelected(id); }}
            />
          ) : viewedOffice ? (
            <OfficeView
              office={viewedOffice}
              meetings={data.meetings.filter((m) => String(m.office_id) === String(viewedOffice.id))}
              expandedMeetings={expandedMeetings}
              onToggleMeeting={toggleMeeting}
              onAddMeeting={() => addMeeting(viewedOffice.id)}
              onUpdateMeeting={updateMeeting}
              onDeleteMeeting={deleteMeeting}
            />
          ) : viewedTeam ? (
            <TeamOverview
              team={viewedTeam}
              offices={activeOffices}
              people={data.people}
              projects={data.projects.filter((p) => String(p.team_id) === String(viewedTeam.id) && !p.archived).sort(byName)}
              tasks={data.tasks}
              onOpen={(id) => { setSelected(id); setTeamView(null); }}
              onAddProject={() => addProject(viewedTeam.id)}
              onSaveNotes={saveProjectNotes}
              onMoveOffice={(officeId) => moveTeamToOffice(viewedTeam.id, officeId)}
              onAddTask={(projectId) => setAddingTaskFor(projectId)}
              onMarkDone={(id) => { const t = data.tasks.find((x) => String(x.id) === String(id)); updateTask(id, t && t.parent_id ? { status: 'done' } : { status: 'done', archived: true }); }}
            />
          ) : project ? (
            <>
              <div className="proj-head">
                <h1>{project.name}</h1>
                <div className="progress" title={`${pct}% done`}><span style={{ width: `${pct}%` }} /></div>
                <span className="progress-label">{doneCount}/{topTasks.length} done</span>
                <label className="team-select-wrap">Team
                  <select className="team-select" value={project.team_id ?? ''} onChange={(e) => moveProject(project.id, e.target.value)}>
                    {[...data.teams].sort(byPos).map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
                  </select>
                </label>
                <div className="spacer" />
                <button className="btn btn-lime" onClick={addTask}>+ Add Task</button>
              </div>

              <div className="notes-panel">
                <label className="notes-label"><IconNote size={14} /> Project notes <span>· visible to your whole team</span></label>
                <SyncedTextarea
                  key={project.id}
                  className="notes-area"
                  value={project.notes || ''}
                  placeholder="Notes for this project — plans, links, reminders…"
                  onSave={(v) => saveProjectNotes(project.id, v)}
                />
              </div>

              <div className="board">
                <div className="board-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: '30%' }}>Task</th>
                        <th style={{ width: '16%' }}>Owner</th>
                        <th style={{ width: '10%', textAlign: 'center' }}>Stoplight</th>
                        <th style={{ width: '13%' }}>Due date</th>
                        <th style={{ width: '15%' }}>Status</th>
                        <th style={{ width: '8%', textAlign: 'center' }}>Added</th>
                        <th style={{ width: '8%' }} />
                      </tr>
                    </thead>
                    <tbody>
                      {tasks.map((t) => renderTaskRow(t, false))}
                      {!tasks.length && (
                        <tr><td colSpan={7} style={{ padding: 28, textAlign: 'center', color: '#8a8788' }}>No tasks yet — add your first one.</td></tr>
                      )}
                      <tr><td colSpan={7} style={{ padding: 0 }}>
                        <button className="add-task-btn" onClick={addTask}>+ Add task</button>
                      </td></tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {archivedTasks.length > 0 && (
                <div className="archive">
                  <button className="archive-toggle" onClick={() => setShowArchived((s) => !s)}>
                    <IconArchive size={15} /> Archived ({archivedTasks.length}) {showArchived ? '▲' : '▼'}
                  </button>
                  {showArchived && (
                    <div className="board archive-board">
                      <div className="board-scroll">
                        <table>
                          <tbody>
                            {archivedTasks.map((t) => {
                              const owner = data.people.find((p) => String(p.id) === String(t.assignee_id));
                              const st = STATUSES[t.status] || STATUSES.done;
                              return (
                                <tr key={t.id} className="archived-row">
                                  <td style={{ width: '30%' }}><span className="archived-title">{t.title || 'Untitled task'}</span></td>
                                  <td style={{ width: '16%' }}>
                                    <div className="cell-owner">
                                      {owner ? (
                                        <span className="avatar" style={{ background: owner.color }}>{initials(owner.name)}</span>
                                      ) : (
                                        <span className="avatar" style={{ background: '#dcdcdc', color: '#8a8788' }}>–</span>
                                      )}
                                      <span className="archived-owner">{owner ? owner.name : 'Unassigned'}</span>
                                    </div>
                                  </td>
                                  <td style={{ width: '10%' }}>
                                    {t.stoplight && STOPLIGHTS[t.stoplight]
                                      ? <span className="sl-dot on" style={{ '--sl': STOPLIGHTS[t.stoplight] }} />
                                      : <span style={{ color: '#c4c4c4' }}>—</span>}
                                  </td>
                                  <td style={{ width: '13%' }} className="archived-due">{t.due_date || '—'}</td>
                                  <td style={{ width: '15%' }}>
                                    <span className="status-pill" style={{ background: st.color, color: t.status === 'not_started' ? '#3a3a3a' : '#fff' }}>{st.label}</span>
                                  </td>
                                  <td style={{ width: '8%', textAlign: 'center' }} className="added-cell">{fmtAdded(t.created_at)}</td>
                                  <td style={{ width: '8%', whiteSpace: 'nowrap', textAlign: 'right' }}>
                                    <button className="restore-btn" title="Restore to the board" onClick={() => restoreTask(t.id)}><IconRestore size={15} /></button>
                                    <button className="row-x" title="Delete task" onClick={() => deleteTask(t.id)}>×</button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <ProjectMeetings
                project={project}
                meetings={data.pmeetings.filter((m) => String(m.project_id) === String(project.id))}
                series={data.pseries.filter((sv) => String(sv.project_id) === String(project.id))}
                expanded={expandedPMeetings}
                onToggle={togglePMeeting}
                onAddMeeting={(seriesId) => addPMeeting(project.id, seriesId)}
                onAddSeries={() => addPSeries(project.id)}
                onUpdateMeeting={updatePMeeting}
                onDeleteMeeting={deletePMeeting}
                onRenameSeries={renamePSeries}
                onDeleteSeries={deletePSeries}
              />

              <div className="info-panel">
                <div className="info-head">
                  <label className="notes-label"><IconPaperclip size={14} /> Additional project info <span>· links, documents &amp; references</span></label>
                  <button className="btn btn-lime btn-sm" onClick={addInfo}>+ Add row</button>
                </div>
                {infoRows.length > 0 && (
                  <div className="info-table">
                    <div className="info-row info-row-head">
                      <div>Item</div>
                      <div>Info / link</div>
                      <div />
                    </div>
                    {infoRows.map((r) => (
                      <div key={r.id} className="info-row">
                        <SyncedField
                          className="info-input"
                          value={r.label}
                          placeholder="Item name"
                          onSave={(v) => updateInfo(r.id, { label: v })}
                        />
                        <div className="info-value-cell">
                          <SyncedField
                            className="info-input"
                            value={r.value}
                            placeholder="Type info, a web link, or a file path…"
                            onSave={(v) => updateInfo(r.id, { value: v })}
                          />
                          {isWebUrl(r.value) && (
                            <a className="info-action" href={r.value} target="_blank" rel="noopener noreferrer" title="Open link in a new tab">Open <IconExternal size={12} /></a>
                          )}
                          {!isWebUrl(r.value) && isFilePath(r.value) && (
                            <button className="info-action" title="Copy path — paste into File Explorer's address bar" onClick={async (e) => { const ok = await copyText(r.value); const b = e.currentTarget; if (ok) { b.textContent = 'Copied!'; setTimeout(() => { b.textContent = 'Copy'; }, 1200); } }}>Copy</button>
                          )}
                        </div>
                        <button className="row-x info-del" title="Delete row" onClick={() => deleteInfo(r.id)}>×</button>
                      </div>
                    ))}
                  </div>
                )}
                {infoRows.length === 0 && (
                  <p className="info-empty">Nothing here yet — add rows for document links, permit numbers, file paths, contacts, etc.</p>
                )}
                <p className="info-hint">Web links (http/https) become clickable and open in a new tab. Local/network paths (<code>C:\…</code> or <code>\\server\…</code>) can’t be clickable from a website — use <b>Copy</b> and paste into File Explorer’s address bar.</p>
              </div>
            </>
          ) : (
            loaded && !error && (
              <div className="empty">
                {data.offices.length === 0 ? (
                  <>
                    <h3>Create your first office</h3>
                    <p>Offices hold teams, and teams hold projects. Start by adding an office.</p>
                    <button className="btn btn-lime" onClick={addOffice}>+ New Office</button>
                  </>
                ) : (
                  <>
                    <h3>Pick a project or team</h3>
                    <p>In the sidebar, click a project to open its board, or a team name to see its overview.</p>
                  </>
                )}
              </div>
            )
          )}
        </main>
      </div>

      {peopleOpen && (
        <PeopleModal people={data.people} onAdd={addPerson} onUpdate={updatePerson} onDelete={deletePerson} onClose={() => setPeopleOpen(false)} />
      )}
      {addingTaskFor && (
        <AddTaskModal people={data.people} onCreate={createTaskWithOwner} onClose={() => setAddingTaskFor(null)} />
      )}
    </>
  );
}

function ProjectMeetings({ project, meetings, series, expanded, onToggle, onAddMeeting, onAddSeries, onUpdateMeeting, onDeleteMeeting, onRenameSeries, onDeleteSeries }) {
  const standalone = meetings.filter((m) => !m.series_id).sort(byPos);
  const renderMeeting = (m) => {
    const open = !!expanded[m.id];
    return (
      <div key={m.id} className="pm">
        <div className="pm-head">
          <button className="team-caret" onClick={() => onToggle(m.id)} aria-label="Toggle meeting">{open ? '▾' : '▸'}</button>
          {m.series_id ? (
            <>
              <input type="date" className="date-input pm-date-series" value={m.meeting_date || ''} onChange={(e) => onUpdateMeeting(m.id, { meeting_date: e.target.value || null })} />
              <div className="spacer" />
            </>
          ) : (
            <>
              <SyncedField className="pm-title" value={m.title} onSave={(v) => onUpdateMeeting(m.id, { title: v })} />
              <input type="date" className="date-input pm-date" value={m.meeting_date || ''} onChange={(e) => onUpdateMeeting(m.id, { meeting_date: e.target.value || null })} />
            </>
          )}
          <button className="row-icon danger" title="Delete meeting" onClick={() => onDeleteMeeting(m)}><IconTrash /></button>
        </div>
        {open && (
          <div className="pm-body">
            <label className="pm-label">Attendance</label>
            <SyncedField className="pm-attendance" value={m.attendance || ''} placeholder="Who attended — e.g. John, Kyler, Sam" onSave={(v) => onUpdateMeeting(m.id, { attendance: v })} />
            <label className="pm-label">Notes</label>
            <SyncedTextarea className="pm-notes" value={m.notes || ''} placeholder="Meeting notes — agenda, decisions, action items…" onSave={(v) => onUpdateMeeting(m.id, { notes: v })} />
          </div>
        )}
      </div>
    );
  };
  const hasAny = meetings.length > 0 || series.length > 0;
  return (
    <div className="info-panel">
      <div className="section-head">
        <label className="notes-label"><IconCalendar size={14} /> Meetings</label>
        <div className="pm-actions">
          <button className="btn btn-lime btn-sm" onClick={() => onAddMeeting()}>+ Meeting</button>
          <button className="btn btn-plain btn-sm" onClick={onAddSeries}>+ Meeting series</button>
        </div>
      </div>
      {!hasAny && <p className="ov-empty">No meetings yet — create a one-off meeting or a series.</p>}
      {standalone.map(renderMeeting)}
      {[...series].sort(byPos).map((sv) => {
        const sm = meetings.filter((m) => String(m.series_id) === String(sv.id)).sort(byPos);
        return (
          <div key={sv.id} className="pm-series">
            <div className="pm-series-head">
              <span className="pm-series-name"><IconFolder size={14} /> {sv.name}</span>
              <div className="spacer" />
              <button className="btn btn-plain btn-xs" onClick={() => onAddMeeting(sv.id)}>+ Add meeting</button>
              <button className="row-icon" title="Rename series" onClick={() => onRenameSeries(sv)}><IconPencil size={14} /></button>
              <button className="row-icon danger" title="Delete series" onClick={() => onDeleteSeries(sv)}><IconTrash /></button>
            </div>
            {sm.length === 0 && <p className="pm-series-empty">No meetings in this series yet.</p>}
            {sm.map(renderMeeting)}
          </div>
        );
      })}
    </div>
  );
}

function OfficeView({ office, meetings, expandedMeetings, onToggleMeeting, onAddMeeting, onUpdateMeeting, onDeleteMeeting }) {
  return (
    <>
      <div className="proj-head">
        <h1 className="wi-h"><IconBuilding size={24} /> {office.name}</h1>
      </div>
      <div className="office-single">
        <div className="office-section">
          <div className="section-head">
            <h2 className="section-title">Meetings</h2>
            <button className="btn btn-lime btn-sm" onClick={onAddMeeting}>+ New meeting</button>
          </div>
          {meetings.length === 0 && <p className="ov-empty">No meetings yet — add one to start taking minutes.</p>}
          {meetings.map((m) => {
            const open = !!expandedMeetings[m.id];
            return (
              <div key={m.id} className="meeting">
                <div className="meeting-head">
                  <button className="team-caret" onClick={() => onToggleMeeting(m.id)} aria-label="Toggle minutes">{open ? '▾' : '▸'}</button>
                  <SyncedField className="meeting-title" value={m.title} onSave={(v) => onUpdateMeeting(m.id, { title: v })} />
                  <input type="date" className="date-input meeting-date" value={m.meeting_date || ''} onChange={(e) => onUpdateMeeting(m.id, { meeting_date: e.target.value || null })} />
                  <button className="row-icon danger" title="Delete meeting" onClick={() => onDeleteMeeting(m)}><IconTrash /></button>
                </div>
                {open && (
                  <SyncedTextarea
                    className="meeting-minutes"
                    value={m.minutes || ''}
                    placeholder="Meeting minutes — attendees, agenda, decisions, action items…"
                    onSave={(v) => onUpdateMeeting(m.id, { minutes: v })}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// Every GeoGuessr office side by side, each with its full tracker.
function GeoPage({ offices, available, geo, onAddGeo, onDeleteGeo, onFiveK, onJoin, onCreate }) {
  const [adding, setAdding] = useState(false);
  return (
    <>
      <div className="proj-head">
        <h1 className="wi-h"><IconGlobe size={24} /> Daily GeoGuessr</h1>
        <button className="btn btn-lime btn-sm" onClick={() => setAdding(true)}>+ Add office</button>
      </div>
      {offices.length === 0 && <p className="geo-page-empty">No offices are playing yet — hit “+ Add office” to start tracking scores.</p>}
      <div className="geo-page">
        {offices.map((o) => (
          <section key={o.id} className="office-section geo-office">
            <div className="section-head">
              <h2 className="geo-office-name">{o.name}</h2>
            </div>
            <FiveKCounter count={Number(o.fivek) || 0} onChange={(delta) => onFiveK(o.id, delta)} />
            <GeoTracker
              scores={geo.filter((g) => String(g.office_id) === String(o.id))}
              onAdd={(score, date) => onAddGeo(o.id, score, date)}
              onDelete={onDeleteGeo}
            />
          </section>
        ))}
      </div>
      {adding && <AddGeoOfficeModal available={available} onJoin={onJoin} onCreate={onCreate} onClose={() => setAdding(false)} />}
    </>
  );
}

function AddGeoOfficeModal({ available, onJoin, onCreate, onClose }) {
  const [name, setName] = useState('');
  const create = () => { const n = name.trim(); if (!n) return; onCreate(n); onClose(); };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal add-task-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add an office to GeoGuessr</h2>
        {available.length > 0 && (
          <>
            <label className="atm-label">Existing offices</label>
            {available.map((o) => (
              <div key={o.id} className="geo-avail-row">
                <span>{o.name}</span>
                <button className="btn btn-plain btn-sm" onClick={() => { onJoin(o); onClose(); }}>Add</button>
              </div>
            ))}
          </>
        )}
        <label className="atm-label">{available.length ? 'Or create a new office' : 'New office name'}</label>
        <input
          className="field"
          autoFocus
          placeholder="e.g. Raleigh"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
        />
        <p className="geo-modal-note">New offices also appear in the sidebar, so they can use the rest of TeamBoard too.</p>
        <div className="modal-actions">
          <button className="btn btn-plain" onClick={onClose}>Cancel</button>
          <button className="btn btn-ink" onClick={create} disabled={!name.trim()}>Create office</button>
        </div>
      </div>
    </div>
  );
}

// Big celebratory tally of perfect 5,000-point guesses. Tap to add one (with a
// little burst); "Undo one" takes it back if someone hits it by accident.
function FiveKCounter({ count, onChange }) {
  const [burst, setBurst] = useState(0);
  const hit = () => { onChange(1); setBurst((b) => b + 1); };
  return (
    <div className="fivek">
      <div className="fivek-stage">
        <button type="button" className="fivek-btn" onClick={hit} title="Nailed a 5,000? Tap to add one!">
          <span className="fivek-shine" aria-hidden />
          <span className="fivek-top"><IconStar /> 5K Club <IconStar /></span>
          <span key={burst} className={`fivek-count${burst ? ' pop' : ''}`}>{count.toLocaleString()}</span>
          <span className="fivek-sub">perfect 5,000s — tap when you nail one!</span>
        </button>
        {burst > 0 && (
          <div key={burst} className="fivek-burst" aria-hidden>
            {Array.from({ length: 14 }, (_, i) => (
              <i key={i} style={{ '--a': `${(360 / 14) * i}deg`, '--d': `${80 + (i % 3) * 26}px` }} />
            ))}
            <b>+1</b>
          </div>
        )}
      </div>
      <div className="fivek-foot">
        <button type="button" className="fivek-undo" onClick={() => onChange(-1)} disabled={count <= 0} title="Pressed it by accident? Take one back">− Undo one</button>
      </div>
    </div>
  );
}

// Summary stats for GeoGuessr scores. "Work week" = Monday–Friday; weekly
// averages group weekday scores by the Monday of their week.
function geoStats(scores) {
  const vals = scores.map((s) => Number(s.score)).filter((v) => !isNaN(v));
  if (!vals.length) return null;
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const high = Math.max(...vals);
  const low = Math.min(...vals);
  const mean = sum(vals) / vals.length;

  const parseLocal = (s) => { const p = String(s).split('-').map(Number); return new Date(p[0], (p[1] || 1) - 1, p[2] || 1); };
  const fmtLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const mondayOf = (d) => { const dow = d.getDay(); const diff = dow === 0 ? 6 : dow - 1; const m = new Date(d); m.setDate(d.getDate() - diff); return m; };

  const weeks = {};
  scores.forEach((s) => {
    const v = Number(s.score);
    if (isNaN(v) || !s.score_date) return;
    const d = parseLocal(s.score_date);
    if (isNaN(d.getTime())) return;
    const dow = d.getDay();
    if (dow === 0 || dow === 6) return; // work week = Mon–Fri only
    const key = fmtLocal(mondayOf(d));
    (weeks[key] = weeks[key] || []).push(v);
  });
  const avgs = Object.values(weeks).map((arr) => sum(arr) / arr.length);
  const bestWeek = avgs.length ? Math.max(...avgs) : null;
  const worstWeek = avgs.length ? Math.min(...avgs) : null;
  const curKey = fmtLocal(mondayOf(new Date()));
  const currentWeek = weeks[curKey] ? sum(weeks[curKey]) / weeks[curKey].length : null;

  return { high, low, mean, bestWeek, worstWeek, currentWeek };
}

// Work-week (Mon–Fri) averages, keyed by the Monday of each week.
function weeklyAverages(scores) {
  const parse = (s) => { const p = String(s).split('-').map(Number); return new Date(p[0], (p[1] || 1) - 1, p[2] || 1); };
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const monday = (d) => { const dow = d.getDay(); const diff = dow === 0 ? 6 : dow - 1; const m = new Date(d); m.setDate(d.getDate() - diff); return m; };
  const weeks = {};
  scores.forEach((s) => {
    const v = Number(s.score);
    if (isNaN(v) || !s.score_date) return;
    const d = parse(s.score_date);
    if (isNaN(d.getTime())) return;
    const dow = d.getDay();
    if (dow === 0 || dow === 6) return;
    const key = fmt(monday(d));
    (weeks[key] = weeks[key] || []).push(v);
  });
  return Object.keys(weeks).sort().map((k) => ({ id: 'w' + k, score: Math.round(weeks[k].reduce((a, b) => a + b, 0) / weeks[k].length), score_date: k }));
}

// Calendar-month averages, keyed by YYYY-MM.
function monthlyAverages(scores) {
  const months = {};
  scores.forEach((s) => {
    const v = Number(s.score);
    if (isNaN(v) || !s.score_date) return;
    const key = String(s.score_date).slice(0, 7);
    (months[key] = months[key] || []).push(v);
  });
  return Object.keys(months).sort().map((k) => ({ id: 'm' + k, score: Math.round(months[k].reduce((a, b) => a + b, 0) / months[k].length), score_date: k }));
}

function GeoTracker({ scores, onAdd, onDelete }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [val, setVal] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const submit = () => { const n = parseInt(val, 10); if (isNaN(n)) return; onAdd(n, date); setVal(''); };
  const sorted = [...scores].sort((a, b) => (a.score_date || '').localeCompare(b.score_date || '') || (Number(a.id) - Number(b.id)));
  const weekly = weeklyAverages(scores);
  const monthly = monthlyAverages(scores);
  const stats = geoStats(scores);
  const fmt = (v) => (v == null ? '—' : Math.round(v).toLocaleString());
  return (
    <>
      <div className="geo-add">
        <input type="date" className="date-input" value={date} onChange={(e) => setDate(e.target.value)} />
        <input type="number" className="geo-input" placeholder="Score" value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
        <button className="btn btn-ink btn-sm" onClick={submit}>+ Add</button>
      </div>
      <div className="geo-chart-title">Daily scores</div>
      <GeoChart data={sorted} />
      <div className="geo-chart-title">Weekly average <span>(Mon–Fri)</span></div>
      <GeoChart data={weekly} />
      <div className="geo-chart-title">Monthly average</div>
      <GeoChart data={monthly} />
      <div className="geo-legend">
        {[...GEO_TIERS].reverse().map((t) => (
          <span key={t.label} className="geo-leg"><i style={{ background: t.color }} />{t.label}</span>
        ))}
      </div>
      {stats && (
        <div className="geo-stats">
          <div className="geo-stat"><span className="gs-label">High</span><span className="gs-val">{fmt(stats.high)}</span></div>
          <div className="geo-stat"><span className="gs-label">Low</span><span className="gs-val">{fmt(stats.low)}</span></div>
          <div className="geo-stat"><span className="gs-label">All-time avg</span><span className="gs-val">{fmt(stats.mean)}</span></div>
          <div className="geo-stat"><span className="gs-label">This week avg</span><span className="gs-val">{fmt(stats.currentWeek)}</span></div>
          <div className="geo-stat"><span className="gs-label">Best week avg</span><span className="gs-val">{fmt(stats.bestWeek)}</span></div>
          <div className="geo-stat"><span className="gs-label">Worst week avg</span><span className="gs-val">{fmt(stats.worstWeek)}</span></div>
        </div>
      )}
      {sorted.length > 0 && (
        <div className="geo-history">
          <button className="geo-history-toggle" onClick={() => setShowHistory((s) => !s)}>
            {showHistory ? '▾' : '▸'} Score history ({sorted.length})
          </button>
          {showHistory && (
            <div className="geo-list">
              {[...sorted].reverse().map((s) => (
                <div key={s.id} className="geo-row">
                  <span className="geo-date">{s.score_date || '—'}</span>
                  <span className="geo-score">{Number(s.score).toLocaleString()}</span>
                  <button className="row-x" title="Delete" onClick={() => onDelete(s.id)}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

// GeoGuessr medal tiers by score.
const GEO_TIERS = [
  { min: 25000, color: '#3ad0e0', label: 'Diamond' }, // 25000
  { min: 22500, color: '#e0a800', label: 'Gold' },    // 22500–24999
  { min: 15000, color: '#9aa4ad', label: 'Silver' },  // 15000–22499
  { min: 5000, color: '#cd7f32', label: 'Bronze' },   // 5000–14999
  { min: 0, color: '#2f2e2e', label: 'Black' },       // 0–4999
];
function tierColor(v) {
  for (const t of GEO_TIERS) { if (v >= t.min) return t.color; }
  return '#2f2e2e';
}

function GeoChart({ data }) {
  if (!data.length) return <div className="geo-chart-empty">Add a score to start the graph.</div>;
  const W = 520, H = 210;
  const pad = { l: 48, r: 14, t: 14, b: 30 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const scores = data.map((d) => Number(d.score));
  const yMin = 0;
  const yMax = Math.max(25000, ...scores);
  const n = data.length;
  const band = iw / n;
  const barW = Math.max(2, Math.min(38, band * 0.72));
  const y = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin || 1)) * ih;
  const yTicks = [0, 12500, 25000];
  const fmt = (v) => Math.round(v).toLocaleString();
  const baseline = pad.t + ih;
  return (
    <div className="geo-chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="geo-chart" preserveAspectRatio="xMidYMid meet">
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} y1={y(t)} x2={W - pad.r} y2={y(t)} stroke="#ecedee" strokeWidth="1" />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" className="geo-axis">{fmt(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const v = Number(d.score);
          const cx = pad.l + band * i + band / 2;
          const top = y(v);
          return (
            <rect key={d.id} x={cx - barW / 2} y={top} width={barW} height={Math.max(0, baseline - top)} rx="2" fill={tierColor(v)}>
              <title>{d.score_date || ''}: {v.toLocaleString()}</title>
            </rect>
          );
        })}
        <text x={pad.l} y={H - 8} textAnchor="start" className="geo-axis">{data[0].score_date || ''}</text>
        {n > 1 && <text x={W - pad.r} y={H - 8} textAnchor="end" className="geo-axis">{data[n - 1].score_date || ''}</text>}
      </svg>
    </div>
  );
}

function GlobalTasks({ tasks, people, projects, onUpdate, onOpenProject }) {
  const [fOwner, setFOwner] = useState('all');
  const [fLight, setFLight] = useState('all');
  const [fStatus, setFStatus] = useState('all');
  const [sortBy, setSortBy] = useState('due');
  const [sortDir, setSortDir] = useState('asc');

  const projName = (id) => projects.find((p) => String(p.id) === String(id))?.name || '—';
  const personName = (id) => people.find((p) => String(p.id) === String(id))?.name || '';

  let rows = tasks.filter((t) => {
    if (fOwner === 'none' && t.assignee_id) return false;
    if (fOwner !== 'all' && fOwner !== 'none' && String(t.assignee_id) !== String(fOwner)) return false;
    if (fLight === 'none' && t.stoplight) return false;
    if (fLight !== 'all' && fLight !== 'none' && t.stoplight !== fLight) return false;
    if (fStatus !== 'all' && t.status !== fStatus) return false;
    return true;
  });

  const slRank = { red: 0, yellow: 1, green: 2, '': 3 };
  const cmp = {
    project: (a, b) => projName(a.project_id).localeCompare(projName(b.project_id), undefined, { numeric: true }),
    task: (a, b) => (a.title || '').localeCompare(b.title || ''),
    owner: (a, b) => (personName(a.assignee_id) || 'zzzz').localeCompare(personName(b.assignee_id) || 'zzzz'),
    stoplight: (a, b) => (slRank[a.stoplight || ''] - slRank[b.stoplight || '']),
    due: (a, b) => (a.due_date || '9999-99-99').localeCompare(b.due_date || '9999-99-99'),
    status: (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status),
    added: (a, b) => (new Date(a.created_at || 0) - new Date(b.created_at || 0)),
  };
  rows = [...rows].sort((a, b) => { const c = (cmp[sortBy] || cmp.due)(a, b); return sortDir === 'asc' ? c : -c; });

  const setSort = (col) => {
    if (sortBy === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(col); setSortDir('asc'); }
  };
  const arrow = (col) => (sortBy === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  return (
    <>
      <div className="proj-head">
        <h1>All Tasks</h1>
        <span className="progress-label">{rows.length} task{rows.length !== 1 ? 's' : ''} across all projects</span>
      </div>
      <div className="filters">
        <label>Person
          <select value={fOwner} onChange={(e) => setFOwner(e.target.value)}>
            <option value="all">Everyone</option>
            <option value="none">Unassigned</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label>Stoplight
          <select value={fLight} onChange={(e) => setFLight(e.target.value)}>
            <option value="all">Any</option>
            <option value="red">Red</option>
            <option value="yellow">Yellow</option>
            <option value="green">Green</option>
            <option value="none">None</option>
          </select>
        </label>
        <label>Status
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            <option value="all">Any</option>
            {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUSES[s].label}</option>)}
          </select>
        </label>
      </div>
      <div className="board">
        <div className="board-scroll">
          <table>
            <thead>
              <tr>
                <th style={{ width: '19%' }} className="sortable" onClick={() => setSort('project')}>Project{arrow('project')}</th>
                <th style={{ width: '24%' }} className="sortable" onClick={() => setSort('task')}>Task{arrow('task')}</th>
                <th style={{ width: '15%' }} className="sortable" onClick={() => setSort('owner')}>Owner{arrow('owner')}</th>
                <th style={{ width: '10%', textAlign: 'center' }} className="sortable" onClick={() => setSort('stoplight')}>Stoplight{arrow('stoplight')}</th>
                <th style={{ width: '11%' }} className="sortable" onClick={() => setSort('due')}>Due{arrow('due')}</th>
                <th style={{ width: '13%' }} className="sortable" onClick={() => setSort('status')}>Status{arrow('status')}</th>
                <th style={{ width: '8%', textAlign: 'center' }} className="sortable" onClick={() => setSort('added')}>Added{arrow('added')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const owner = people.find((p) => String(p.id) === String(t.assignee_id));
                const st = STATUSES[t.status] || STATUSES.not_started;
                return (
                  <tr key={t.id}>
                    <td><button className="proj-link" onClick={() => onOpenProject(t.project_id)} title="Open this project">{projName(t.project_id)}</button></td>
                    <td>{t.parent_id ? <span className="subtask-arrow">↳ </span> : null}<span className="gt-title">{t.title || 'Untitled task'}</span></td>
                    <td>
                      <div className="cell-owner">
                        {owner ? (
                          <span className="avatar" style={{ background: owner.color }}>{initials(owner.name)}</span>
                        ) : (
                          <span className="avatar" style={{ background: '#dcdcdc', color: '#8a8788' }}>–</span>
                        )}
                        <select className="owner-select" value={t.assignee_id ?? ''} onChange={(e) => onUpdate(t.id, { assignee_id: e.target.value || null })}>
                          <option value="">Unassigned</option>
                          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </div>
                    </td>
                    <td>
                      <div className="stoplight">
                        {t.stoplight && STOPLIGHTS[t.stoplight] ? (
                          <button type="button" className="sl-dot on solo" style={{ '--sl': STOPLIGHTS[t.stoplight] }} title="Click to clear priority" onClick={() => onUpdate(t.id, { stoplight: '' })} />
                        ) : (
                          STOPLIGHT_ORDER.map((c) => (
                            <button key={c} type="button" className="sl-dot" style={{ '--sl': STOPLIGHTS[c] }} onClick={() => onUpdate(t.id, { stoplight: c })} />
                          ))
                        )}
                      </div>
                    </td>
                    <td>
                      <input type="date" className="date-input" value={t.due_date ?? ''} onChange={(e) => onUpdate(t.id, { due_date: e.target.value || null })} />
                    </td>
                    <td>
                      <select
                        className="status-select"
                        value={t.status}
                        style={{ background: '#fff', color: st.text, borderColor: st.color }}
                        onChange={(e) => { const v = e.target.value; onUpdate(t.id, v === 'done' ? { status: 'done', archived: true } : { status: v }); }}
                      >
                        {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUSES[s].label}</option>)}
                      </select>
                    </td>
                    <td className="added-cell" title={t.created_at ? `Added ${new Date(t.created_at).toLocaleString()}` : ''}>{fmtAdded(t.created_at)}</td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr><td colSpan={7} style={{ padding: 28, textAlign: 'center', color: '#8a8788' }}>No tasks match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function TeamOverview({ team, offices, people, projects, tasks, onOpen, onAddProject, onSaveNotes, onMoveOffice, onAddTask, onMarkDone }) {
  const [menuFor, setMenuFor] = useState(null);
  const ownerOf = (id) => people.find((pp) => String(pp.id) === String(id));
  const renderOwner = (owner) => (owner
    ? <span className="ov-owner"><span className="avatar xs" style={{ background: owner.color }}>{initials(owner.name)}</span>{owner.name}</span>
    : <span className="ov-owner ov-unassigned">Unassigned</span>);
  return (
    <>
      <div className="proj-head">
        <h1>{team.name}</h1>
        <span className="progress-label">{projects.length} project{projects.length !== 1 ? 's' : ''}</span>
        <label className="team-select-wrap">Office
          <select className="team-select" value={team.office_id ?? ''} onChange={(e) => onMoveOffice(e.target.value)}>
            {offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <div className="spacer" />
        <button className="btn btn-lime" onClick={onAddProject}>+ Add Project</button>
      </div>
      {projects.length === 0 ? (
        <div className="empty">
          <h3>No projects in this team yet</h3>
          <p>Click “+ Add Project” to create one.</p>
        </div>
      ) : (
        <div className="overview-grid">
          {projects.map((p) => {
            const projTop = tasks.filter((t) => String(t.project_id) === String(p.id) && !t.archived && !t.parent_id).sort(byPos);
            const count = projTop.length;
            return (
              <div key={p.id} className="overview-card">
                <div className="overview-card-head">
                  <button className="overview-open" onClick={() => onOpen(p.id)}>{p.name}</button>
                  <span className="count">{count} task{count !== 1 ? 's' : ''}</span>
                </div>
                <SyncedTextarea
                  key={p.id}
                  className="overview-notes"
                  value={p.notes || ''}
                  placeholder="Project notes…"
                  onSave={(v) => onSaveNotes(p.id, v)}
                />
                <div className="ov-tasks">
                  {projTop.length === 0 && <div className="ov-empty">No tasks yet.</div>}
                  {projTop.map((t) => {
                    const subs = tasks.filter((x) => String(x.parent_id) === String(t.id) && !x.archived).sort(byPos);
                    return (
                      <div key={t.id} className="ov-task" style={{ borderLeftColor: t.stoplight && STOPLIGHTS[t.stoplight] ? STOPLIGHTS[t.stoplight] : 'transparent' }}>
                        <div className="ov-task-row" onClick={() => setMenuFor(menuFor === t.id ? null : t.id)} title="Click for options">
                          <span className="ov-task-title">{t.title || 'Untitled task'}</span>
                          {renderOwner(ownerOf(t.assignee_id))}
                        </div>
                        {menuFor === t.id && (
                          <div className="ov-menu">
                            <button className="ov-menu-btn" onClick={() => { setMenuFor(null); onOpen(p.id); }}>View task</button>
                            <button className="ov-menu-btn ov-menu-done" onClick={() => { setMenuFor(null); onMarkDone(t.id); }}>✓ Mark done</button>
                          </div>
                        )}
                        {subs.map((s) => (
                          <Fragment key={s.id}>
                            <div className="ov-sub ov-sub-click" onClick={() => setMenuFor(menuFor === s.id ? null : s.id)} title="Click for options">
                              <span className="ov-sub-title">↳ {s.title || 'Untitled subtask'}</span>
                              {renderOwner(ownerOf(s.assignee_id))}
                            </div>
                            {menuFor === s.id && (
                              <div className="ov-menu ov-menu-sub">
                                <button className="ov-menu-btn" onClick={() => { setMenuFor(null); onOpen(p.id); }}>View task</button>
                                <button className="ov-menu-btn ov-menu-done" onClick={() => { setMenuFor(null); onMarkDone(s.id); }}>✓ Mark done</button>
                              </div>
                            )}
                          </Fragment>
                        ))}
                      </div>
                    );
                  })}
                  <button className="ov-add" onClick={() => onAddTask(p.id)}>+ Add task</button>
                </div>
                <button className="overview-open-link" onClick={() => onOpen(p.id)}>Open board →</button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function AddTaskModal({ people, onCreate, onClose }) {
  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  const submit = () => { const n = name.trim(); if (!n) return; onCreate(n, owner || null); };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal add-task-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add task</h2>
        <label className="atm-label">Task name</label>
        <input
          className="field"
          autoFocus
          placeholder="What needs doing?"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        />
        <label className="atm-label">Who’s responsible?</label>
        <select className="field" value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">Unassigned</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div className="modal-actions">
          <button className="btn btn-plain" onClick={onClose}>Cancel</button>
          <button className="btn btn-ink" onClick={submit}>Add task</button>
        </div>
      </div>
    </div>
  );
}

function PeopleModal({ people, onAdd, onUpdate, onDelete, onClose }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(PERSON_COLORS[0]);

  const submit = async () => {
    const n = name.trim();
    if (!n) return;
    await onAdd(n, color);
    setName('');
    setColor(PERSON_COLORS[Math.floor(Math.random() * PERSON_COLORS.length)]);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Team members</h2>
        {people.map((p) => (
          <div key={p.id} className="person-row">
            <span className="avatar" style={{ background: p.color }}>{initials(p.name)}</span>
            <SyncedField
              className="person-name-input"
              value={p.name}
              onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
              onSave={(v) => { const n = v.trim(); if (!n) return false; onUpdate(p.id, { name: n }); return true; }}
            />
            <ColorControl value={p.color} onChange={(c) => onUpdate(p.id, { color: c })} />
            <button className="link-x" title="Remove" onClick={() => onDelete(p.id)}>×</button>
          </div>
        ))}
        {!people.length && <p style={{ color: '#8a8788', fontSize: 13 }}>No team members yet. Add someone below.</p>}

        <div className="add-person">
          <label className="add-person-label">Add a person</label>
          <input className="field" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
          <div className="add-person-color">
            <ColorControl value={color} onChange={setColor} />
            <div className="swatches">
              {PERSON_COLORS.map((c) => (
                <span key={c} className={`sw ${normHex(c) === normHex(color) ? 'sel' : ''}`} style={{ background: c }} onClick={() => setColor(c)} title={c} />
              ))}
            </div>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn btn-plain" onClick={onClose}>Close</button>
          <button className="btn btn-ink" onClick={submit}>Add person</button>
        </div>
      </div>
    </div>
  );
}
