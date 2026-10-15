// Leaderboard rank marks (design §10(a)): gold, silver and bronze medals drawn as inline SVG in the gold family
// (#e0a800, #9aa4ad, #cd7f32), never emoji; ranks 4 and up are a plain number. A plain module (no hooks, no
// 'use client'), so server components (cards, the Home widget) and client components (the boards) share it.

export const MEDAL_COLORS = { 1: '#e0a800', 2: '#9aa4ad', 3: '#cd7f32' };
const NAMES = { 1: 'Gold', 2: 'Silver', 3: 'Bronze' };
const RIBBON = { 1: '#b88400', 2: '#6f7a83', 3: '#9a5a1f' };

export function Medal({ rank, size = 24 }) {
  const n = Number(rank);
  const c = MEDAL_COLORS[n];
  if (!c) return <span className="ch-rank-num" aria-label={`Rank ${n}`}>{n}</span>;
  return (
    <span className={`ch-medal ch-medal-${n}`} title={`${NAMES[n]}: rank ${n}`} aria-label={`Rank ${n} (${NAMES[n].toLowerCase()})`} role="img">
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
        <path d="M7.2 1.8l4 7.4M16.8 1.8l-4 7.4" stroke={RIBBON[n]} strokeWidth="2.6" strokeLinecap="round" fill="none" />
        <circle cx="12" cy="15" r="7.2" fill={c} />
        <circle cx="12" cy="15" r="5.4" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="1" />
        <text x="12" y="18.1" textAnchor="middle" fontSize="8.6" fontWeight="800" fill="#fff" fontFamily="system-ui, sans-serif">{n}</text>
      </svg>
    </span>
  );
}

export default Medal;
