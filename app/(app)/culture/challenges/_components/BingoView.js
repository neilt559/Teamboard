'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/app/_ui/api';
import useServerState from '@/app/_ui/useServerState';
import { useRefreshOnFocus } from '@/app/_ui/useRefresh';
import { useConfirm } from '@/app/_ui/ConfirmDialog';
import Crumbs from '@/app/_ui/Crumbs';
import { FormattedNotes } from '@/app/notes-format';
import { IconPencil, IconArchive, IconRestore, IconCalendar, IconTrophy, IconCheck, IconBuilding } from '@/app/icons';
import { fmtDay, fmtRange } from '@/lib/challenges';
import { CORNERS, LINES, canUndo, lineLabel } from '@/lib/bingo';
import { StatusChip } from './ChallengeCard';

// The office bingo page (Neil, 2026-10-19; rules in lib/bingo.js). One shared 5x5 card per playing office; each
// office marks ONE square a day (Central) for what its GeoGuessr round earned, on the honor system. The prizes are
// First bingo (five in a row, any direction) and Four corners. Your office's card comes first; a square you can
// mark is a button, and marking asks once before it counts. Today's square can be undone by the office (so a slip
// can be fixed); admins can mark or undo any office's square.

const LETTERS = ['C', 'A', 'G', 'E', 'O'];   // CAGEO: Neil's name for office bingo

function Prize({ label, win, hint }) {
  return (
    <div className={`bg-prize${win ? ' is-won' : ''}`}>
      <span className="bg-prize-icon"><IconTrophy size={20} /></span>
      <span className="bg-prize-main">
        <span className="bg-prize-label">{label}</span>
        {win
          ? <span className="bg-prize-who"><b>{win.office_name}</b> · {fmtDay(win.play_date, { weekday: true })}{win.line ? ` · ${lineLabel(win.line)}` : ''}</span>
          : <span className="bg-prize-who muted">{hint}</span>}
      </span>
    </div>
  );
}

function Card({ c, o, today, winners, busy, onMark }) {
  const squares = c.squares || [];
  const pickBy = new Map(o.picks.map((p) => [p.square, p]));
  const inLine = new Set(LINES.filter((l) => o.lines.includes(l.key)).flatMap((l) => l.cells));
  const bingoCells = new Set(o.bingo_line ? LINES.find((l) => l.key === o.bingo_line)?.cells || [] : []);
  const cornersDone = !!o.corners_pick_id;
  const firstBingo = winners.bingo?.office_id === o.id;
  const firstCorners = winners.corners?.office_id === o.id;
  return (
    <section className={`bg-card${o.mine ? ' is-mine' : ''}${o.can_mark ? ' can-mark' : ''}`} aria-label={`${o.name} CAGEO card`}>
      <header className="bg-card-head">
        <h2 className="bg-card-name"><IconBuilding size={16} /> {o.name}{o.mine && <span className="ch-you-tag">Your office</span>}</h2>
        <span className="bg-card-count"><b>{o.marks}</b> of {squares.length}</span>
      </header>
      {(o.bingo_pick_id || cornersDone) && (
        <div className="bg-card-badges">
          {o.bingo_pick_id && <span className={`bg-badge${firstBingo ? ' is-first' : ''}`}>{firstBingo ? 'First CAGEO' : 'CAGEO'}</span>}
          {cornersDone && <span className={`bg-badge${firstCorners ? ' is-first' : ''}`}>{firstCorners ? 'Four corners winner' : 'Four corners'}</span>}
        </div>
      )}
      <div className="bg-grid" role="group" aria-label={`${o.name}: ${o.marks} squares marked`}>
        {LETTERS.map((l) => <span key={l} className="bg-letter" aria-hidden="true">{l}</span>)}
        {squares.map((label, i) => {
          const p = pickBy.get(i);
          const cls = ['bg-sq'];
          if (p) cls.push('is-marked');
          if (p && p.play_date === today) cls.push('is-today');
          if (inLine.has(i)) cls.push('in-line');
          if (bingoCells.has(i)) cls.push('in-bingo');
          if (CORNERS.includes(i)) cls.push('is-corner');
          if (cornersDone && CORNERS.includes(i)) cls.push('in-corners');
          const inner = (
            <>
              <span className="bg-sq-text">{label}</span>
              {p && <span className="bg-dab" aria-hidden="true" />}
              {p && <span className="bg-day" aria-hidden="true">{fmtDay(p.play_date).replace(' ', '\u00a0')}</span>}
            </>
          );
          const title = p ? `${label} (marked ${fmtDay(p.play_date, { weekday: true })}${p.picked_by_name ? ` by ${p.picked_by_name}` : ''})` : label;
          if (!p && o.can_mark) {
            return (
              <button key={i} type="button" className={`${cls.join(' ')} is-open`} title={`Mark: ${label}`}
                disabled={busy} data-square={i} onClick={() => onMark(o, i)}>{inner}</button>
            );
          }
          return <div key={i} className={cls.join(' ')} title={title} aria-label={title} data-square={i}>{inner}</div>;
        })}
      </div>
    </section>
  );
}

