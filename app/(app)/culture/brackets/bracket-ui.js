'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ROUNDS, nextSlot, currentRound, roundWeekday, pickWinner } from '@/lib/bracket';
import { bracketPolicy, isOrganizer, displayName } from '@/lib/policy';
import {
  IconCrown, IconTrophy, IconTrash, IconCamera, IconPencil, IconCheck, IconNote, IconRestore, IconLock, IconCalendar,
} from '@/app/icons';
import { SyncedField, SyncedTextarea } from '@/app/synced';
import { burstConfetti } from '@/app/confetti';
import { Headshot } from '@/app/_ui/Headshot';
import ConfirmDialog from '@/app/_ui/ConfirmDialog';
import ConflictNotice from '@/app/_ui/ConflictNotice';
import VoterPhotos from '@/app/_ui/VoterPhotos';
import { api, ConflictError } from '@/app/_ui/api';
import useServerState from '@/app/_ui/useServerState';
import { usePoll, useRefreshOnFocus } from '@/app/_ui/useRefresh';
import { parseRegions, fmtDay, closeLabel, fmtStart, untilText } from './format';
import CadenceNotice from './CadenceNotice';


// ---- vote bracket (one shared bracket for everyone) ----------------------
// Moved from app/bracket-ui.js (design §2.3). People vote on each matchup as whoever they're logged in as;
// their headshot appears next to the entrant they picked. Someone then declares the winner by hand (who's
// in the office changes day to day), which moves that entrant into their next-round slot.
// The pages under app/(app)/culture/brackets load the data on the server (lib/queries/brackets.js); this
// file is the UI plus the handlers that used to live in app/page.js (castVote, declareWinner, undoWinner,
// patchBracket, renameEntrant, deleteBracket, setAvatar). Who may crown, undo, edit and delete follows
// bracketPolicy (lib/policy.js): the live legacy bracket stays open to everyone (crown_policy 'anyone'),
// new brackets are run by culture organizers. The server enforces the same rules.

// The wildcard inputs say their seed: in a weekly bracket a tie goes to the better seed (design §10(c)).
const SEED_LABELS = ['1 seed', '2 seed', '3 seed', '4 seed (Wildcard)', '5 seed (Wildcard)'];
const POLL_MS = 15_000;                                    // the live bracket polls while a round is open (§7.5)
const same = (a, b) => a != null && b != null && String(a) === String(b);

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const nameOfUser = (u) => (u ? (u.name || displayName(u) || 'someone') : 'someone');

// Merge user rows (the 15 s poll sends only voters and the viewer; keep everyone else from the page load).
function mergeUsers(prev, next) {
  if (!Array.isArray(next)) return prev || [];
  const map = new Map((prev || []).map((u) => [String(u.id), u]));
  for (const u of next) map.set(String(u.id), { ...(map.get(String(u.id)) || {}), ...u });
  return [...map.values()];
}

// What an empty slot says until its feeder matchup is decided.
function placeholderFor(round, idx, side, regions) {
  if (round === 1 && side === 'b') return 'Wildcard winner';
  if (round === 3) return `${regions[idx * 2 + (side === 'a' ? 0 : 1)]} winner`;
  if (round === 4) return 'Semifinal winner';
  return 'TBD';
}

function Match({ m, ctx, placeholders }) {
  if (!m) return <div className="bk-match" />;
  const { ent, votesByMatch, usersById, meId, readOnly, editNames, onVote, onAskWin, onAskUndo, onRename, canUndo, isOpen, mayCrown, mayUndo, auto, startsOn, totals } = ctx;
  const votes = votesByMatch[String(m.id)] || [];
  const ready = !!(m.a_id && m.b_id);
  const decided = !!m.winner_id;
  // Rounds go one at a time: a matchup can be set but still waiting on the
  // rest of the round before it.
  const open = isOpen(m.round);
  const locked = !readOnly && ready && !decided && !open;
  const votable = !readOnly && !editNames && ready && !decided && open;
  const undoable = !readOnly && !editNames && decided && mayUndo && canUndo(m);
  const lockTitle = auto && startsOn ? `Opens ${roundWeekday(startsOn, m.round)}` : `Voting opens once every ${ROUNDS[Number(m.round) - 1]} matchup has a winner`;
  // Weekly brackets (Release 3): who would advance if voting closed now, by the same tie chain as the resolver.
  let lead = null;
  if (auto && votable) {
    const ea = ent[String(m.a_id)];
    const eb = ent[String(m.b_id)];
    const cnt = (id) => votes.filter((v) => same(v.entrant_id, id)).length;
    if (ea && eb) {
      const w = pickWinner(ea, eb, { [ea.id]: cnt(ea.id), [eb.id]: cnt(eb.id) }, totals || {});
      lead = { side: w.side, reason: w.reason, who: w.side === 'a' ? ea : eb };
    }
  }

  const row = (side) => {
    const eid = side === 'a' ? m.a_id : m.b_id;
    const e = eid ? ent[String(eid)] : null;
    const sv = e ? votes.filter((v) => same(v.entrant_id, eid)) : [];
    const mine = sv.some((v) => same(v.user_id, meId));
    const won = decided && same(m.winner_id, eid);
    const lost = decided && !!e && !won;
    const leading = !!lead && lead.reason === 'votes' && lead.side === side;
    const cls = ['bk-ent', votable && 'votable', mine && 'mine', won && 'won', lost && 'lost', !e && 'empty', leading && 'leading'].filter(Boolean).join(' ');
    const doVote = () => onVote(m.id, mine ? null : eid);
    const voterNames = sv.map((v) => nameOfUser(usersById[String(v.user_id)])).join(', ');
    return (
      <div
        className={cls}
        onClick={votable ? doVote : undefined}
        onKeyDown={votable ? (ev) => { if (ev.target === ev.currentTarget && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); doVote(); } } : undefined}
        role={votable ? 'button' : undefined}
        tabIndex={votable ? 0 : undefined}
        aria-pressed={votable ? mine : undefined}
        title={votable ? (mine ? 'Your vote — click to take it back' : `Vote for ${e.name}`)
          : locked ? lockTitle : undefined}
      >
        <div className="bk-line">
          {e && <span className="bk-seed">{e.seed}</span>}
          {e && editNames ? (
            <SyncedField
              className="bk-name-input"
              value={e.name}
              aria-label={`Rename ${e.name}`}
              onKeyDown={(ev) => { if (ev.key === 'Enter') ev.target.blur(); }}
              onSave={(v, base) => { const n = v.trim(); if (!n) return false; return onRename(e.id, n, base); }}
            />
          ) : (
            <span className="bk-name" title={e ? e.name : undefined}>{e ? e.name : placeholders[side]}</span>
          )}
          {leading && <span className="bk-lead">Leading</span>}
          {sv.length > 0 && <span className="bk-count" title={voterNames}>{sv.length}</span>}
          {votable && mayCrown && (
            <button type="button" className="bk-crown-btn" title={auto ? `Decide early: ${e.name} wins` : `Declare ${e.name} the winner`} aria-label={auto ? `Decide early: ${e.name} wins` : `Declare ${e.name} the winner`} onClick={(ev) => { ev.stopPropagation(); onAskWin(m, eid); }}>
              <IconCrown />
            </button>
          )}
          {won && <span className="bk-crown-won" title="Winner"><IconCrown /></span>}
          {won && undoable && (
            <button type="button" className="bk-undo-btn" title={auto ? 'Re-open this matchup' : 'Undo this result'} aria-label={auto ? 'Re-open this matchup' : 'Undo this result'} onClick={(ev) => { ev.stopPropagation(); onAskUndo(m); }}><IconRestore size={13} /></button>
          )}
        </div>
        {sv.length > 0 && (
          <div className="bk-voters">
            {sv.map((v) => <Headshot key={String(v.user_id)} user={usersById[String(v.user_id)]} size={22} />)}
          </div>
        )}
      </div>
    );
  };

  const note = auto ? (decided ? reasonText(m, ent, usersById) : lead && lead.reason !== 'votes' ? tieText(lead) : null) : null;
  return (
    <div className={`bk-match${decided ? ' decided' : ''}${votable ? ' live' : ''}${locked ? ' locked' : ''}${Number(m.round) === 4 ? ' final' : ''}`}>
      {row('a')}
      {row('b')}
      {note && <div className={`bk-reason${decided ? '' : ' tie'}`}>{note}</div>}
    </div>
  );
}

