'use client';
import { Component, startTransition, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IconAlert, IconCheck, IconShield } from '@/app/icons';
import { api } from '@/app/_ui/api';
import { useRefreshOnFocus } from '@/app/_ui/useRefresh';
import { landingPath } from '@/lib/prefs';

const LANDED = 'tb_landed';

// The "landing page" preference (design §11): the FIRST page of a tab session goes to prefs.landing. Only
// when this tab's document was loaded at Home (opening the app, signing in): a Home you reach by clicking
// around never redirects. sessionStorage.tb_landed marks the session (cleared on sign-out); every read and
// write sits in try/catch (private windows). Default 'home' keeps "open the app -> Home" (rule 44).
// Also refreshes Home when the tab regains focus (§7.5).
export default function HomeLanding({ landing = 'home', hasNotice = false }) {
  const router = useRouter();
  useRefreshOnFocus(30_000);
  useEffect(() => {
    let landed = true;
    try {
      landed = sessionStorage.getItem(LANDED) === '1';
      sessionStorage.setItem(LANDED, '1');
    } catch { /* storage blocked: never redirect */ }
    if (landed || hasNotice) return;
    let entry = '/';
    try {
      const nav = performance.getEntriesByType('navigation')[0];
      if (nav?.name) entry = new URL(nav.name).pathname;
    } catch { /* older browsers: assume this load was Home */ }
    if (entry !== '/') return;
    const to = landingPath({ landing });
    if (to && to !== '/') router.replace(to);
  }, [landing, hasNotice, router]);
  return null;
}

// Fresh server data first, then render the card again (a plain re-render would just repeat the error).
function RetryButton({ onRetry }) {
  const router = useRouter();
  return (
    <button type="button" className="dash-link-btn" onClick={() => startTransition(() => { router.refresh(); onRetry(); })}>
      Try again
    </button>
  );
}

// One dashboard card failing (another area's widget, a slow query) must not take Home down: show a small
// placeholder instead. Next's own redirect / not-found signals pass through.
export class WidgetBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error(`[home widget ${this.props.name}]`, error);
  }

  render() {
    const { error } = this.state;
    if (error) {
      if (typeof error?.digest === 'string' && /^NEXT_/.test(error.digest)) throw error;
      return (
        <section className="widget widget-failed" role="status">
          <IconAlert size={15} /> This card couldn’t load. <RetryButton onRetry={() => this.setState({ error: null })} />
        </section>
      );
    }
    return this.props.children;
  }
}

// Banners at the top of Home:
//   ?notice=project_gone (the open project was deleted or became invisible, design §7.5);
//   the latest position decision until dismissed (§4.2a: prefs.position_notice_seen_at);
//   what is still waiting for an admin (position, office change, "that's me" name link).
export function HomeNotices({ notice, notices, seenAt }) {
  const router = useRouter();
  const [hidden, setHidden] = useState({});
  const [err, setErr] = useState(null);
  const n = notices || {};
  const decidedAt = n.position_decided_at ? Date.parse(n.position_decided_at) : null;
  const seen = seenAt ? Date.parse(seenAt) : null;
  const showDecision = decidedAt != null && !n.position_pending && n.position_name && (seen == null || decidedAt > seen) && !hidden.decision;

  async function dismissDecision() {
    setHidden((h) => ({ ...h, decision: true }));
    try {
      // The decision time itself, so a later decision shows again.
      await api('/api/prefs', { method: 'PATCH', body: { position_notice_seen_at: n.position_decided_at } });
      router.refresh();
    } catch (e) {
      setErr(e.message);
    }
  }

  const waiting = [
    n.position_pending && n.requested_name && `Position: ${n.requested_name}. Until it is approved you see the projects you’re assigned to.`,
    n.pending_office && `Move to the ${n.pending_office} office.`,
    n.pending_person && `Your name on tasks: “${n.pending_person}”.`,
  ].filter(Boolean);

  return (
    <>
      {notice === 'project_gone' && !hidden.gone && (
        <div className="banner setup dash-notice" role="status">
          <IconAlert size={16} />
          <span>This project was deleted, or you no longer have access.</span>
          <span className="spacer" />
          <button type="button" className="btn btn-plain btn-sm" onClick={() => { setHidden((h) => ({ ...h, gone: true })); router.replace('/'); }}>Dismiss</button>
        </div>
      )}
      {showDecision && (
        <div className="banner dash-notice dash-notice-ok" role="status">
          <IconCheck size={16} />
          <span>
            {n.decision === 'position.set' ? 'Your position was set to ' : 'Your position was approved: '}
            <b>{n.position_name}</b>{n.decided_by ? ` (by ${n.decided_by})` : ''}.
          </span>
          <span className="spacer" />
          <button type="button" className="btn btn-plain btn-sm" onClick={dismissDecision}>Dismiss</button>
        </div>
      )}
      {waiting.length > 0 && (
        <div className="dash-waiting" role="status">
          <span className="ofc-badge ofc-badge-pending wi"><IconShield size={12} /> Waiting for approval</span>
          <ul>{waiting.map((w) => <li key={w}>{w}</li>)}</ul>
          <Link href="/settings" prefetch={false} className="dash-waiting-link">Settings</Link>
        </div>
      )}
      {err && (
        <div className="banner" role="alert">
          <IconAlert size={16} /><span>{err}</span><span className="spacer" />
          <button type="button" className="btn btn-plain btn-sm" onClick={() => setErr(null)}>Dismiss</button>
        </div>
      )}
    </>
  );
}
