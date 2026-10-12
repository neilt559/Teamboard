import Link from 'next/link';
import { requirePageViewer } from '@/lib/viewer';
import { nowFromRequestContext } from '@/lib/clock';
import { loadBracketSummary } from '@/lib/queries/brackets';
import { ROUNDS } from '@/lib/bracket';
import { IconTrophy, IconChevronRight } from '@/app/icons';

// Home dashboard widget 'bracket' (design §2.1, §11) and the bracket card on /culture. An async Server
// Component with no required props:
//   <BracketWidget />                            loads its own data (viewer from requirePageViewer, cached)
//   <BracketWidget viewer={viewer} now={now} />  same, with the page's viewer and clock
//   <BracketWidget summary={...} />              a dashboard batch already ran loadBracketSummary(viewer, now)
// The whole card is one link to /culture/brackets (same .home-card look as the GeoGuessr card).

function lines(s) {
  const cur = s?.current || null;
  if (!s) return { title: 'Brackets', stat: 'No brackets yet. A culture organizer starts each one.' };
  if (!cur) {
    return {
      title: 'Brackets',
      stat: 'No bracket is running right now.',
      extra: s.last_champion ? <>Last champion: <b>{s.last_champion.champion_name}</b> ({s.last_champion.name})</> : null,
    };
  }
  if (cur.champion_id) {
    return { title: cur.name, champ: cur.champion_name || 'Champion', stat: 'Every matchup is decided.' };
  }
  if (s.open_round == null) return { title: cur.name, stat: 'Every matchup is decided.' };
  const left = s.open_votable - s.my_open_votes;
  return {
    title: cur.name,
    live: <>Voting open: <b>{ROUNDS[s.open_round]}</b> · {s.open_done} of {s.open_total} decided</>,
    mine: s.open_votable > 0
      ? (left > 0 ? `${left} matchup${left === 1 ? '' : 's'} waiting for your vote` : 'You’ve voted in every open matchup')
      : `Waiting on the last ${ROUNDS[s.open_round]} results`,
    todo: left > 0,
  };
}

export function BracketCard({ summary }) {
  const l = lines(summary);
  return (
    <Link href="/culture/brackets" prefetch={false} className="home-card bracket-widget">
      <span className="home-card-icon"><IconTrophy size={22} /></span>
      <span className="home-card-main">
        <span className="home-card-name">{l.title}</span>
        {l.champ && <span className="bw-champ"><IconTrophy size={13} /> Champion: <b>{l.champ}</b></span>}
        {l.live && <span className="bw-live"><span className="bk-rs-dot" aria-hidden="true" /> <span>{l.live}</span></span>}
        {l.mine && <span className={`bw-mine${l.todo ? ' todo' : ''}`}>{l.mine}</span>}
        {l.stat && !l.champ && <span className="home-card-stats">{l.stat}</span>}
        {l.extra && <span className="home-card-stats">{l.extra}</span>}
      </span>
      <IconChevronRight size={18} className="bw-go" />
    </Link>
  );
}

export default async function BracketWidget({ viewer, now, summary } = {}) {
  let s = summary;
  if (s === undefined) {
    const v = viewer || await requirePageViewer();
    s = await loadBracketSummary(v, now ?? nowFromRequestContext());
  }
  return <BracketCard summary={s} />;
}
