import Link from 'next/link';
import { displayName } from '@/lib/policy';

// A signed-up person's name: display_name || username, plus a muted "@username · unverified" chip until an
// admin verifies the account (design §5.1). Directory, profiles, thread authors, member lists, pickers.
// user: { id, username, display_name?, name?, identity_verified? } (identity_verified_at also accepted).
// The chip shows only when the loader says the account is unverified; an object without either field
// shows the plain name.
export function isUnverified(user) {
  if (!user) return false;
  if (typeof user.identity_verified === 'boolean') return !user.identity_verified;
  if ('identity_verified_at' in user) return user.identity_verified_at == null;
  return false;
}

export default function NameLabel({ user, link = false, className = '' }) {
  if (!user) return <span className={`name-label muted ${className}`.trim()}>Unknown</span>;
  const name = user.name || displayName(user);
  const chip = isUnverified(user) && user.username
    ? <span className="unverified-chip" title="An admin hasn’t verified this account’s name and email yet">@{user.username} · unverified</span>
    : null;
  return (
    <span className={`name-label ${className}`.trim()}>
      {link && user.id != null ? <Link href={`/people/${user.id}`} prefetch={false}>{name}</Link> : name}
      {chip}
    </span>
  );
}
