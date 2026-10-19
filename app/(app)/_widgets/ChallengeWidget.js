import Link from 'next/link';
import { requirePageViewer, tagUpdating } from '@/lib/viewer';
import { nowFromRequestContext } from '@/lib/clock';
import { loadChallengeSummary } from '@/lib/queries/challenges';
import { fmtDay, fmtRange, fmtScore, metricLine, timeLabel } from '@/lib/challenges';
import { IconMedal, IconBuilding, IconChevronRight, IconCheck, IconPlus } from '@/app/icons';
import { Medal } from '../culture/challenges/_components/Medal';
import { TopRow } from '../culture/challenges/_components/ChallengeCard';
import { BingoMyLine, BingoOffices, BingoWinners } from '../culture/challenges/_components/BingoSummary';

// Home dashboard widget 'challenge' (design §2.1 "this month's challenge", §10(a), §11; agent K1) and the
// challenge cards on /culture. Async Server Components that load their own data (one cached loader per request):
//   <ChallengeWidget viewer={viewer} now={now} />   Home
//   <ChallengeHubCards viewer={viewer} now={now} />  /culture: the current challenge(s) and past challenges
// The featured challenge is the company challenge running today (Central); office challenges for the viewer's
// and followed offices show alongside. Shows the viewer's score and rank, the top 5 and a "Log my stats" button.

async function load(viewer, now) {
  const v = viewer || await requirePageViewer();
  try {
    return { v, s: await loadChallengeSummary(v, now ?? nowFromRequestContext()) };
  } catch (e) {
    throw tagUpdating(e);                         // the dashboard's WidgetBoundary shows "This card couldn't load"
  }
}

