import { displayName } from '@/lib/policy';

// A person's photo, or a colored initial when they have none (moved from bracket-ui.js). Used by the header,
// brackets, suggestions, threads and the directory. No hooks, so server components can render it too.
// user: { id, username, display_name?, name?, avatar_v? }. The color follows the username, so it stays
// the same when someone changes their display name.

const HS_COLORS = ['#5B5859', '#0086c0', '#e2445c', '#fdab3d', '#00c875', '#a25ddc', '#ff158a', '#037f4c', '#7f5347', '#9aa000'];

export function colorFor(name) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return HS_COLORS[h % HS_COLORS.length];
}

export function Headshot({ user, size = 22, className = '' }) {
  const name = user ? (user.name || displayName(user) || 'unknown') : 'unknown';
  const cls = `hs${className ? ` ${className}` : ''}`;
  if (user && user.avatar_v && user.id != null) {
    return <img className={cls} src={`/api/avatar/${user.id}?v=${user.avatar_v}`} alt={name} title={name} width={size} height={size} style={{ width: size, height: size }} />;
  }
  return (
    <span className={`${cls} hs-init`} title={name} aria-label={name} role="img" style={{ width: size, height: size, fontSize: Math.round(size * 0.46), background: colorFor(user ? user.username : name) }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export default Headshot;
