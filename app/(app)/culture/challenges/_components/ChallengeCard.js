import Link from 'next/link';
import { Headshot } from '@/app/_ui/Headshot';
import { fmtRange, fmtScore, metricLine, timeLabel } from '@/lib/challenges';
import { IconBuilding, IconUsers, IconChevronRight, IconMedal } from '@/app/icons';
import { Medal } from './Medal';
import { BingoOffices, BingoWinners } from './BingoSummary';

// One challenge as a card (the /culture/challenges list). A plain module (no hooks), so server pages render it.
// c = a challenge from lib/queries/challenges.js listChallenges / loadChallengeSummary: the row plus status,
// participants, top (dense ranks) and me { score, rank, entries }.

const STATUS = { running: 'Running', upcoming: 'Coming up', ended: 'Finished', archived: 'Archived' };

export function StatusChip({ c, today }) {
  const label = c.status === 'running' ? timeLabel(c, today) : c.status === 'upcoming' ? timeLabel(c, today) : STATUS[c.status];
  return <span className={`ch-chip ch-chip-${c.status}`}>{c.status === 'running' && <span className="ch-live-dot" aria-hidden="true" />}{label}</span>;
}

export function ScopeChip({ c }) {
  return c.office_id
    ? <span className="ch-chip ch-chip-scope"><IconBuilding size={12} /> {c.office_name || 'Office'}</span>
    : <span className="ch-chip ch-chip-company">Company-wide</span>;
}

export function ChallengeCard({ c, today }) {
  const leaders = (c.top || []).filter((r) => r.rank === 1);
  const done = c.status === 'ended';
  return (
    <article className={`ch-card ch-card-${c.status}`}>
      <div className="ch-card-top">
        <span className="ch-card-icon"><IconMedal size={20} /></span>
        <div className="ch-card-main">
          <Link href={`/culture/challenges/${c.id}`} prefetch={false} className="ch-card-title">{c.title || 'Untitled challenge'}</Link>
          <div className="ch-card-chips">
            <StatusChip c={c} today={today} />
            <ScopeChip c={c} />
          </div>
          <div className="ch-card-meta">{metricLine(c)} · {fmtRange(c.starts_on, c.ends_on)}</div>
        </div>
        <IconChevronRight size={18} className="ch-card-go" />
      </div>
      {c.kind === 'bingo' ? (
        <div className="ch-card-stats">
          <BingoOffices c={c} />
          <BingoWinners c={c} />
        </div>
      ) : (
      <div className="ch-card-stats">
        <span className="ch-card-stat"><IconUsers size={13} /> {c.participants} {c.participants === 1 ? 'person' : 'people'}</span>
        {leaders.length > 0 && (
          <span className="ch-card-stat ch-card-leader">
            <Medal rank={1} size={18} />
            <span className="ch-card-leader-name">
              {done ? 'Winner' : 'Leading'}: {leaders.slice(0, 2).map((l) => l.name).join(', ')}{leaders.length > 2 ? ` +${leaders.length - 2}` : ''}
            </span>
            <b>{fmtScore(c, leaders[0].score)}</b>
          </span>
        )}
        {c.me?.score != null && (
          <span className="ch-card-stat ch-card-me">
            You: <b>{fmtScore(c, c.me.score)}</b>{c.me.rank ? ` · #${c.me.rank}` : ''}
          </span>
        )}
      </div>
      )}
    </article>
  );
}

// A leaderboard row for the cards and the Home widget: medal or number, photo, name, score.
export function TopRow({ c, r, you }) {
  return (
    <li className={`ch-toprow${you ? ' is-you' : ''}`}>
      <Medal rank={r.rank} size={20} />
      <Headshot user={{ id: r.user_id, username: r.username, name: r.name, avatar_v: r.avatar_v }} size={22} />
      <span className="ch-toprow-name">{r.name}{you ? <span className="ch-you-tag">You</span> : null}</span>
      <span className="ch-toprow-score">{fmtScore(c, r.score)}</span>
    </li>
  );
}

export default ChallengeCard;
