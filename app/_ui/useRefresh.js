import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from './api';

// Refresh strategy per page (design §7.5). No whole-database polling: pages load on navigation, refresh on
// focus, and only a few poll a small endpoint while the tab is visible.

const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';
// Someone typing in a field or picking from a menu: don't swap the page under them.
const editingNow = () => {
  const el = typeof document === 'undefined' ? null : document.activeElement;
  return !!el && typeof el.matches === 'function'
    && el.matches('input:not([type=checkbox]):not([type=radio]):not([type=button]), textarea, select, [contenteditable=""], [contenteditable="true"]');
};

// Home, My work, Offices, Projects, All Tasks, People, Settings...: router.refresh() when the tab regains
// focus or becomes visible, at most once per minMs.
export function useRefreshOnFocus(minMs = 30_000) {
  const router = useRouter();
  const last = useRef(Date.now());
  useEffect(() => {
    const go = () => {
      if (!visible() || Date.now() - last.current < minMs) return;
      last.current = Date.now();
      router.refresh();
    };
    window.addEventListener('focus', go);
    document.addEventListener('visibilitychange', go);
    return () => {
      window.removeEventListener('focus', go);
      document.removeEventListener('visibilitychange', go);
    };
  }, [router, minMs]);
}

// Run fn every ms while the tab is visible (never two at once), and right away when it becomes visible
// again. GeoGuessr (4 s), the live bracket and an open thread (15 s) use this.
//   usePoll(async () => { ... }, 15_000, { enabled: roundOpen })
export function usePoll(fn, ms, { enabled = true } = {}) {
  const ref = useRef(fn);
  useEffect(() => { ref.current = fn; });
  useEffect(() => {
    if (!enabled || !(ms > 0)) return undefined;
    let timer = null;
    let stopped = false;
    let running = false;
    const tick = async () => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (stopped) return;
      if (visible() && !running) {
        running = true;
        try { await ref.current(); } catch {} finally { running = false; }
      }
      if (!stopped && !timer) timer = setTimeout(tick, ms);
    };
    const onVis = () => { if (visible()) tick(); };
    timer = setTimeout(tick, ms);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [ms, enabled]);
}

// Project board and task detail: poll GET /api/projects/:id/rev ({ rev, archived }) every 20 s.
//   rev changed       -> router.refresh(), unless a field is focused or `dirty` (a draft is open): then
//                        `stale` turns true and the page shows <RefreshPill onClick={refresh} />.
//   archived became true -> router.refresh() (the page re-renders read-only with "This project was archived.").
//   404 (deleted, or access lost) -> router.replace('/?notice=project_gone').
//   const { stale, refresh } = useRevPoll(`/api/projects/${id}/rev`, 20_000, { initialRev: project.rev, initialArchived: project.archived, dirty });
export function useRevPoll(url, ms = 20_000, { initialRev = null, initialArchived = null, dirty = false } = {}) {
  const router = useRouter();
  const rev = useRef(initialRev == null ? null : String(initialRev));
  const archived = useRef(initialArchived == null ? null : !!initialArchived);
  const dirtyRef = useRef(dirty);
  const [stale, setStale] = useState(false);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  // A refresh brings new server props: they are the new baseline.
  useEffect(() => { if (initialRev != null) rev.current = String(initialRev); setStale(false); }, [initialRev]);
  useEffect(() => { if (initialArchived != null) archived.current = !!initialArchived; }, [initialArchived]);

  const refresh = useCallback(() => { setStale(false); router.refresh(); }, [router]);

  usePoll(async () => {
    let r;
    try {
      r = await api(url, { quiet: true });
    } catch (e) {
      if (e?.status === 404) router.replace('/?notice=project_gone');
      return;
    }
    const nextRev = r?.rev == null ? null : String(r.rev);
    const changed = rev.current != null && nextRev != null && nextRev !== rev.current;
    const nowArchived = !!r?.archived;
    const becameArchived = nowArchived && archived.current === false;
    if (nextRev != null) rev.current = nextRev;
    archived.current = nowArchived;
    if (becameArchived) { refresh(); return; }
    if (!changed) return;
    if (dirtyRef.current || editingNow()) setStale(true);
    else refresh();
  }, ms, { enabled: !!url });

  return { stale, refresh };
}

// "New changes · Refresh" pill for pages paused by useRevPoll.
export function RefreshPill({ onClick }) {
  return (
    <button type="button" className="refresh-pill" onClick={onClick}>
      New changes <span aria-hidden="true">·</span> Refresh
    </button>
  );
}
