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
import { IconPencil, IconArchive, IconRestore, IconCalendar, IconTrophy, IconLock, IconEye } from '@/app/icons';
import { fmtDay, fmtRange } from '@/lib/challenges';
import { addDays } from '@/lib/time';
import { SCORE_MAX, SCORE_MIN, fmtAvg } from '@/lib/chili';
import { StatusChip, ScopeChip } from './ChallengeCard';
import { Medal } from './Medal';

// The chili cook-off page (Neil, 2026-10-20; rules in lib/chili.js). Before the reveal: one card per weekly chili,
// numbered (the cooks stay hidden), each with 1-10 buttons once its week starts; your own rating shows only to you,
// with the number of ratings in. After the reveal: the ranking by average rating, with the cooks and the winner.
// The server never sends anything more than this page shows (lib/queries/chili.js).

// A chili pepper drawn as a line icon (the app uses no emoji).
const ChiliIcon = () => (
  <svg className="cz-mark" aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15.5 5.5c.3-1.6 1.4-2.8 3-3" />
    <path d="M12.5 7.5c1.9-1.9 5.2-1.6 6.5.6 1.6 2.7.4 6.8-3.4 9.9-3.1 2.5-7.4 3.9-11.6 3.5 3.6-1.9 5.8-4.6 6.6-8.4.4-2.1.8-4.4 1.9-5.6z" />
  </svg>
);

const SCORES = Array.from({ length: SCORE_MAX - SCORE_MIN + 1 }, (_, i) => SCORE_MIN + i);
const ratingsIn = (n) => `${n} rating${n === 1 ? '' : 's'} in`;

function ChiliCard({ x, canRate, busy, onRate }) {
  return (
    <section className={`cz-card${x.open ? ' is-open' : ''}${x.is_cook ? ' is-cook' : ''}`} aria-label={`Chili number ${x.n}`}>
      <header className="cz-card-head">
        <span className="cz-num">#{x.n}</span>
        <span className="cz-card-title">Chili #{x.n}<span className="cz-week">Week of {fmtDay(x.week_of)}</span></span>
      </header>
      {x.is_cook ? (
        <p className="cz-note">This is your chili, so you can’t rate it. Good luck!</p>
      ) : x.upcoming ? (
        <p className="cz-note"><IconLock size={13} /> Rating opens {fmtDay(x.week_of, { weekday: true })}.</p>
      ) : x.open && canRate ? (
        <>
          <div className="cz-scale" role="radiogroup" aria-label={`Your rating for chili ${x.n}`}>
            {SCORES.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={x.mine === s} className={`cz-score${x.mine === s ? ' on' : ''}`}
                disabled={busy} onClick={() => onRate(x, s)}>{s}</button>
            ))}
          </div>
          <p className="cz-mine">
            {x.mine != null ? <>Your rating: <b>{x.mine}</b> <span className="cz-private"><IconEye size={12} /> only you can see it</span></> : 'Tap a number to rate it (1 = not great, 10 = amazing).'}
          </p>
        </>
      ) : (
        <p className="cz-note">{x.mine != null ? <>Your rating: <b>{x.mine}</b></> : canRate ? 'Ratings are closed.' : 'This cook-off is for another office.'}</p>
      )}
      <p className="cz-count">{ratingsIn(x.count)}</p>
    </section>
  );
}

function Results({ chilis }) {
  const winners = chilis.filter((x) => x.rank === 1);
  return (
    <>
      {winners.length > 0 && (
        <div className="cz-winner" role="status">
          <span className="cz-winner-icon"><IconTrophy size={26} /></span>
          <div>
            <p className="cz-winner-k">{winners.length > 1 ? 'It’s a tie!' : 'The winner'}</p>
            <p className="cz-winner-name">{winners.map((w) => w.cook_name).join(' and ')}</p>
            <p className="cz-winner-avg">{fmtAvg(winners[0].average)} average · {ratingsIn(winners[0].count)}</p>
          </div>
        </div>
      )}
      <ol className="cz-results">
        {chilis.map((x) => (
          <li key={x.id} className={`cz-res${x.rank === 1 ? ' is-first' : ''}`}>
            <span className="cz-res-rank">{x.rank ? <Medal rank={x.rank} size={24} /> : <span className="ch-rank-num">–</span>}</span>
            <span className="cz-res-main">
              <span className="cz-res-name">{x.cook_name}</span>
              <span className="cz-res-meta">Chili #{x.n} · week of {fmtDay(x.week_of)}{x.mine != null ? ` · you gave it ${x.mine}` : ''}</span>
            </span>
            <span className="cz-res-avg"><b>{fmtAvg(x.average)}</b><span>{ratingsIn(x.count)}</span></span>
          </li>
        ))}
      </ol>
      <p className="ch-quiet">Each chili’s score is the average of everyone’s ratings. Individual ratings stay private.</p>
    </>
  );
}