// Why a weekly bracket's matchup went the way it did (design §10(c) UI copy), from decide_reason.
function reasonText(m, ent, usersById) {
  const by = m.decided_by;
  if (by !== 'auto' && by !== 'organizer') return null;
  const aWon = same(m.winner_id, m.a_id);
  const wv = aWon ? m.a_votes : m.b_votes;
  const lv = aWon ? m.b_votes : m.a_votes;
  const w = ent[String(m.winner_id)];
  const l = ent[String(aWon ? m.b_id : m.a_id)];
  switch (m.decide_reason) {
    case 'votes': return `Advanced ${wv ?? 0}–${lv ?? 0}`;
    case 'seed': return `Tied ${wv ?? 0}–${lv ?? 0} · better seed advanced`;
    case 'total_votes': return 'Tied · more total votes';
    case 'quadrant': return w && l ? `Tied · Q${Number(w.quadrant) + 1} before Q${Number(l.quadrant) + 1}` : 'Tied';
    case 'bye': return 'Advanced';
    case 'organizer': {
      const u = m.decided_by_user ? usersById[String(m.decided_by_user)] : null;
      return `Decided early by ${u ? nameOfUser(u) : 'an organizer'}`;
    }
    default: return null;
  }
}

// A live weekly matchup that is tied: who advances if it stays that way.
function tieText(lead) {
  if (lead.reason === 'seed') return `Tied. The ${lead.who.seed} seed advances if it stays tied.`;
  if (lead.reason === 'total_votes') return `Tied. ${lead.who.name} advances if it stays tied (more votes this week).`;
  return `Tied. ${lead.who.name} advances if it stays tied (Q${Number(lead.who.quadrant) + 1}).`;
}

const noop = () => {};

export function BracketBoard({
  bracket, entrants, matches, votes, usersById, meId, readOnly, editNames, mayCrown = false, mayUndo = false,
  onVote = noop, onAskWin = noop, onAskUndo = noop, onRename = noop, onRenameRegion = noop, schedule = null,
}) {
  // Weekly auto brackets (Release 3) follow the calendar: only today's round (Central) is open. Manual ones open
  // the earliest round with an undecided matchup (one round at a time).
  const auto = bracket.mode === 'auto' && !!bracket.starts_on && schedule?.mode === 'auto';
  const regions = parseRegions(bracket.regions);
  const ent = {};
  entrants.forEach((e) => { ent[String(e.id)] = e; });
  const votesByMatch = {};
  votes.forEach((v) => { (votesByMatch[String(v.match_id)] = votesByMatch[String(v.match_id)] || []).push(v); });
  const at = (r, i) => matches.find((m) => Number(m.round) === r && Number(m.idx) === i);
  const cr = auto ? (schedule.phase === 'open' ? schedule.open_round : null) : currentRound(matches);
  const canUndo = (m) => {
    if (auto && (m.decided_by !== 'organizer' || Number(m.round) !== cr)) return false;   // past rounds are final
    const nx = nextSlot(m.round, m.idx);
    if (!nx) return true;
    const n = at(nx.round, nx.idx);
    return !n || !n.winner_id;
  };
  const isOpen = auto ? (r) => cr !== null && Number(r) === cr : (r) => cr !== null && Number(r) <= cr;
  const totals = {};
  if (auto) votes.forEach((v) => { totals[String(v.entrant_id)] = (totals[String(v.entrant_id)] || 0) + 1; });
  const ctx = {
    ent, votesByMatch, usersById, meId, readOnly, editNames, onVote, onAskWin, onAskUndo, onRename, canUndo, isOpen, mayCrown, mayUndo,
    auto, startsOn: bracket.starts_on, totals,
  };
  // Column header for a round, with a lock while it's waiting its turn.
  const head = (r, cls) => {
    const waiting = !readOnly && (auto ? schedule.phase === 'upcoming' || (cr !== null && r > cr) : cr !== null && r > cr);
    const why = auto ? `Opens ${roundWeekday(bracket.starts_on, r)}` : `Opens once the ${ROUNDS[r - 1]} is finished`;
    return (
      <div className={`bk-col-head ${cls || ''}${waiting ? ' waiting' : ''}`} title={waiting ? why : undefined}>
        {waiting && <IconLock size={11} />}{ROUNDS[r]}
      </div>
    );
  };
  const M = (r, i) => (
    <Match m={at(r, i)} ctx={ctx} placeholders={{ a: placeholderFor(r, i, 'a', regions), b: placeholderFor(r, i, 'b', regions) }} />
  );
  const champ = bracket.champion_id ? ent[String(bracket.champion_id)] : null;

  const quad = (q) => (
    <section key={q} className={`bk-quad bk-q${q}${q >= 2 ? ' mirror' : ''}`}>
      <div className="bk-quad-head">
        {editNames ? (
          <SyncedField
            className="bk-region-input"
            value={regions[q]}
            aria-label={`Quadrant ${q + 1} name`}
            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
            onSave={(v) => { const n = v.trim(); if (!n) return false; return onRenameRegion(q, n); }}
          />
        ) : (
          <h3>{regions[q]}</h3>
        )}
      </div>
      <div className="bk-quad-scroll">
        {/* Grid with two equal-height rows, so the wildcard lines up with the
            1-seed game and the Round of 8 sits centered between the two
            Round of 16 games — which keeps the connector lines straight. */}
        <div className="bk-grid">
          {head(0, 'h0')}
          {head(1, 'h1')}
          {head(2, 'h2')}
          <div className="bk-slot s-wc">{M(0, q)}</div>
          <div className="bk-slot s-ra">{M(1, 2 * q)}</div>
          <div className="bk-slot s-rb">{M(1, 2 * q + 1)}</div>
          <div className="bk-slot s-r8">{M(2, q)}</div>
        </div>
      </div>
    </section>
  );

  return (
    <div className="bk-board">
      <div className="bk-quads">{[0, 1, 2, 3].map(quad)}</div>
      <section className="bk-final4">
        <div className="bk-final4-head"><IconTrophy size={15} /> Final Four</div>
        <div className="bk-final">
          <div className="bk-fcol">{head(3)}{M(3, 0)}</div>
          <div className="bk-fcol champ">
            {head(4)}
            {M(4, 0)}
            {champ && <div className="bk-champ-tag"><IconTrophy size={15} /> {champ.name}</div>}
          </div>
          <div className="bk-fcol">{head(3)}{M(3, 1)}</div>
        </div>
      </section>
    </div>
  );
}

