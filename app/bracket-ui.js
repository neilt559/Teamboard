'use client';
import { useState, useEffect, useRef } from 'react';
import { ROUNDS, nextSlot, currentRound } from '@/lib/bracket';
import { IconCrown, IconTrophy, IconTrash, IconCamera, IconPencil, IconCheck, IconNote, IconRestore, IconLock, IconCrop } from './icons';
import PhotoCropper, { fileToSource } from './photo-cropper';
import { SyncedField, SyncedTextarea } from './synced';

// ---- vote bracket (one shared bracket for everyone) ----------------------
// People vote on each matchup as whoever they're logged in as; their headshot
// appears next to the entrant they picked. Someone then declares the winner by
// hand (who's in the office changes day to day), which moves that entrant into
// their next-round slot. Data lives in /api/state; this file is just the UI.

const HS_COLORS = ['#5B5859', '#0086c0', '#e2445c', '#fdab3d', '#00c875', '#a25ddc', '#ff158a', '#037f4c', '#7f5347', '#9aa000'];
const SEED_LABELS = ['1 seed', '2 seed', '3 seed', 'Wildcard', 'Wildcard'];
const same = (a, b) => a != null && b != null && String(a) === String(b);

function colorFor(name) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return HS_COLORS[h % HS_COLORS.length];
}
function parseRegions(s) {
  let r = [];
  try { r = JSON.parse(s || '[]'); } catch {}
  return [0, 1, 2, 3].map((q) => (Array.isArray(r) && r[q]) || `Quadrant ${q + 1}`);
}
function fmtDay(v) {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;


export function Headshot({ user, size = 22 }) {
  const name = user ? user.username : 'unknown';
  if (user && user.avatar_v) {
    return <img className="hs" src={`/api/avatar/${user.id}?v=${user.avatar_v}`} alt={name} title={name} width={size} height={size} style={{ width: size, height: size }} />;
  }
  return (
    <span className="hs hs-init" title={name} style={{ width: size, height: size, fontSize: Math.round(size * 0.46), background: colorFor(name) }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function ConfirmDialog({ title, lines, confirmLabel, danger, onConfirm, onClose }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal bk-confirm" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {(lines || []).map((l, i) => (l ? <p key={i}>{l}</p> : null))}
        <div className="modal-actions">
          <button className="btn btn-plain" onClick={onClose}>Cancel</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-ink'}`} autoFocus onClick={() => { onClose(); onConfirm(); }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
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
  const { ent, votesByMatch, usersById, meId, readOnly, editNames, onVote, onAskWin, onAskUndo, onRename, canUndo, isOpen } = ctx;
  const votes = votesByMatch[String(m.id)] || [];
  const ready = !!(m.a_id && m.b_id);
  const decided = !!m.winner_id;
  // Rounds go one at a time: a matchup can be set but still waiting on the
  // rest of the round before it.
  const open = isOpen(m.round);
  const locked = !readOnly && ready && !decided && !open;
  const votable = !readOnly && !editNames && ready && !decided && open;
  const undoable = !readOnly && !editNames && decided && canUndo(m);

  const row = (side) => {
    const eid = side === 'a' ? m.a_id : m.b_id;
    const e = eid ? ent[String(eid)] : null;
    const sv = e ? votes.filter((v) => same(v.entrant_id, eid)) : [];
    const mine = sv.some((v) => same(v.user_id, meId));
    const won = decided && same(m.winner_id, eid);
    const lost = decided && !!e && !won;
    const cls = ['bk-ent', votable && 'votable', mine && 'mine', won && 'won', lost && 'lost', !e && 'empty'].filter(Boolean).join(' ');
    const doVote = () => onVote(m.id, mine ? null : eid);
    const voterNames = sv.map((v) => (usersById[String(v.user_id)] || {}).username || 'someone').join(', ');
    return (
      <div
        className={cls}
        onClick={votable ? doVote : undefined}
        onKeyDown={votable ? (ev) => { if (ev.target === ev.currentTarget && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); doVote(); } } : undefined}
        role={votable ? 'button' : undefined}
        tabIndex={votable ? 0 : undefined}
        aria-pressed={votable ? mine : undefined}
        title={votable ? (mine ? 'Your vote — click to take it back' : `Vote for ${e.name}`)
          : locked ? `Voting opens once every ${ROUNDS[Number(m.round) - 1]} matchup has a winner` : undefined}
      >
        <div className="bk-line">
          {e && <span className="bk-seed">{e.seed}</span>}
          {e && editNames ? (
            <SyncedField
              className="bk-name-input"
              value={e.name}
              onKeyDown={(ev) => { if (ev.key === 'Enter') ev.target.blur(); }}
              onSave={(v) => { const n = v.trim(); if (!n) return false; onRename(e.id, n); return true; }}
            />
          ) : (
            <span className="bk-name" title={e ? e.name : undefined}>{e ? e.name : placeholders[side]}</span>
          )}
          {sv.length > 0 && <span className="bk-count" title={voterNames}>{sv.length}</span>}
          {votable && (
            <button type="button" className="bk-crown-btn" title={`Declare ${e.name} the winner`} onClick={(ev) => { ev.stopPropagation(); onAskWin(m, eid); }}>
              <IconCrown />
            </button>
          )}
          {won && <span className="bk-crown-won" title="Winner"><IconCrown /></span>}
          {won && undoable && (
            <button type="button" className="bk-undo-btn" title="Undo this result" onClick={(ev) => { ev.stopPropagation(); onAskUndo(m); }}><IconRestore size={13} /></button>
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

  return (
    <div className={`bk-match${decided ? ' decided' : ''}${votable ? ' live' : ''}${locked ? ' locked' : ''}${Number(m.round) === 4 ? ' final' : ''}`}>
      {row('a')}
      {row('b')}
    </div>
  );
}

function BracketBoard({ bracket, entrants, matches, votes, usersById, meId, readOnly, editNames, onVote, onAskWin, onAskUndo, onRename, onRenameRegion }) {
  const regions = parseRegions(bracket.regions);
  const ent = {};
  entrants.forEach((e) => { ent[String(e.id)] = e; });
  const votesByMatch = {};
  votes.forEach((v) => { (votesByMatch[String(v.match_id)] = votesByMatch[String(v.match_id)] || []).push(v); });
  const at = (r, i) => matches.find((m) => Number(m.round) === r && Number(m.idx) === i);
  const canUndo = (m) => {
    const nx = nextSlot(m.round, m.idx);
    if (!nx) return true;
    const n = at(nx.round, nx.idx);
    return !n || !n.winner_id;
  };
  const cr = currentRound(matches);
  const isOpen = (r) => cr !== null && Number(r) <= cr;
  const ctx = { ent, votesByMatch, usersById, meId, readOnly, editNames, onVote, onAskWin, onAskUndo, onRename, canUndo, isOpen };
  // Column header for a round, with a lock while it's waiting its turn.
  const head = (r, cls) => {
    const waiting = !readOnly && cr !== null && r > cr;
    return (
      <div className={`bk-col-head ${cls || ''}${waiting ? ' waiting' : ''}`} title={waiting ? `Opens once the ${ROUNDS[r - 1]} is finished` : undefined}>
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
            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
            onSave={(v) => { const n = v.trim(); if (!n) return false; onRenameRegion(q, n); return true; }}
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

function ChampionBanner({ name, bracketName, onNew }) {
  return (
    <div className="bk-champ-banner">
      <span className="bk-shine" aria-hidden="true" />
      <span className="bk-champ-icon"><IconTrophy size={30} /></span>
      <div className="bk-champ-text">
        <div className="bk-champ-k">{bracketName} champion</div>
        <div className="bk-champ-name">{name}</div>
      </div>
      {onNew && <button className="btn btn-ink btn-sm" onClick={onNew}>+ Start a new bracket</button>}
    </div>
  );
}

function BracketSetup({ isFirst, canCancel, onCancel, onCreate }) {
  const [name, setName] = useState('');
  const [regions, setRegions] = useState(['Quadrant 1', 'Quadrant 2', 'Quadrant 3', 'Quadrant 4']);
  const [grid, setGrid] = useState(() => [0, 1, 2, 3].map(() => ['', '', '', '', '']));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const missing = grid.flat().filter((s) => !s.trim()).length;
  const setCell = (q, s, v) => setGrid((g) => g.map((row, i) => (i !== q ? row : row.map((x, j) => (j === s ? v : x)))));
  const setRegion = (q, v) => setRegions((r) => r.map((x, i) => (i === q ? v : x)));

  const submit = async () => {
    if (missing) { setErr(`Fill in all 20 spots — ${missing} still empty.`); return; }
    setErr('');
    setBusy(true);
    const ok = await onCreate({ name: name.trim(), regions: regions.map((r) => r.trim()), entrants: grid.map((r) => r.map((s) => s.trim())) });
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
      <label className="atm-label">Bracket name</label>
      <input className="field bk-setup-name" placeholder="e.g. Best Chicago Pizza" value={name} onChange={(e) => setName(e.target.value)} />
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
        {canCancel && <button className="btn btn-plain" onClick={onCancel}>Cancel</button>}
        <button className="btn btn-ink" disabled={busy} onClick={submit}>{busy ? 'Creating…' : 'Create bracket'}</button>
      </div>
    </div>
  );
}

function VoterPhotosModal({ users, me, onSetAvatar, onClose }) {
  const [busy, setBusy] = useState({});
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(null); // { user, src, crop, fresh } while the cropper is open
  // zz_* accounts are throwaway logins left over from testing the site.
  const list = users.filter((u) => !/^zz_/.test(u.username));

  // A new photo opens straight into the cropper.
  const pick = async (u, file) => {
    if (!file) return;
    setErr('');
    setBusy((b) => ({ ...b, [u.id]: true }));
    try { setEditing({ user: u, src: await fileToSource(file), crop: null, fresh: true }); }
    catch (e) { setErr(e.message || 'Couldn’t read that image'); }
    finally { setBusy((b) => ({ ...b, [u.id]: false })); }
  };
  // Re-crop a photo that's already saved, starting from where it was left.
  const adjust = (u) => {
    let crop = null;
    try { crop = JSON.parse(u.avatar_crop || 'null'); } catch {}
    setEditing({ user: u, src: `/api/avatar/${u.id}?src=1&v=${u.avatar_v}`, crop, fresh: false });
  };
  const remove = (u) => {
    if (confirm(`Remove ${u.username}’s photo?`)) onSetAvatar(u.id, null).catch((e) => setErr(e.message));
  };

  if (editing) {
    return (
      <PhotoCropper
        title={`Photo for ${editing.user.username}`}
        src={editing.src}
        initialCrop={editing.crop}
        fresh={editing.fresh}
        onCancel={() => setEditing(null)}
        onSave={async (payload) => { await onSetAvatar(editing.user.id, payload); setEditing(null); }}
      />
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal bk-photos" onClick={(e) => e.stopPropagation()}>
        <h2>Voter photos</h2>
        <p className="bk-photos-sub">A person’s photo shows up next to whatever they vote for. Anyone can set anyone’s, so one person can load the whole office. After picking a photo you can drag and zoom it to fit the circle.</p>
        {err && <div className="bk-err">{err}</div>}
        {list.map((u) => (
          <div key={u.id} className="bk-photo-row">
            <Headshot user={u} size={40} />
            <span className="bk-photo-name">{u.username}{me && same(me.id, u.id) && <em> (you)</em>}</span>
            {u.has_src && (
              <button className="btn btn-plain btn-sm wi" onClick={() => adjust(u)} title="Re-crop or zoom this photo"><IconCrop size={13} /> Adjust</button>
            )}
            <label className="btn btn-plain btn-sm bk-upload">
              {busy[u.id] ? 'Opening…' : (u.avatar_v ? 'New photo' : 'Upload photo')}
              <input type="file" accept="image/*" hidden onChange={(e) => { pick(u, e.target.files[0]); e.target.value = ''; }} />
            </label>
            {u.avatar_v && <button className="bk-link" onClick={() => remove(u)}>Remove</button>}
          </div>
        ))}
        {!list.length && <p className="bk-photos-sub">No accounts yet.</p>}
        <div className="modal-actions"><button className="btn btn-ink" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}

function PastBracket({ id, onFetch, onBack, usersById }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    setD(null);
    setErr('');
    onFetch(id).then((x) => { if (live) setD(x); }).catch((e) => { if (live) setErr(e.message || 'Couldn’t load that bracket'); });
    return () => { live = false; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const noop = () => {};
  return (
    <>
      <div className="bk-past-banner">
        <button className="btn btn-plain btn-sm" onClick={onBack}>← Back to current bracket</button>
        {d && <span>Past bracket · <b>{d.bracket.name}</b> · {fmtDay(d.bracket.completed_at || d.bracket.created_at)}</span>}
      </div>
      {err && <div className="bk-err">{err}</div>}
      {!d && !err && <p className="ov-empty">Loading…</p>}
      {d && (
        <>
          {d.bracket.champion_name && <ChampionBanner name={d.bracket.champion_name} bracketName={d.bracket.name} />}
          <BracketBoard
            bracket={d.bracket} entrants={d.entrants} matches={d.matches} votes={d.votes}
            usersById={usersById} meId={null} readOnly editNames={false}
            onVote={noop} onAskWin={noop} onAskUndo={noop} onRename={noop} onRenameRegion={noop}
          />
          {(d.bracket.notes || '').trim() && (
            <div className="notes-panel bk-notes">
              <label className="notes-label"><IconNote size={14} /> Bracket notes</label>
              <div className="bk-notes-read">{d.bracket.notes}</div>
            </div>
          )}
        </>
      )}
    </>
  );
}

export default function BracketView({
  brackets, entrants, matches, votes, users, me,
  onVote, onDeclare, onUndo, onCreate, onPatch, onRenameEntrant, onDeletePast, onFetchPast, onSetAvatar,
}) {
  // One bracket for everyone: the newest un-archived one is current, and every
  // other bracket is history. (brackets arrive newest first.)
  const current = brackets.find((b) => !b.archived) || null;
  const past = brackets.filter((b) => !current || !same(b.id, current.id));
  const [setup, setSetup] = useState(false);
  const [editNames, setEditNames] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [photosOpen, setPhotosOpen] = useState(false);
  const [pastView, setPastView] = useState(null);

  const usersById = {};
  users.forEach((u) => { usersById[String(u.id)] = u; });
  const meUser = me ? (usersById[String(me.id)] || { id: me.id, username: me.username }) : null;

  const curEntrants = current ? entrants.filter((e) => same(e.bracket_id, current.id)) : [];
  const curMatches = current ? matches.filter((m) => same(m.bracket_id, current.id)) : [];
  const matchIds = new Set(curMatches.map((m) => String(m.id)));
  const curVotes = votes.filter((v) => matchIds.has(String(v.match_id)));
  const nameOf = (eid) => (curEntrants.find((e) => same(e.id, eid)) || {}).name || 'TBD';
  const countFor = (m, eid) => curVotes.filter((v) => same(v.match_id, m.id) && same(v.entrant_id, eid)).length;
  const champ = current && current.champion_id ? curEntrants.find((e) => same(e.id, current.champion_id)) : null;
  const openRound = current ? currentRound(curMatches) : null;
  const openMatches = openRound === null ? [] : curMatches.filter((m) => Number(m.round) === openRound);
  const openDone = openMatches.filter((m) => m.winner_id).length;
  const openTotal = openMatches.length;

  const askWin = (m, eid) => {
    const otherId = same(eid, m.a_id) ? m.b_id : m.a_id;
    const w = nameOf(eid);
    const o = nameOf(otherId);
    const vw = countFor(m, eid);
    const vo = countFor(m, otherId);
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
      onConfirm: () => onDeclare(m.id, eid),
    });
  };

  const askUndo = (m) => {
    const w = nameOf(m.winner_id);
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
      onConfirm: () => onUndo(m.id),
    });
  };

  const startNew = () => {
    if (current && !current.champion_id) {
      setConfirm({
        title: 'Start a new bracket?',
        lines: [`“${current.name}” doesn’t have a champion yet.`, 'Once you create the new one, this one moves to Past brackets as unfinished.'],
        confirmLabel: 'Set up new bracket',
        onConfirm: () => setSetup(true),
      });
    } else {
      setSetup(true);
    }
  };

  const askDelete = (b) => setConfirm({
    title: `Delete “${b.name}”?`,
    lines: ['This removes it from Past brackets for good, including its votes and notes.'],
    confirmLabel: 'Delete bracket',
    danger: true,
    onConfirm: () => { if (same(pastView, b.id)) setPastView(null); onDeletePast(b.id); },
  });

  const renameRegion = (q, v) => {
    const r = parseRegions(current.regions);
    r[q] = v;
    onPatch(current.id, { regions: r });
  };

  let body;
  if (pastView) {
    body = <PastBracket id={pastView} onFetch={onFetchPast} onBack={() => setPastView(null)} usersById={usersById} />;
  } else if (setup || !current) {
    body = (
      <BracketSetup
        isFirst={!current && !past.length}
        canCancel={!!current}
        onCancel={() => setSetup(false)}
        onCreate={async (p) => {
          const ok = await onCreate(p);
          if (ok) { setSetup(false); setEditNames(false); }
          return ok;
        }}
      />
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
                onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                onSave={(v) => { const n = v.trim(); if (!n) return false; onPatch(current.id, { name: n }); return true; }}
              />
            ) : (
              <h2 className="bk-title">{current.name}</h2>
            )}
            <div className="bk-hint">
              {editNames
                ? 'Editing names — click any name to fix it. Votes are paused while editing.'
                : <>Tap a name to vote (tap again to take it back) · <IconCrown size={12} /> declares the winner once everyone’s voted</>}
            </div>
          </div>
          <div className="bk-actions">
            {meUser && (
              <span className="bk-voting-as">
                <Headshot user={meUser} size={24} /> Voting as <b>{meUser.username}</b>
                {!meUser.avatar_v && <button className="bk-link" onClick={() => setPhotosOpen(true)}>add your photo</button>}
              </span>
            )}
            <button className="btn btn-plain btn-sm wi" onClick={() => setPhotosOpen(true)}><IconCamera size={14} /> Voter photos</button>
            <button className="btn btn-plain btn-sm wi" onClick={() => setEditNames((x) => !x)}>
              {editNames ? <><IconCheck size={14} /> Done editing</> : <><IconPencil size={14} /> Edit names</>}
            </button>
            <button className="btn btn-lime btn-sm" onClick={startNew}>+ New bracket</button>
          </div>
        </div>
        {champ && <ChampionBanner name={champ.name} bracketName={current.name} onNew={startNew} />}
        {openRound !== null && (
          <div className="bk-round-status">
            <span className="bk-rs-dot" aria-hidden="true" />
            <span>Voting open: <b>{ROUNDS[openRound]}</b> · {openDone} of {openTotal} decided</span>
            {openRound < ROUNDS.length - 1 && (
              <span className="bk-rs-next"><IconLock size={12} /> The {ROUNDS[openRound + 1]} opens once every {ROUNDS[openRound]} matchup has a winner</span>
            )}
          </div>
        )}
        <BracketBoard
          bracket={current} entrants={curEntrants} matches={curMatches} votes={curVotes}
          usersById={usersById} meId={me ? me.id : null} readOnly={false} editNames={editNames}
          onVote={onVote} onAskWin={askWin} onAskUndo={askUndo}
          onRename={onRenameEntrant} onRenameRegion={renameRegion}
        />
        <div className="notes-panel bk-notes">
          <label className="notes-label"><IconNote size={14} /> Bracket notes <span>· info to help everyone make an informed vote</span></label>
          <SyncedTextarea
            key={current.id}
            className="notes-area bk-notes-area"
            value={current.notes || ''}
            placeholder="Stats, context, links, hot takes — anything people should know before they vote…"
            onSave={(v) => onPatch(current.id, { notes: v })}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <div className="proj-head">
        <h1 className="wi-h"><IconTrophy size={24} /> Bracket</h1>
      </div>
      {body}
      {past.length > 0 && (
        <section className="bk-history">
          <h3 className="section-title">Past brackets</h3>
          {past.map((b) => (
            <div key={b.id} className={`bk-past-row${same(pastView, b.id) ? ' on' : ''}`}>
              <button className="bk-past-open" onClick={() => setPastView(b.id)} title="View this bracket">
                <span className="bk-past-name">{b.name}</span>
                <span className="bk-past-champ">{b.champion_name ? <><IconTrophy size={14} /> {b.champion_name}</> : <i>No champion</i>}</span>
                <span className="bk-past-date">{fmtDay(b.completed_at || b.created_at)}</span>
              </button>
              <button className="bk-icon-btn" title="Delete from history" onClick={() => askDelete(b)}><IconTrash size={15} /></button>
            </div>
          ))}
        </section>
      )}
      {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}
      {photosOpen && <VoterPhotosModal users={users} me={me} onSetAvatar={onSetAvatar} onClose={() => setPhotosOpen(false)} />}
    </>
  );
}