export default function ChiliView({ initial }) {
  const router = useRouter();
  useRefreshOnFocus(30_000);
  const [data, setData] = useServerState(initial);
  const [confirmUI, ask] = useConfirm();
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const c = data.challenge;
  const today = data.today;
  const z = data.chili;
  const revealOn = addDays(c.ends_on, 1);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const patch = async (body, done) => {
    setBusy(true);
    setErr('');
    try {
      const r = await api(`/api/culture/challenges/${c.id}`, { method: 'PATCH', body });
      setData((d) => ({ ...d, challenge: { ...d.challenge, ...r.row } }));
      setToast({ text: done });
      router.refresh();
    } catch (e) {
      setErr(e.message || 'That didn’t work.');
    } finally {
      setBusy(false);
    }
  };
  const setArchived = async (archived) => {
    if (archived && !(await ask({ title: `Archive “${c.title}”?`, lines: ['It disappears from the challenge list, Home and the Culture page. Every rating is kept, and an organizer can restore it any time.'], confirmLabel: 'Archive' }))) return;
    patch({ archived }, archived ? 'Challenge archived.' : 'Challenge restored.');
  };
  const reveal = async () => {
    const yes = await ask({
      title: 'Reveal the results now?',
      lines: ['Everyone will see each chili’s average rating, who made it, and the winner. Ratings close for good.', `Otherwise the results reveal on their own on ${fmtDay(revealOn, { weekday: true })}.`],
      confirmLabel: 'Reveal results',
    });
    if (yes) patch({ reveal: true }, 'Results revealed!');
  };

  const rate = async (x, score) => {
    setBusy(true);
    setErr('');
    try {
      const r = await api(`/api/culture/chilis/${x.id}/rating`, { method: 'POST', body: { score } });
      setData((d) => {
        const chilis = d.chili.chilis.map((y) => (y.id === x.id ? { ...y, mine: r.chili.mine, count: r.chili.count } : y));
        return { ...d, chili: { ...d.chili, chilis, my_rated: chilis.filter((y) => y.mine != null).length } };
      });
      setToast({ text: `Chili #${x.n}: you gave it ${score}. Only you can see that.` });
    } catch (e) {
      setErr(e.message || 'That didn’t save.');
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const rateable = z.chilis.filter((x) => !x.is_cook).length;
  return (
    <div className="ch-page ch-detail cz-page">
      <Crumbs items={[{ label: 'Culture', href: '/culture' }, { label: 'Challenges', href: '/culture/challenges' }, { label: c.title || 'Chili cook-off' }]} />
      <div className="proj-head ch-head">
        <h1 className="wi-h"><ChiliIcon /> <span className="ch-title">{c.title || 'Chili cook-off'}</span></h1>
        <div className="spacer" />
        {data.can.manage && (
          <div className="ch-head-actions">
            {!z.revealed && !c.archived && <button type="button" className="btn btn-ink btn-sm wi" disabled={busy} onClick={reveal}><IconTrophy size={14} /> Reveal results</button>}
            <Link href={`/culture/challenges/${c.id}/edit`} prefetch={false} className="btn btn-plain btn-sm wi"><IconPencil size={14} /> Edit</Link>
            {c.archived
              ? <button type="button" className="btn btn-ink btn-sm wi" disabled={busy} onClick={() => setArchived(false)}><IconRestore size={14} /> Restore</button>
              : <button type="button" className="btn btn-plain btn-sm wi" disabled={busy} onClick={() => setArchived(true)}><IconArchive size={14} /> Archive</button>}
          </div>
        )}
      </div>
      {c.archived && <div className="ch-banner" role="status"><IconArchive size={15} /> This challenge is archived. Only organizers can see it until it’s restored.</div>}
      <div className="ch-chips">
        <StatusChip c={{ ...c, status: data.status }} today={today} />
        <ScopeChip c={c} />
        <span className="ch-chip ch-chip-metric">Chili cook-off</span>
        <span className="ch-chip ch-chip-dates"><IconCalendar size={12} /> {fmtRange(c.starts_on, c.ends_on)}</span>
      </div>
      {String(c.description || '').trim() && <div className="ch-desc"><FormattedNotes text={c.description} linkify /></div>}
      {err && <p className="ch-error" role="alert">{err}</p>}

      {z.revealed ? <Results chilis={z.chilis} /> : (
        <>
          <div className="cz-secret">
            <IconLock size={15} />
            <span>Blind and secret: nobody sees anyone’s ratings, or whose chili is whose, until the results reveal on <b>{fmtDay(revealOn, { weekday: true })}</b>.
              {data.can.rate && rateable > 0 ? <> You’ve rated <b>{z.my_rated}</b> of {rateable}.</> : null}</span>
          </div>
          {z.chilis.length === 0
            ? <p className="ch-quiet">No chilis scheduled yet.</p>
            : <div className="cz-grid">{z.chilis.map((x) => <ChiliCard key={x.id} x={x} canRate={data.can.rate} busy={busy} onRate={rate} />)}</div>}
        </>
      )}

      {toast && <div className="ch-toast" role="status"><span>{toast.text}</span></div>}
      {confirmUI}
    </div>
  );
}