export function ChampionBanner({ name, bracketName, onNew }) {
  return (
    <div className="bk-champ-banner">
      <span className="bk-shine" aria-hidden="true" />
      <span className="bk-champ-icon"><IconTrophy size={30} /></span>
      <div className="bk-champ-text">
        <div className="bk-champ-k">{bracketName} champion</div>
        <div className="bk-champ-name">{name}</div>
      </div>
      {onNew && <button type="button" className="btn btn-ink btn-sm" onClick={onNew}>+ Start a new bracket</button>}
    </div>
  );
}

// Past brackets panel: newest first; a row opens /culture/brackets/[id]. The trash icon shows only where
// bracketPolicy allows the (soft, admin-restorable) delete.
export function BracketHistory({ past, viewer, activeId = null, onAskDelete }) {
  if (!past || !past.length) return null;
  return (
    <section className="bk-history">
      <h3 className="section-title">Past brackets</h3>
      {past.map((b) => (
        <div key={b.id} className={`bk-past-row${same(activeId, b.id) ? ' on' : ''}`}>
          <Link className="bk-past-open" href={`/culture/brackets/${b.id}`} prefetch={false} title="View this bracket">
            <span className="bk-past-name">{b.name}</span>
            <span className="bk-past-champ">{b.champion_name ? <><IconTrophy size={14} /> {b.champion_name}</> : <i>No champion</i>}</span>
            <span className="bk-past-date">{fmtDay(b.completed_at || b.created_at, viewer?.tz)}</span>
          </Link>
          {onAskDelete && viewer && bracketPolicy(viewer, b).canDelete && (
            <button type="button" className="bk-icon-btn" title="Delete from history" aria-label={`Delete “${b.name}” from history`} onClick={() => onAskDelete(b)}><IconTrash size={15} /></button>
          )}
        </div>
      ))}
    </section>
  );
}

// Release 3 queues weekly auto brackets ahead of time; they show here, read-only, until they start.
function UpcomingList({ upcoming }) {
  if (!upcoming || !upcoming.length) return null;
  const opens = (ymd) => fmtStart(ymd);
  return (
    <section className="bk-history bk-upcoming">
      <h3 className="section-title">Upcoming brackets</h3>
      {upcoming.map((b) => (
        <div key={b.id} className="bk-past-row">
          <Link className="bk-past-open" href={`/culture/brackets/${b.id}`} prefetch={false}>
            <span className="bk-past-name">{b.name}</span>
            <span className="bk-past-champ cu-upcoming"><IconCalendar size={14} /> Opens {opens(b.starts_on)}</span>
          </Link>
        </div>
      ))}
    </section>
  );
}

function deleteConfirm(b, onConfirm) {
  return {
    title: `Delete “${b.name}”?`,
    lines: ['This removes it from Past brackets, including its votes and notes. An admin can bring it back if it was a mistake.'],
    confirmLabel: 'Delete bracket',
    danger: true,
    onConfirm,
  };
}

function ErrorBar({ message, onClose }) {
  if (!message) return null;
  return (
    <div className="bk-err cu-errbar" role="alert">
      <span>{message}</span>
      <button type="button" className="bk-link" onClick={onClose}>Dismiss</button>
    </div>
  );
}

// ---------------------------------------------------------------- /culture/brackets