function MyLine({ c }) {
  if (c.me?.score == null) {
    return <span className="ch-w-me muted">{c.can_log ? 'You haven’t logged anything yet.' : c.status === 'upcoming' ? `Starts ${fmtDay(c.starts_on)}.` : 'You’re not in this one.'}</span>;
  }
  return (
    <span className="ch-w-me">
      You: <b>{fmtScore(c, c.me.score)}</b>
      {c.me.rank ? <> · <b>#{c.me.rank}</b> of {c.participants}</> : null}
    </span>
  );
}

// Office bingo: each office's marks, the prizes, and a button to today's square when the viewer's office has one open.
function FeaturedBingo({ c, today }) {
  return (
    <div className="ch-w-feature">
      <Link href={`/culture/challenges/${c.id}`} prefetch={false} className="ch-w-title">{c.title || 'Office bingo'}</Link>
      <span className="ch-w-meta">
        {c.status === 'running' ? <span className="ch-live-dot" aria-hidden="true" /> : null}
        {timeLabel(c, today)} · Office bingo
      </span>
      <div className="ch-w-mine">
        <BingoMyLine c={c} />
        {c.can_mark && (
          <Link href={`/culture/challenges/${c.id}#today`} prefetch={false} className="btn btn-lime btn-sm wi ch-w-log"><IconCheck size={14} /> Mark today’s square</Link>
        )}
      </div>
      <BingoOffices c={c} />
      <BingoWinners c={c} />
    </div>
  );
}

function Featured({ c, viewerId, today }) {
  if (c.kind === 'bingo') return <FeaturedBingo c={c} today={today} />;
  return (
    <div className="ch-w-feature">
      <Link href={`/culture/challenges/${c.id}`} prefetch={false} className="ch-w-title">{c.title || 'This month’s challenge'}</Link>
      <span className="ch-w-meta">
        {c.status === 'running' ? <span className="ch-live-dot" aria-hidden="true" /> : null}
        {timeLabel(c, today)} · {metricLine(c)}{c.office_id ? ` · ${c.office_name} office` : ''}
      </span>
      <div className="ch-w-mine">
        <MyLine c={c} />
        {c.can_log && (
          <Link href={`/culture/challenges/${c.id}#log`} prefetch={false} className="btn btn-lime btn-sm wi ch-w-log"><IconCheck size={14} /> Log my stats</Link>
        )}
      </div>
      {c.top?.length > 0 ? (
        <ol className="ch-toplist" aria-label={`${c.title} top 5`}>
          {c.top.map((r) => <TopRow key={r.user_id} c={c} r={r} you={r.user_id === String(viewerId)} />)}
        </ol>
      ) : (
        <p className="widget-empty">{c.status === 'upcoming' ? 'The leaderboard opens when it starts.' : 'No stats logged yet. Be the first!'}</p>
      )}
    </div>
  );
}

function OtherRow({ c }) {
  const lead = (c.top || [])[0];
  return (
    <li className="wl-item">
      <Link href={`/culture/challenges/${c.id}`} prefetch={false} className="wl-row ch-w-other">
        <span className="ch-w-other-icon">{c.office_id ? <IconBuilding size={15} /> : <IconMedal size={15} />}</span>
        <span className="wl-main">
          <span className="wl-name">{c.title}</span>
          <span className="wl-meta">
            {c.office_id ? `${c.office_name} office · ` : ''}{timeLabel(c, c._today)}
            {c.kind === 'bingo' ? ` · ${(c.bingo?.offices || []).map((o) => `${o.name} ${o.marks}`).join(', ')}`
              : c.me?.score != null ? ` · You: ${fmtScore(c, c.me.score)}${c.me.rank ? ` (#${c.me.rank})` : ''}` : lead ? ` · Leading: ${lead.name}` : ''}
          </span>
        </span>
        <IconChevronRight size={15} className="sp-row-go" />
      </Link>
    </li>
  );
}

export default async function ChallengeWidget({ viewer, now } = {}) {
  const { v, s } = await load(viewer, now);
  const main = s.featured || s.others[0] || null;
  const rest = s.others.filter((c) => c !== main).map((c) => ({ ...c, _today: s.today }));
  const last = s.recent[0] || null;
  const lastWinners = last && last.kind !== 'bingo' ? (last.top || []).filter((r) => r.rank === 1) : [];
  return (
    <section className="widget ch-widget" aria-labelledby="w-challenge">
      <div className="widget-head">
        <h2 id="w-challenge" className="widget-title wi-h"><IconMedal size={18} /> {main && !main.office_id ? 'This month’s challenge' : 'Challenge'}</h2>
        <Link href="/culture/challenges" prefetch={false} className="widget-more">All challenges →</Link>
      </div>
      {main ? <Featured c={main} viewerId={v.id} today={s.today} /> : (
        <div className="ch-w-none">
          <p className="widget-empty">No challenge is running right now.</p>
          {s.next && (
            <p className="widget-empty">
              Next: <Link href={`/culture/challenges/${s.next.id}`} prefetch={false}>{s.next.title}</Link> starts {fmtDay(s.next.starts_on, { weekday: true })}.
            </p>
          )}
          {s.can_manage && !s.next && (
            <Link href="/culture/challenges/new" prefetch={false} className="btn btn-plain btn-sm wi"><IconPlus size={14} /> Set one up</Link>
          )}
        </div>
      )}
      {rest.length > 0 && (
        <ul className="widget-list ch-w-others">
          {rest.map((c) => <OtherRow key={c.id} c={c} />)}
        </ul>
      )}
      {!main && last && lastWinners.length > 0 && (
        <p className="ch-w-last">
          <Medal rank={1} size={18} /> <span>Last time, <b>{lastWinners.map((w) => w.name).join(', ')}</b> won <Link href={`/culture/challenges/${last.id}`} prefetch={false}>{last.title}</Link> with {fmtScore(last, lastWinners[0].score)}.</span>
        </p>
      )}
    </section>
  );
}

// /culture hub: the running challenge(s) as cards, then past challenges with their winners. Organizers get a nudge
// when nothing is running. part: 'current' (the running ones, or the nothing-running card), 'past', or 'all'.
export async function ChallengeHubCards({ viewer, now, part = 'all' } = {}) {
  const { v, s } = await load(viewer, now);
  const running = [s.featured, ...s.others].filter(Boolean);
  const cur = part !== 'past';
  const past = part !== 'current';
  return (
    <>
      {cur && running.map((c) => (
        <section key={c.id} className="home-card ch-hub-card" aria-label={c.title}>
          <span className="home-card-icon ch-hub-icon"><IconMedal size={22} /></span>
          <span className="home-card-main">
            <Link href={`/culture/challenges/${c.id}`} prefetch={false} className="home-card-name ch-hub-title">{c.title}</Link>
            <span className="home-card-stats">
              <span className="ch-live-dot" aria-hidden="true" />{timeLabel(c, s.today)} · {metricLine(c)}{c.office_id ? ` · ${c.office_name} office` : ''}
            </span>
            {c.kind === 'bingo' ? (
              <>
                <BingoMyLine c={c} />
                <BingoOffices c={c} />
                <BingoWinners c={c} short />
              </>
            ) : (
              <>
                <MyLine c={c} />
                {c.top?.length > 0 && (
                  <ol className="ch-toplist ch-toplist-sm">
                    {c.top.slice(0, 3).map((r) => <TopRow key={r.user_id} c={c} r={r} you={r.user_id === String(v.id)} />)}
                  </ol>
                )}
              </>
            )}
            <span className="ch-hub-actions">
              {c.can_log && <Link href={`/culture/challenges/${c.id}#log`} prefetch={false} className="btn btn-lime btn-sm wi"><IconCheck size={14} /> Log my stats</Link>}
              {c.can_mark && <Link href={`/culture/challenges/${c.id}#today`} prefetch={false} className="btn btn-lime btn-sm wi"><IconCheck size={14} /> Mark today’s square</Link>}
              <Link href={`/culture/challenges/${c.id}`} prefetch={false} className="btn btn-plain btn-sm">{c.kind === 'bingo' ? 'Bingo cards' : 'Leaderboards'}</Link>
            </span>
          </span>
        </section>
      ))}
      {cur && running.length === 0 && (
        <Link href={s.next ? `/culture/challenges/${s.next.id}` : s.can_manage ? '/culture/challenges/new' : '/culture/challenges'} prefetch={false} className="home-card ch-hub-card">
          <span className="home-card-icon ch-hub-icon"><IconMedal size={22} /></span>
          <span className="home-card-main">
            <span className="home-card-name">Monthly challenge</span>
            <span className="home-card-stats">
              {s.next ? `Next up: ${s.next.title}, starting ${fmtDay(s.next.starts_on, { weekday: true })}.`
                : s.can_manage ? 'Nothing is running this month. Set up the next challenge.' : 'No challenge is running right now.'}
            </span>
          </span>
          <IconChevronRight size={18} className="bw-go" />
        </Link>
      )}
      {past && s.recent.length > 0 && (
        <section className="home-card ch-hub-card ch-hub-past" aria-label="Past challenges">
          <span className="home-card-icon ch-hub-icon ch-hub-icon-past"><IconMedal size={22} /></span>
          <span className="home-card-main">
            <Link href="/culture/challenges" prefetch={false} className="home-card-name ch-hub-title">Past challenges</Link>
            <ul className="ch-past-list">
              {s.recent.map((c) => {
                const w = (c.top || []).filter((r) => r.rank === 1);
                return (
                  <li key={c.id}>
                    <Link href={`/culture/challenges/${c.id}`} prefetch={false} className="ch-past-row">
                      <span className="ch-past-name">{c.title}</span>
                      <span className="ch-past-meta">
                        {fmtRange(c.starts_on, c.ends_on)}
                        {c.kind === 'bingo' ? <> · <BingoWinners c={c} short /></>
                          : w.length ? <> · <Medal rank={1} size={15} /> {w.map((x) => x.name).join(', ')} ({fmtScore(c, w[0].score)})</> : ' · no entries'}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </span>
        </section>
      )}
    </>
  );
}
