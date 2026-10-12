'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IconBuilding, IconChevronRight, IconStar } from '@/app/icons';
import { api } from '@/app/_ui/api';
import { useRefreshOnFocus } from '@/app/_ui/useRefresh';
import useServerState from '@/app/_ui/useServerState';
import { MAX_FOLLOWED } from '@/lib/prefs';
import LocalTime from './LocalTime';
import ErrorBanner from './_ui/ErrorBanner';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// /offices (design §2.1): every active office. The card opens the office page; Follow only changes what the
// sidebar tree and this list show (prefs.followed_office_ids, §11), never what you may see.
export default function OfficesIndex({ viewer, data, now }) {
  const router = useRouter();
  useRefreshOnFocus(30_000);
  const [state, setState] = useServerState(data);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const offices = state.offices;

  async function toggleFollow(office) {
    const cur = state.followed_office_ids || [];
    const on = !cur.includes(office.id);
    if (on && cur.length >= MAX_FOLLOWED) { setError(`You can follow up to ${MAX_FOLLOWED} offices. Unfollow one first.`); return; }
    const next = on ? [...cur, office.id] : cur.filter((x) => x !== office.id);
    setError(null);
    setBusy(office.id);
    setState((s) => ({
      ...s,
      followed_office_ids: next,
      offices: s.offices.map((o) => (o.id === office.id ? { ...o, followed: on } : o)),
    }));
    try {
      await api('/api/prefs', { method: 'PATCH', body: { followed_office_ids: next } });
      router.refresh();                       // the sidebar's "My offices" tree follows the change
    } catch (e) {
      setError(e.message);
      setState((s) => ({
        ...s,
        followed_office_ids: cur,
        offices: s.offices.map((o) => (o.id === office.id ? { ...o, followed: !on } : o)),
      }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="proj-head">
        <h1 className="wi-h"><IconBuilding size={24} /> Offices</h1>
        <div className="spacer" />
        {viewer.is_admin && <Link href="/admin/org" prefetch={false} className="btn btn-plain btn-sm">Manage offices</Link>}
      </div>
      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      {offices.length === 0 ? (
        <div className="empty">
          <h3>No offices yet</h3>
          <p>Offices hold teams, and teams hold projects.{viewer.is_admin ? ' Start by adding an office.' : ' An admin adds them.'}</p>
          {viewer.is_admin && <Link href="/admin/org" prefetch={false} className="btn btn-lime">+ Add office</Link>}
        </div>
      ) : (
        <>
          <p className="home-sub">Pick an office to see its teams, people and projects. Following an office adds it to your sidebar.</p>
          <div className="home-grid ofc-office-grid">
            {offices.map((o) => (
              <div key={o.id} className={`home-card ofc-office-card${o.mine ? ' is-mine' : ''}`}>
                <span className="home-card-icon"><IconBuilding size={22} /></span>
                <span className="home-card-main">
                  <span className="ofc-office-top">
                    <Link href={`/offices/${o.id}`} prefetch={false} className="home-card-name ofc-office-link">{o.name}</Link>
                    {o.mine && <span className="ofc-badge ofc-badge-mine">Your office</span>}
                    {!o.mine && o.followed && <span className="ofc-badge ofc-badge-follow">Following</span>}
                  </span>
                  <LocalTime tz={o.tz} now={now} className="home-card-stats local-time" />
                  <span className="home-card-stats">{plural(o.teams.length, 'team')} · {o.people === 1 ? '1 person' : `${o.people} people`}</span>
                  <span className="home-card-stats ofc-yours">
                    Your projects here: <b>{o.projects}</b>{o.projects > 0 ? ` · ${plural(o.open, 'open task')}` : ''}
                  </span>
                  {o.teams.length > 0 && <span className="home-card-list">{o.teams.map((t) => t.name).join(' · ')}</span>}
                </span>
                <span className="ofc-office-side">
                  {!o.mine && (
                    <button
                      type="button"
                      className={`ofc-follow${o.followed ? ' on' : ''}`}
                      aria-pressed={o.followed}
                      disabled={busy === o.id}
                      onClick={() => toggleFollow(o)}
                      title={o.followed ? `Stop following ${o.name}` : `Follow ${o.name} (adds it to your sidebar)`}
                    >
                      <IconStar size={13} /> {o.followed ? 'Following' : 'Follow'}
                    </button>
                  )}
                  <IconChevronRight size={18} />
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