// initial = loadBrackets(viewer, now): { current: { bracket, entrants, matches, votes } | null, upcoming,
// past, users, schedule }. viewer = publicViewer(...).
export default function BracketView({ initial, viewer }) {
  const router = useRouter();
  // Server data: the page render, then each 15 s poll. useServerState keeps optimistic local changes for
  // 2.5 s before adopting newer server data (today's poll-guard model, §7.4).
  const [server, setServer] = useState(initial);
  useEffect(() => { setServer(initial); }, [initial]);
  const [data, setData] = useServerState(server);
  const [error, setError] = useState('');
  const [editNames, setEditNames] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [photosOpen, setPhotosOpen] = useState(false);
  const [conflict, setConflict] = useState(null);         // { where, field, mine, err, keep(base) }
  const [, setTick] = useState(0);                         // the last-hour countdown re-renders
  useRefreshOnFocus(30_000);

  const cur = data.current;
  const current = cur ? cur.bracket : null;
  const curEntrants = cur ? cur.entrants : [];
  const curMatches = cur ? cur.matches : [];
  const curVotes = cur ? cur.votes : [];
  const past = data.past || [];
  const users = data.users || [];
  const pol = current ? bracketPolicy(viewer, current) : null;
  const canCreate = isOrganizer(viewer);

  const usersById = useMemo(() => {
    const o = {};
    users.forEach((u) => { o[String(u.id)] = u; });
    return o;
  }, [users]);
  const meUser = viewer ? (usersById[String(viewer.id)] || { id: viewer.id, username: viewer.username, name: viewer.name }) : null;

  const nameOf = (eid) => (curEntrants.find((e) => same(e.id, eid)) || {}).name || 'TBD';
  const countFor = (m, eid) => curVotes.filter((v) => same(v.match_id, m.id) && same(v.entrant_id, eid)).length;
  const champ = current && current.champion_id ? curEntrants.find((e) => same(e.id, current.champion_id)) : null;
  const schedule = data.schedule || { mode: 'manual' };
  const auto = !!current && current.mode === 'auto' && schedule.mode === 'auto';
  const org = isOrganizer(viewer);
  const openRound = !current ? null : auto ? (schedule.phase === 'open' ? schedule.open_round : null) : currentRound(curMatches);
  // The server's clock (the test clock in the harness) against the browser's, for the countdown and the timer.
  const skew = useRef(0);
  useEffect(() => { const t = Date.parse(data.now || ''); if (Number.isFinite(t)) skew.current = t - Date.now(); }, [data.now]);
  const nowEst = () => Date.now() + skew.current;
  const openMatches = openRound === null ? [] : curMatches.filter((m) => Number(m.round) === openRound);
  const openDone = openMatches.filter((m) => m.winner_id).length;
  const openTotal = openMatches.length;

  // The newest server copy, adopted at once (after an error, or after our own crown/undo).
  const reload = useCallback(async () => {
    try {
      const j = await api('/api/brackets/current', { quiet: true });
      setData((d) => ({ ...j, users: mergeUsers(d.users, j.users) }));
    } catch {}
  }, [setData]);
  // Background: poll while a round is open (no whole-database polling).
  usePoll(async () => {
    const j = await api('/api/brackets/current', { quiet: true });
    setServer((s) => ({ ...j, users: mergeUsers(s.users, j.users) }));
  }, POLL_MS, { enabled: openRound !== null || (auto && schedule.phase === 'closing') });
  // Weekly brackets change on their own at midnight Central: one refresh just after the next close (+ grace).
  useEffect(() => {
    if (!auto || !schedule.next_close) return undefined;
    const delay = Number(schedule.next_close) - nowEst() + 1500;
    if (!(delay > 0) || delay > 7 * 86_400_000) return undefined;
    const t = setTimeout(() => { reload(); }, delay);
    return () => clearTimeout(t);
  }, [auto, schedule.next_close, reload]);   // eslint-disable-line react-hooks/exhaustive-deps
  // The countdown in the last hour of a round.
  useEffect(() => {
    if (!auto || openRound === null) return undefined;
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, [auto, openRound]);

  const patchCur = (fn) => setData((d) => (d.current ? { ...d, current: fn(d.current) } : d));

  // Mirrors the server: set/clear a match winner and fill/empty the slot it
  // feeds (or the bracket's champion), so the board updates instantly.
  const applyWinnerLocal = (c, matchId, winnerId) => {
    const m = c.matches.find((x) => same(x.id, matchId));
    if (!m) return c;
    const winnerTo = winnerId ? String(winnerId) : null;
    let matches = c.matches.map((x) => (same(x.id, m.id) ? { ...x, winner_id: winnerTo } : x));
    let votes = c.votes;
    let bracket = c.bracket;
    const nx = nextSlot(m.round, m.idx);
    if (nx) {
      const key = nx.side === 'a' ? 'a_id' : 'b_id';
      const n = matches.find((x) => Number(x.round) === nx.round && Number(x.idx) === nx.idx);
      if (n) {
        matches = matches.map((x) => (same(x.id, n.id) ? { ...x, [key]: winnerTo } : x));
        if (!winnerTo) votes = votes.filter((v) => !same(v.match_id, n.id));
      }
    } else {
      const champName = winnerTo ? (c.entrants.find((e) => same(e.id, winnerTo)) || {}).name : null;
      bracket = { ...bracket, champion_id: winnerTo, champion_name: champName, completed_at: winnerTo ? new Date().toISOString() : null };
    }
    return { ...c, matches, votes, bracket };
  };

  async function castVote(matchId, entrantId) {
    const uid = viewer && viewer.id;
    if (!uid) return;
    patchCur((c) => ({
      ...c,
      votes: [
        ...c.votes.filter((v) => !(same(v.match_id, matchId) && same(v.user_id, uid))),
        ...(entrantId ? [{ match_id: String(matchId), user_id: String(uid), entrant_id: String(entrantId) }] : []),
      ],
    }));
    try { await api('/api/bracket-votes', { method: 'POST', body: { match_id: matchId, entrant_id: entrantId } }); }
    catch (e) { setError(e.message); reload(); }
  }
  async function declareWinner(m, entrantId) {
    patchCur((c) => applyWinnerLocal(c, m.id, entrantId));
    try {
      await api(`/api/bracket-matches/${m.id}/winner`, { method: 'POST', body: { entrant_id: entrantId } });
      // The champion moment: gold confetti over the page (skipped under reduced motion, rule 49).
      if (Number(m.round) >= 4 && typeof window !== 'undefined') burstConfetti(window.innerWidth / 2, window.innerHeight / 3);
      await reload();
    } catch (e) { setError(e.message); reload(); }
  }
  async function undoWinner(matchId) {
    patchCur((c) => applyWinnerLocal(c, matchId, null));
    try { await api(`/api/bracket-matches/${matchId}/winner`, { method: 'DELETE' }); await reload(); }
    catch (e) { setError(e.message); reload(); }
  }

  // Name and notes: sent with the value the field had when you started (base); the stored row comes back
  // and becomes the field's value and next base (§7.4). A 409 shows their text plus Keep mine / Use theirs.
  async function saveBracketField(field, value, base) {
    if (!current) return value;
    const id = current.id;
    const where = field === 'notes' ? 'notes' : 'head';
    patchCur((c) => (same(c.bracket.id, id) ? { ...c, bracket: { ...c.bracket, [field]: value } } : c));
    setConflict((x) => (x && x.where === where ? null : x));
    try {
      const r = await api(`/api/brackets/${id}`, { method: 'PATCH', body: { [field]: value, base: { [field]: base } } });
      const row = r.row || {};
      patchCur((c) => (same(c.bracket.id, id) ? { ...c, bracket: { ...c.bracket, [field]: row[field] ?? value } } : c));
      return row[field] ?? value;
    } catch (e) {
      if (e instanceof ConflictError) {
        const theirs = e.current ? e.current[field] : undefined;
        if (theirs !== undefined) patchCur((c) => (same(c.bracket.id, id) ? { ...c, bracket: { ...c.bracket, [field]: theirs ?? '' } } : c));
        setConflict({ where, field, mine: value, err: e, keep: (b) => saveBracketField(field, value, b).catch(() => {}) });
      } else {
        setError(e.message);
      }
      throw e;
    }
  }
  async function saveRegions(q, v) {
    if (!current) return v;
    const id = current.id;
    const r = parseRegions(current.regions);
    r[q] = v;
    patchCur((c) => (same(c.bracket.id, id) ? { ...c, bracket: { ...c.bracket, regions: JSON.stringify(r) } } : c));
    try {
      const res = await api(`/api/brackets/${id}`, { method: 'PATCH', body: { regions: r } });
      const stored = res.row && res.row.regions ? res.row.regions : JSON.stringify(r);
      patchCur((c) => (same(c.bracket.id, id) ? { ...c, bracket: { ...c.bracket, regions: stored } } : c));
      return parseRegions(stored)[q];
    } catch (e) { setError(e.message); throw e; }
  }
  async function renameEntrant(entrantId, name, base) {
    const setName = (n) => patchCur((c) => ({ ...c, entrants: c.entrants.map((e) => (same(e.id, entrantId) ? { ...e, name: n } : e)) }));
    setName(name);
    setConflict((x) => (x && x.where === 'head' ? null : x));
    try {
      const r = await api(`/api/bracket-entrants/${entrantId}`, { method: 'PATCH', body: { name, base: { name: base } } });
      const stored = r.row ? r.row.name : name;
      setName(stored);
      return stored;
    } catch (e) {
      if (e instanceof ConflictError) {
        const theirs = e.current ? e.current.name : undefined;
        if (theirs != null) setName(theirs);
        setConflict({ where: 'head', field: 'name', mine: name, err: e, keep: (b) => renameEntrant(entrantId, name, b).catch(() => {}) });
      } else {
        setError(e.message);
      }
      throw e;
    }
  }
  async function deleteBracket(b) {
    setData((d) => ({ ...d, past: (d.past || []).filter((x) => !same(x.id, b.id)) }));
    try { await api(`/api/brackets/${b.id}`, { method: 'DELETE' }); router.refresh(); }
    catch (e) { setError(e.message); reload(); }
  }

  const askWin = (m, eid) => {
    const otherId = same(eid, m.a_id) ? m.b_id : m.a_id;
    const w = nameOf(eid);
    const o = nameOf(otherId);
    const vw = countFor(m, eid);
    const vo = countFor(m, otherId);
    if (auto) {
      const r = Number(m.round);
      setConfirm({
        title: `Decide early: ${w} wins?`,
        lines: [
          <>Votes so far — <b>{w}</b>: {vw} · <b>{o}</b>: {vo}</>,
          vo > vw ? <span className="bk-warn">Heads up: {o} has more votes.</span> : null,
          r >= 4 ? <>{w} will be crowned champion of “{current.name}”.</>
            : <>{w} moves on to the {ROUNDS[r + 1]}, which still opens {roundWeekday(current.starts_on, r + 1)} as scheduled. You can re-open it until midnight Central.</>,
        ],
        confirmLabel: 'Yes, decide it now',
        onConfirm: () => declareWinner(m, eid),
      });
      return;
    }
    let note = null;
    if (vw + vo === 0) note = <span className="bk-warn">Nobody has voted in this matchup yet.</span>;
    else if (vo > vw) note = <span className="bk-warn">Heads up: {o} has more votes.</span>;
    else if (vo === vw) note = <span className="bk-warn">Heads up: it’s a tie.</span>;
    setConfirm({
      title: `Declare ${w} the winner?`,
      lines: [
        <>Votes — <b>{w}</b>: {vw} · <b>{o}</b>: {vo}</>,
        note,
        Number(m.round) >= 4 ? <>{w} will be crowned champion of “{current.name}”.</> : <>{w} moves on to the {ROUNDS[Number(m.round) + 1]}.</>,
      ],
      confirmLabel: 'Yes, declare winner',
      onConfirm: () => declareWinner(m, eid),
    });
  };

  const askUndo = (m) => {
    const w = nameOf(m.winner_id);
    if (auto) {
      setConfirm({
        title: 'Re-open this matchup?',
        lines: [`${w}’s early win is cleared and voting goes on until midnight Central.`],
        confirmLabel: 'Yes, re-open',
        onConfirm: () => undoWinner(m.id),
      });
      return;
    }
    const nx = nextSlot(m.round, m.idx);
    const n = nx && curMatches.find((x) => Number(x.round) === nx.round && Number(x.idx) === nx.idx);
    const nVotes = n ? curVotes.filter((v) => same(v.match_id, n.id)).length : 0;
    setConfirm({
      title: `Undo ${w}’s win?`,
      lines: nx
        ? [
            `${w} will be pulled back out of the ${ROUNDS[nx.round]}, and you can pick this winner again.`,
            nVotes ? <span className="bk-warn">The {plural(nVotes, 'vote')} already cast in that {ROUNDS[nx.round]} matchup will be cleared.</span> : null,
          ]
        : [`${w} will no longer be the champion, and you can pick the championship winner again.`],
      confirmLabel: 'Yes, undo it',
      danger: true,
      onConfirm: () => undoWinner(m.id),
    });
  };

  const switchManual = () => setConfirm({
    title: 'Switch this bracket to manual?',
    lines: [
      'Rounds stop closing on their own at midnight. Organizers then declare each winner, one round at a time.',
      'Results already decided stay. This can’t be switched back.',
    ],
    confirmLabel: 'Switch to manual',
    danger: true,
    onConfirm: async () => {
      try { await api(`/api/brackets/${current.id}`, { method: 'PATCH', body: { mode: 'manual' } }); await reload(); }
      catch (e) { setError(e.message); reload(); }
    },
  });

  const startNew = () => {
    if (auto) { router.push('/culture/brackets/new'); return; }       // a weekly one starts on its Monday
    if (current && !current.champion_id) {
      setConfirm({
        title: 'Start a new bracket?',
        lines: [`“${current.name}” doesn’t have a champion yet.`, 'Once you create the new one, this one moves to Past brackets as unfinished.'],
        confirmLabel: 'Set up new bracket',
        onConfirm: () => router.push('/culture/brackets/new'),
      });
    } else {
      router.push('/culture/brackets/new');
    }
  };

  const askDelete = (b) => setConfirm(deleteConfirm(b, () => deleteBracket(b)));

  const conflictUI = (where) => (conflict && conflict.where === where ? (
    <ConflictNotice
      conflict={conflict.err}
      field={conflict.field}
      mine={conflict.mine}
      onKeepMine={async (theirs) => { const c = conflict; setConflict(null); await c.keep(theirs); }}
      onUseTheirs={() => setConflict(null)}
    />
  ) : null);

  let body;
  if (!current) {
    body = (
      <div className="bk-setup cu-empty">
        <h2>{!past.length ? 'No brackets yet' : 'No bracket is running right now'}</h2>
        {canCreate ? (
          <>
            <p className="bk-setup-sub">Start one: 20 spots across 4 quadrants, and everyone votes one round at a time.</p>
            <div className="modal-actions cu-left">
              <Link className="btn btn-lime" href="/culture/brackets/new">{!past.length ? 'Set up your first bracket' : '+ New bracket'}</Link>
            </div>
          </>
        ) : (
          <p className="bk-setup-sub">A culture organizer starts each new bracket. Check back soon.</p>
        )}
      </div>
    );
  } else {
    body = (
      <>
        <div className="bk-head">
          <div className="bk-head-main">
            {editNames ? (
              <SyncedField
                className="bk-title-input"
                key={current.id}
                value={current.name}
                aria-label="Bracket name"
                onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                onSave={(v, base) => { const n = v.trim(); if (!n) return false; return saveBracketField('name', n, base); }}
              />
            ) : (
              <h2 className="bk-title">{current.name}</h2>
            )}
            <div className="bk-hint">
              {editNames
                ? 'Editing names — click any name to fix it. Votes are paused while editing.'
                : auto
                  ? <>Tap a name to vote (tap again to take it back). Rounds close at midnight Central; ties go to the better seed.{org ? <> · <IconCrown size={12} /> decides a matchup early</> : null}</>
                : pol.canCrown
                  ? <>Tap a name to vote (tap again to take it back) · <IconCrown size={12} /> declares the winner once everyone’s voted</>
                  : <>Tap a name to vote (tap again to take it back) · a culture organizer declares each winner</>}
            </div>
          </div>
          <div className="bk-actions">
            {meUser && (
              <span className="bk-voting-as">
                <Headshot user={meUser} size={24} /> Voting as <b>{nameOfUser(meUser)}</b>
                {!meUser.avatar_v && <button type="button" className="bk-link" onClick={() => setPhotosOpen(true)}>add your photo</button>}
              </span>
            )}
            <button type="button" className="btn btn-plain btn-sm wi" onClick={() => setPhotosOpen(true)}><IconCamera size={14} /> Voter photos</button>
            {pol.canEdit && (
              <button type="button" className="btn btn-plain btn-sm wi" onClick={() => setEditNames((x) => !x)}>
                {editNames ? <><IconCheck size={14} /> Done editing</> : <><IconPencil size={14} /> Edit names</>}
              </button>
            )}
            {auto && org && <Link className="btn btn-plain btn-sm wi" href={`/culture/brackets/new?mode=auto&from=${current.id}`} prefetch={false}><IconCalendar size={14} /> Repeat next Monday</Link>}
            {auto && org && !champ && <button type="button" className="btn btn-plain btn-sm" onClick={switchManual}>Switch to manual</button>}
            {canCreate && <button type="button" className="btn btn-lime btn-sm" onClick={startNew}>+ New bracket</button>}
          </div>
        </div>
        {conflictUI('head')}
        {champ && <ChampionBanner name={champ.name} bracketName={current.name} onNew={canCreate ? startNew : null} />}
        {auto && openRound !== null && (() => {
          const c = closeLabel(schedule.closes_at, viewer?.tz);
          const left = Date.parse(schedule.closes_at || '') - nowEst();
          return (
            <div className="bk-round-status auto">
              <span className="bk-rs-dot" aria-hidden="true" />
              <span>Voting open: <b>{ROUNDS[openRound]}</b> · closes tonight at {c.ct}{c.mine ? ` (${c.mine} your time)` : ''}</span>
              {left > 0 && left <= 3_600_000 && <span className="bk-rs-soon">Closes in {untilText(schedule.closes_at, nowEst())}</span>}
              <span className="bk-rs-next"><IconCalendar size={12} /> {openRound < ROUNDS.length - 1
                ? <>The {ROUNDS[openRound + 1]} opens {roundWeekday(current.starts_on, openRound + 1)}</>
                : <>The champion shows Saturday</>}</span>
            </div>
          );
        })()}
        {auto && schedule.phase === 'closing' && (
          <div className="bk-round-status auto">
            <span className="bk-rs-dot" aria-hidden="true" />
            <span>Voting is closed. The last results are being decided — this takes a moment after midnight.</span>
          </div>
        )}
        {!auto && openRound !== null && (
          <div className="bk-round-status">
            <span className="bk-rs-dot" aria-hidden="true" />
            <span>Voting open: <b>{ROUNDS[openRound]}</b> · {openDone} of {openTotal} decided</span>
            {openRound < ROUNDS.length - 1 && (
              <span className="bk-rs-next"><IconLock size={12} /> The {ROUNDS[openRound + 1]} opens once every {ROUNDS[openRound]} matchup has a winner</span>
            )}
          </div>
        )}
        <BracketBoard
          bracket={current} entrants={curEntrants} matches={curMatches} votes={curVotes} schedule={schedule}
          usersById={usersById} meId={viewer ? viewer.id : null} readOnly={false} editNames={editNames && pol.canEdit}
          mayCrown={auto ? org : pol.canCrown} mayUndo={auto ? org : pol.canUndo}
          onVote={castVote} onAskWin={askWin} onAskUndo={askUndo}
          onRename={renameEntrant} onRenameRegion={saveRegions}
        />
        <div className="notes-panel bk-notes">
          <label className="notes-label" htmlFor="bk-notes-area"><IconNote size={14} /> Bracket notes <span>· info to help everyone make an informed vote</span></label>
          {pol.canEdit ? (
            <SyncedTextarea
              id="bk-notes-area"
              key={current.id}
              className="notes-area bk-notes-area"
              value={current.notes || ''}
              placeholder="Stats, context, links, hot takes — anything people should know before they vote…"
              onSave={(v, base) => saveBracketField('notes', v, base)}
            />
          ) : (
            <div className="bk-notes-read">{(current.notes || '').trim() ? current.notes : <span className="muted">No notes yet.</span>}</div>
          )}
          {conflictUI('notes')}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="proj-head">
        <h1 className="wi-h"><IconTrophy size={24} /> Bracket</h1>
      </div>
      <ErrorBar message={error} onClose={() => setError('')} />
      <CadenceNotice cadence={data.cadence && data.cadence.warn ? { ...data.cadence, repeat_id: auto ? current.id : null } : null} />
      {body}
      <UpcomingList upcoming={data.upcoming} />
      <BracketHistory past={past} viewer={viewer} onAskDelete={askDelete} />
      {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}
      {photosOpen && (
        <VoterPhotos
          users={users.filter((u) => !u.disabled)}
          me={viewer}
          onChanged={(id, patch) => setData((d) => ({ ...d, users: (d.users || []).map((u) => (same(u.id, id) ? { ...u, ...patch } : u)) }))}
          onClose={() => setPhotosOpen(false)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------- /culture/brackets/[id]

// A past (or upcoming) bracket, read-only: no voting, crowns, undo or locks; vote counts and headshots
// stay. initial = loadBracket(viewer, id).
export function PastBracketView({ initial, viewer, mondays = null }) {
  const router = useRouter();
  const [history, setHistory] = useState(initial.history || []);
  useEffect(() => { setHistory(initial.history || []); }, [initial]);
  const [confirm, setConfirm] = useState(null);
  const [error, setError] = useState('');
  const [editNames, setEditNames] = useState(false);
  const [names, setNames] = useState(() => ({ bracket: initial.bracket, entrants: initial.entrants }));
  useEffect(() => { setNames({ bracket: initial.bracket, entrants: initial.entrants }); }, [initial]);
  const [moveTo, setMoveTo] = useState(initial.bracket.starts_on || '');
  const d = initial;
  const b = names.bracket;
  const upcoming = b.mode === 'auto' && !b.activated_at && !b.archived;
  // An upcoming weekly bracket stays editable for organizers until its Monday (design §10(c) Lifecycle).
  const tools = upcoming && isOrganizer(viewer);
  const usersById = useMemo(() => {
    const o = {};
    (d.users || []).forEach((u) => { o[String(u.id)] = u; });
    return o;
  }, [d.users]);

  const fail = (e) => { setError(e.message); router.refresh(); throw e; };
  async function renameEntrant(entrantId, name, base) {
    try {
      const r = await api(`/api/bracket-entrants/${entrantId}`, { method: 'PATCH', body: { name, base: { name: base } } });
      const stored = r.row ? r.row.name : name;
      setNames((x) => ({ ...x, entrants: x.entrants.map((e) => (same(e.id, entrantId) ? { ...e, name: stored } : e)) }));
      return stored;
    } catch (e) { return fail(e); }
  }
  async function saveRegion(q, v) {
    const r = parseRegions(b.regions);
    r[q] = v;
    try {
      const res = await api(`/api/brackets/${b.id}`, { method: 'PATCH', body: { regions: r } });
      const stored = res.row && res.row.regions ? res.row.regions : JSON.stringify(r);
      setNames((x) => ({ ...x, bracket: { ...x.bracket, regions: stored } }));
      return parseRegions(stored)[q];
    } catch (e) { return fail(e); }
  }
  async function saveName(v, base) {
    try {
      const res = await api(`/api/brackets/${b.id}`, { method: 'PATCH', body: { name: v, base: { name: base } } });
      const stored = res.row ? res.row.name : v;
      setNames((x) => ({ ...x, bracket: { ...x.bracket, name: stored } }));
      return stored;
    } catch (e) { return fail(e); }
  }
  async function reschedule() {
    setError('');
    try {
      await api(`/api/brackets/${b.id}`, { method: 'PATCH', body: { starts_on: moveTo } });
      router.refresh();
    } catch (e) { setError(e.message); }
  }

  async function deleteBracket(x) {
    setHistory((h) => h.filter((y) => !same(y.id, x.id)));
    try {
      await api(`/api/brackets/${x.id}`, { method: 'DELETE' });
      // Deleting the one you're looking at goes back to the current bracket, as before.
      if (same(x.id, b.id)) router.push('/culture/brackets');
      else router.refresh();
    } catch (e) { setError(e.message); router.refresh(); }
  }

  return (
    <>
      <div className="proj-head">
        <h1 className="wi-h"><IconTrophy size={24} /> Bracket</h1>
      </div>
      <ErrorBar message={error} onClose={() => setError('')} />
      <div className="bk-past-banner">
        <Link className="btn btn-plain btn-sm" href="/culture/brackets">← Back to current bracket</Link>
        {upcoming ? (
          <span>Upcoming bracket · <b>{b.name}</b> · Starts {fmtStart(b.starts_on, { long: true })} · voting opens 12:00 AM CT</span>
        ) : (
          <span>Past bracket · <b>{b.name}</b> · {fmtDay(b.completed_at || b.created_at, viewer?.tz)}</span>
        )}
      </div>
      {tools && (
        <div className="bk-upcoming-tools">
          {editNames ? (
            <SyncedField
              className="bk-title-input"
              value={b.name}
              aria-label="Bracket name"
              onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
              onSave={(v, base) => { const n = v.trim(); if (!n) return false; return saveName(n, base); }}
            />
          ) : null}
          <button type="button" className="btn btn-plain btn-sm wi" onClick={() => setEditNames((x) => !x)}>
            {editNames ? <><IconCheck size={14} /> Done editing</> : <><IconPencil size={14} /> Edit names</>}
          </button>
          {Array.isArray(mondays) && mondays.length > 0 && (
            <span className="bk-move">
              <label htmlFor="bk-move-start">Starts</label>
              <select id="bk-move-start" className="field" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                {mondays.filter((m) => !m.taken || m.ymd === b.starts_on).map((m) => (
                  <option key={m.ymd} value={m.ymd}>{fmtStart(m.ymd)}</option>
                ))}
              </select>
              <button type="button" className="btn btn-ink btn-sm" disabled={!moveTo || moveTo === b.starts_on} onClick={reschedule}>Move start</button>
            </span>
          )}
          <button type="button" className="btn btn-plain btn-sm wi" onClick={() => setConfirm(deleteConfirm(b, () => deleteBracket(b)))}><IconTrash size={14} /> Delete</button>
        </div>
      )}
      {b.champion_name && <ChampionBanner name={b.champion_name} bracketName={b.name} />}
      <BracketBoard
        bracket={b} entrants={names.entrants} matches={d.matches} votes={d.votes} schedule={d.schedule}
        usersById={usersById} meId={null} readOnly editNames={tools && editNames}
        onRename={renameEntrant} onRenameRegion={saveRegion}
      />
      {(b.notes || '').trim() && (
        <div className="notes-panel bk-notes">
          <label className="notes-label"><IconNote size={14} /> Bracket notes</label>
          <div className="bk-notes-read">{b.notes}</div>
        </div>
      )}
      <BracketHistory past={history} viewer={viewer} activeId={b.id} onAskDelete={(x) => setConfirm(deleteConfirm(x, () => deleteBracket(x)))} />
      {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}
    </>
  );
}

// ---------------------------------------------------------------- /culture/brackets/new

function BracketSetup({ isFirst, initial, onCancel, onCreate, mode: mode0 = 'auto', mondays = [], startsOn = '', current = null, onModeChange = noop }) {
  const [mode, setModeState] = useState(mode0);
  const setMode = (m) => { setModeState(m); onModeChange(m); };
  const [start, setStart] = useState(startsOn);
  const [name, setName] = useState(initial?.name || '');
  const [regions, setRegions] = useState(initial?.regions || ['Quadrant 1', 'Quadrant 2', 'Quadrant 3', 'Quadrant 4']);
  const [grid, setGrid] = useState(() => initial?.entrants || [0, 1, 2, 3].map(() => ['', '', '', '', '']));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const missing = grid.flat().filter((s) => !s.trim()).length;
  const setCell = (q, s, v) => setGrid((g) => g.map((row, i) => (i !== q ? row : row.map((x, j) => (j === s ? v : x)))));
  const setRegion = (q, v) => setRegions((r) => r.map((x, i) => (i === q ? v : x)));

  const submit = async () => {
    if (missing) { setErr(`Fill in all 20 spots — ${missing} still empty.`); return; }
    setErr('');
    setBusy(true);
    if (mode === 'auto' && !start) { setErr('Pick the Monday it starts.'); return; }
    const ok = await onCreate({
      mode, ...(mode === 'auto' ? { starts_on: start } : {}),
      name: name.trim(), regions: regions.map((r) => r.trim()), entrants: grid.map((r) => r.map((s) => s.trim())),
    });
    setBusy(false);
    if (!ok) setErr('Couldn’t create the bracket — please try again.');
  };

  const slot = (q, s) => (
    <div key={s} className="bk-setup-slot">
      <span className="bk-setup-seed">{SEED_LABELS[s]}</span>
      <input className="field" value={grid[q][s]} onChange={(e) => setCell(q, s, e.target.value)} placeholder="Name" aria-label={`${regions[q]} ${SEED_LABELS[s]}`} />
    </div>
  );

  return (
    <div className="bk-setup">
      <h2>{isFirst ? 'Set up your first bracket' : 'New bracket'}</h2>
      <p className="bk-setup-sub">20 spots across 4 quadrants. In each quadrant the two wildcards play first and the winner faces the 1 seed, while the 2 and 3 seeds face each other.</p>
      <fieldset className="bk-setup-mode">
        <legend className="atm-label">How it runs</legend>
        <label className={`bk-mode-opt${mode === 'auto' ? ' on' : ''}`}>
          <input type="radio" name="bk-mode" value="auto" checked={mode === 'auto'} onChange={() => setMode('auto')} />
          <span><b>Weekly</b> · one round a day, Monday to Friday. Each round closes at midnight Central on its own; ties go to the better seed.</span>
        </label>
        <label className={`bk-mode-opt${mode === 'manual' ? ' on' : ''}`}>
          <input type="radio" name="bk-mode" value="manual" checked={mode === 'manual'} onChange={() => setMode('manual')} />
          <span><b>Manual</b> · starts now; an organizer declares each winner, one round at a time.</span>
        </label>
      </fieldset>
      {mode === 'auto' && (
        <div className="bk-setup-start">
          <label className="atm-label" htmlFor="bk-setup-start">Starts Monday</label>
          <select id="bk-setup-start" className="field" value={start} onChange={(e) => setStart(e.target.value)}>
            {!start && <option value="">Pick a Monday</option>}
            {mondays.map((m) => (
              <option key={m.ymd} value={m.ymd} disabled={!!m.taken}>{fmtStart(m.ymd)}{m.taken ? ` · taken (${m.taken})` : ''}</option>
            ))}
          </select>
          {current && current.mode !== 'auto' && !current.champion_id && start && (
            <p className="cu-note">When this starts on {fmtStart(start)}, “{current.name}” moves to Past brackets (no champion yet).</p>
          )}
        </div>
      )}
      <label className="atm-label" htmlFor="bk-setup-name">Bracket name</label>
      <input id="bk-setup-name" className="field bk-setup-name" placeholder="e.g. Best Chicago Pizza" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="bk-setup-grid">
        {[0, 1, 2, 3].map((q) => (
          <div key={q} className="bk-setup-quad">
            <input className="bk-setup-region" value={regions[q]} onChange={(e) => setRegion(q, e.target.value)} aria-label={`Quadrant ${q + 1} name`} />
            {[0, 1, 2].map((s) => slot(q, s))}
            <div className="bk-setup-wc">
              <div className="bk-setup-wc-label">Wildcard game</div>
              {slot(q, 3)}
              {slot(q, 4)}
            </div>
          </div>
        ))}
      </div>
      {err && <div className="bk-err">{err}</div>}
      <div className="modal-actions">
        {onCancel && <button type="button" className="btn btn-plain" onClick={onCancel}>Cancel</button>}
        <button type="button" className="btn btn-ink" disabled={busy} onClick={submit}>{busy ? 'Saving…' : mode === 'auto' ? 'Schedule bracket' : 'Create bracket'}</button>
      </div>
    </div>
  );
}

// isFirst: no brackets yet. current: the live bracket's summary (or null). template: ?from=<id> prefill.
export function NewBracketView({ isFirst, current, template, mode = 'auto', mondays = [], startsOn = '' }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [chosen, setChosen] = useState(mode);
  const create = async (p) => {
    setError('');
    try {
      const r = await api('/api/brackets', { method: 'POST', body: { mode: 'manual', ...p } });
      // A weekly bracket that starts later opens on its own page (upcoming); one starting today is live at once.
      // (the bracket's own page redirects to the live board when it is current).
      router.push(r && r.mode === 'auto' && r.id ? `/culture/brackets/${r.id}` : '/culture/brackets');
      router.refresh();
      return true;
    } catch (e) { setError(e.message); return false; }
  };
  return (
    <>
      <div className="proj-head">
        <h1 className="wi-h"><IconTrophy size={24} /> Bracket</h1>
      </div>
      <ErrorBar message={error} onClose={() => setError('')} />
      {current && !current.champion_id && chosen === 'manual' && (
        <p className="cu-note">
          <IconLock size={13} /> “{current.name}” doesn’t have a champion yet. Once you create the new one, it moves to Past brackets as unfinished.
        </p>
      )}
      <BracketSetup
        isFirst={isFirst}
        initial={template}
        mode={mode}
        mondays={mondays}
        startsOn={startsOn}
        current={current}
        onModeChange={setChosen}
        onCancel={() => router.push('/culture/brackets')}
        onCreate={create}
      />
    </>
  );
}