export default function BingoView({ initial, viewer }) {
  const router = useRouter();
  useRefreshOnFocus(30_000);
  const [data, setData] = useServerState(initial);
  const [confirmUI, ask] = useConfirm();
  const [toast, setToast] = useState(null);           // { text, undo?: () => void }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const c = data.challenge;
  const today = data.today;
  const board = data.bingo;
  const mine = board.offices.filter((o) => o.mine);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), toast.undo ? 9000 : 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const setArchived = async (archived) => {
    if (archived) {
      const yes = await ask({
        title: `Archive “${c.title}”?`,
        lines: ['It disappears from the challenge list, Home and the Culture page. Every marked square is kept, and an organizer can restore it any time.'],
        confirmLabel: 'Archive',
      });
      if (!yes) return;
    }
    setBusy(true);
    setErr('');
    try {
      const r = await api(`/api/culture/challenges/${c.id}`, { method: 'PATCH', body: { archived } });
      setData((d) => ({ ...d, challenge: { ...d.challenge, ...r.row } }));
      setToast({ text: archived ? 'Challenge archived.' : 'Challenge restored.' });
      router.refresh();
    } catch (e) {
      setErr(e.message || 'That didn’t work.');
    } finally {
      setBusy(false);
    }
  };

  const undo = async (pick, { confirm = true } = {}) => {
    const office = board.offices.find((o) => o.id === pick.office_id);
    if (confirm) {
      const yes = await ask({
        title: 'Undo this square?',
        lines: [`“${c.squares[pick.square]}”`, `${office?.name || 'The office'}, ${fmtDay(pick.play_date, { weekday: true })}.${pick.play_date === today ? ' The office can mark a different square today.' : ''}`],
        confirmLabel: 'Undo it',
      });
      if (!yes) return;
    }
    setToast(null);
    setBusy(true);
    try {
      const r = await api(`/api/culture/bingo-picks/${pick.id}`, { method: 'DELETE' });
      setData((d) => ({ ...d, bingo: r.board }));
      setToast({ text: 'Square undone.' });
      router.refresh();
    } catch (e) {
      setToast({ text: e.message || 'Couldn’t undo it.' });
    } finally {
      setBusy(false);
    }
  };

  const mark = async (o, square) => {
    const lines = [`“${c.squares[square]}”`,
      `This is ${o.name}’s one square for ${fmtDay(today, { weekday: true })}. Honor system: it should match today’s GeoGuessr round.`];
    if (!o.mine) lines.push(`You’re not in ${o.name}. You’re marking it as an admin.`);
    const yes = await ask({ title: `Mark this square for ${o.name}?`, lines, confirmLabel: 'Mark it' });
    if (!yes) return;
    setBusy(true);
    setErr('');
    try {
      const r = await api(`/api/culture/challenges/${c.id}/bingo`, { method: 'POST', body: { office_id: o.id, square } });
      setData((d) => ({ ...d, bingo: r.board }));
      const after = r.board.offices.find((x) => x.id === o.id);
      const won = [r.board.winners.bingo?.office_id === o.id && !board.winners.bingo ? 'CAGEO! First CAGEO' : null,
        r.board.winners.corners?.office_id === o.id && !board.winners.corners ? 'Four corners' : null].filter(Boolean);
      setToast({
        text: won.length ? `${won.join(' and ')} for ${o.name}!` : `Marked for ${o.name}: ${after?.marks ?? ''} of 25.`,
        undo: () => undo(r.pick, { confirm: false }),
      });
      router.refresh();
    } catch (e) {
      setErr(e.message || 'That didn’t save.');
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const running = data.status === 'running';
  const history = board.offices.flatMap((o) => o.picks.map((p) => ({ ...p, office_name: o.name })))
    .sort((a, b) => (a.play_date < b.play_date ? 1 : a.play_date > b.play_date ? -1 : String(b.created_at).localeCompare(String(a.created_at))));
  return (
    <div className="ch-page ch-detail bg-page">
      <Crumbs items={[{ label: 'Culture', href: '/culture' }, { label: 'Challenges', href: '/culture/challenges' }, { label: c.title || 'CAGEO' }]} />
      <div className="proj-head ch-head">
        <h1 className="wi-h"><span className="bg-mark" aria-hidden="true">C</span> <span className="ch-title">{c.title || 'CAGEO'}</span></h1>
        <div className="spacer" />
        {data.can.manage && (
          <div className="ch-head-actions">
            <Link href={`/culture/challenges/${c.id}/edit`} prefetch={false} className="btn btn-plain btn-sm wi"><IconPencil size={14} /> Edit</Link>
            {c.archived
              ? <button type="button" className="btn btn-ink btn-sm wi" disabled={busy} onClick={() => setArchived(false)}><IconRestore size={14} /> Restore</button>
              : <button type="button" className="btn btn-plain btn-sm wi" disabled={busy} onClick={() => setArchived(true)}><IconArchive size={14} /> Archive</button>}
          </div>
        )}
      </div>
      {c.archived && (
        <div className="ch-banner" role="status"><IconArchive size={15} /> This challenge is archived. Only organizers can see it until it’s restored.</div>
      )}
      <div className="ch-chips">
        <StatusChip c={{ ...c, status: data.status }} today={today} />
        <span className="ch-chip ch-chip-company">CAGEO</span>
        <span className="ch-chip ch-chip-dates"><IconCalendar size={12} /> {fmtRange(c.starts_on, c.ends_on)}</span>
      </div>
      {String(c.description || '').trim() && (
        <div className="ch-desc"><FormattedNotes text={c.description} linkify /></div>
      )}

      <div className="bg-prizes">
        <Prize label="First CAGEO" win={board.winners.bingo} hint="Five in a row: across, down or diagonal." />
        <Prize label="Four corners" win={board.winners.corners} hint="All four corner squares." />
      </div>

      <div id="today" className="bg-today">
        {mine.length === 0 && (
          <p className="bg-today-line muted">
            {viewer.is_admin ? 'You’re not in a playing office. As an admin you can still mark or undo a square for any office.' : 'Your office isn’t playing in this one. Follow along below.'}
          </p>
        )}
        {mine.map((o) => {
          const p = o.today_pick;
          return (
            <p key={o.id} className={`bg-today-line${p ? ' is-done' : ''}`}>
              {p ? (
                <>
                  <IconCheck size={15} /> <span><b>{o.name}</b> marked today’s square: “{c.squares[p.square]}”{p.picked_by_name ? ` (${p.picked_by_name})` : ''}. Next pick tomorrow.</span>
                  {canUndo(viewer, c, p, today) && <button type="button" className="btn btn-plain btn-sm bg-today-undo" disabled={busy} onClick={() => undo(p)}>Undo</button>}
                </>
              ) : running ? (
                <span><b>{o.name}</b> hasn’t marked a square today. After your GeoGuessr round, tap the square it earned.</span>
              ) : data.status === 'upcoming' ? (
                <span>The card opens {fmtDay(c.starts_on, { weekday: true })}.</span>
              ) : (
                <span>This CAGEO is over.</span>
              )}
            </p>
          );
        })}
      </div>
      {err && <p className="ch-error" role="alert">{err}</p>}

      <div className={`bg-cards bg-cards-${Math.min(board.offices.length, 3)}`}>
        {board.offices.map((o) => (
          <Card key={o.id} c={c} o={o} today={today} winners={board.winners} busy={busy} onMark={mark} />
        ))}
        {board.offices.length === 0 && <p className="ch-quiet">No offices are playing yet. An organizer can add them with Edit.</p>}
      </div>

      <details className="ch-panel bg-history">
        <summary className="ch-panel-h">Every square marked <span className="ch-count">{history.length}</span></summary>
        {history.length === 0 ? <p className="ch-quiet">Nothing marked yet.</p> : (
          <ul className="bg-hist">
            {history.map((p) => (
              <li key={p.id} className="bg-hist-row">
                <span className="bg-hist-date">{fmtDay(p.play_date, { weekday: true })}</span>
                <span className="bg-hist-office">{p.office_name}</span>
                <span className="bg-hist-sq">“{c.squares[p.square]}”</span>
                <span className="bg-hist-who">{p.picked_by_name || ''}</span>
                {canUndo(viewer, c, p, today) && (
                  <button type="button" className="btn btn-plain btn-sm" disabled={busy} onClick={() => undo(p)}>Undo</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </details>

      {toast && (
        <div className="ch-toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && <button type="button" className="ch-toast-undo" onClick={toast.undo}>Undo</button>}
        </div>
      )}
      {confirmUI}
    </div>
  );
}

