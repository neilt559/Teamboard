'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IconPin } from '@/app/icons';
import { api } from '@/app/_ui/api';
import { withDefaults } from '@/lib/prefs';

// Home dashboard widget 'pinned_projects' (design §2.1, §11): prefs.pinned_project_ids, re-filtered through
// tb_visible_project_ids on read (loadDashboard), so a project you lost access to just drops out. Unpin
// saves the remaining pins (PATCH /api/prefs) and refreshes, so the sidebar's Pinned section follows.
// PATCH replaces the whole pin list, so quick unpins must build on each other, not on the props of the last
// render: pinsRef holds the list as this widget has left it, and the saves run one after another (the same
// pattern as the Projects page), so a second click never re-sends the first project.
export default function PinnedWidget({ viewer, data }) {
  const router = useRouter();
  const [gone, setGone] = useState([]);
  const [err, setErr] = useState(null);
  const pinsRef = useRef(null);
  const seenRef = useRef(null);                        // the server list pinsRef was last taken from
  const chain = useRef(Promise.resolve());
  const inFlight = useRef(0);
  const rows = (data?.pinned || []).filter((p) => !gone.includes(p.id));

  function unpin(p) {
    // Take the server's list again only when a newer render brought a different one and nothing of ours is still
    // being saved; until the refresh lands, the props still hold the pins this widget already removed.
    const server = withDefaults(viewer?.prefs, { isAdmin: !!viewer?.is_admin }).pinned_project_ids.map(String);
    const key = server.join(',');
    if (pinsRef.current === null || (inFlight.current === 0 && seenRef.current !== key)) {
      pinsRef.current = server;
      seenRef.current = key;
    }
    const pid = String(p.id);
    const order = pinsRef.current.slice();             // to put it back in its place if the save fails
    pinsRef.current = pinsRef.current.filter((id) => id !== pid);
    setGone((g) => [...g, p.id]);
    setErr(null);
    inFlight.current += 1;
    chain.current = chain.current.then(async () => {
      try {
        // The list as it stands when this save goes out, so every save carries all earlier unpins.
        await api('/api/prefs', { method: 'PATCH', body: { pinned_project_ids: pinsRef.current } });
      } catch (e) {
        const keep = new Set([...pinsRef.current, pid]);
        pinsRef.current = order.filter((id) => keep.has(id));
        setGone((g) => g.filter((x) => x !== p.id));
        setErr(e.message);
      } finally {
        inFlight.current -= 1;
        if (inFlight.current === 0) router.refresh();
      }
    });
  }

  return (
    <section className="widget" aria-labelledby="w-pinned">
      <div className="widget-head">
        <h2 id="w-pinned" className="widget-title wi-h"><IconPin size={18} /> Pinned projects</h2>
        <Link href="/projects" prefetch={false} className="widget-more">All projects →</Link>
      </div>
      {err && <p className="widget-err" role="alert">{err}</p>}
      {rows.length === 0 ? (
        <p className="widget-empty">Pin projects on the <Link href="/projects" prefetch={false}>Projects</Link> page to keep them here and at the top of your sidebar.</p>
      ) : (
        <ul className="widget-list">
          {rows.map((p) => (
            <li key={p.id} className="wl-item">
              <Link href={`/projects/${p.id}`} prefetch={false} className="wl-row">
                <span className="wl-main">
                  <span className="wl-name">{p.name}</span>
                  <span className="wl-meta">{p.office_name} › {p.team_name}{p.archived ? ' · archived' : ''}</span>
                </span>
                <span className="wl-count" title="Open tasks">{p.open_count}</span>
              </Link>
              <button type="button" className="wl-action" aria-label={`Unpin ${p.name}`} title="Unpin" onClick={() => unpin(p)}>
                <IconPin size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
