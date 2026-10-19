import { IconTrophy } from '@/app/icons';
import { fmtDay } from '@/lib/challenges';
import { CELLS } from '@/lib/bingo';

// An office bingo challenge on the cards (the challenge list, Home's challenge widget, the /culture cards): each
// playing office's marked squares as a bar, then the two prizes. A plain module (no hooks), so server pages render
// it. c = a challenge from lib/queries/challenges.js with c.bingo = { offices, winners } (lib/queries/bingo.js).

export function BingoOffices({ c, max = 4 }) {
  const offices = c.bingo?.offices || [];
  if (!offices.length) return null;
  return (
    <ul className="bg-sum" aria-label="Offices">
      {offices.slice(0, max).map((o) => (
        <li key={o.id} className="bg-sum-row">
          <span className="bg-sum-name">{o.name}</span>
          {o.mine && <span className="bg-sum-you">you</span>}
          <span className="bg-sum-bar" aria-hidden="true"><i style={{ width: `${Math.round((o.marks / CELLS) * 100)}%` }} /></span>
          <span className="bg-sum-n">{o.marks} of {CELLS}</span>
          {o.bingo && <span className="bg-badge">Bingo</span>}
        </li>
      ))}
    </ul>
  );
}

export function BingoWinners({ c, short = false }) {
  const w = c.bingo?.winners || {};
  const one = (label, win) => (
    <span className={`bg-sum-win${win ? '' : ' is-open'}`}>
      <IconTrophy size={13} /> {label}: {win ? <b>{win.office_name}</b> : 'up for grabs'}
      {win && !short ? ` (${fmtDay(win.play_date)})` : ''}
    </span>
  );
  return <span className="bg-sum-wins">{one('First bingo', w.bingo)}{one('Four corners', w.corners)}</span>;
}

// One line for the viewer: today's square for their office(s), or nothing when they aren't playing.
export function BingoMyLine({ c }) {
  const mine = (c.bingo?.offices || []).filter((o) => o.mine);
  if (!mine.length) return null;
  if (c.status !== 'running') return null;
  return (
    <span className="ch-w-me">
      {mine.map((o) => `${o.name}: ${o.picked_today ? 'today’s square is marked' : 'today’s square is open'}`).join(' · ')}
    </span>
  );
}
