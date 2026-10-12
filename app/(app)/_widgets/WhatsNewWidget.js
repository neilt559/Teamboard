'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IconBell } from '@/app/icons';
import { api } from '@/app/_ui/api';
import { withDefaults } from '@/lib/prefs';

// The Home "What's new" card (design §2.1, §11, §16 "what existing users see on first visit"). Hidden once
// dismissed: prefs.dismissed gets WHATS_NEW_KEY (PATCH /api/prefs), so it stays hidden on every device.
// Not exported: a 'use client' module hands server code a client reference, not the string.
const WHATS_NEW_KEY = 'whats_new_v2';

export default function WhatsNewWidget({ viewer }) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const [err, setErr] = useState(null);
  const dismissed = withDefaults(viewer?.prefs, { isAdmin: !!viewer?.is_admin }).dismissed;
  if (hidden || dismissed.includes(WHATS_NEW_KEY)) return null;

  async function dismiss() {
    setHidden(true);
    try {
      await api('/api/prefs', { method: 'PATCH', body: { dismissed: [...dismissed.filter((k) => k !== WHATS_NEW_KEY), WHATS_NEW_KEY] } });
      router.refresh();
    } catch (e) {
      setHidden(false);
      setErr(e.message);
    }
  }

  return (
    <section className="widget whats-new" aria-labelledby="w-whats-new">
      <div className="widget-head">
        <h2 id="w-whats-new" className="widget-title wi-h"><IconBell size={18} /> What’s new in TeamBoard</h2>
      </div>
      <ul className="whats-new-list">
        <li><b>Every page has its own link.</b> Back and Forward work, and you can share a link to any project, office or task.</li>
        <li><b>All seven CAGE offices.</b> Browse them on <Link href="/offices" prefetch={false}>Offices</Link> and follow the ones you work with.</li>
        <li><b>Projects follow your role.</b> You see the projects you’re on (plus your office’s, or everything, depending on your position). Anyone on a project can add people to it.</li>
        <li><b>Safer editing.</b> If someone changes the same text while you’re editing, TeamBoard tells you instead of overwriting it.</li>
        <li><b>Make Home yours.</b> Pin projects, then reorder or hide these cards in <Link href="/settings?tab=customize" prefetch={false}>Settings</Link>.</li>
        <li><b>Culture</b> now holds the bracket and GeoGuessr, and <Link href="/people" prefetch={false}>People</Link> is the company directory.</li>
      </ul>
      {err && <p className="widget-err" role="alert">{err}</p>}
      <div className="whats-new-actions">
        <button type="button" className="btn btn-ink btn-sm" onClick={dismiss}>Got it</button>
      </div>
    </section>
  );
}
