'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRevPoll } from '@/app/_ui/useRefresh';

// Keeps the project board and the task page in step with the server (design §7.5) without fighting the
// user's own edits:
//   * wrote(): call after every successful write. Each one bumps projects.rev by one, so the 20 s rev poll is
//     told the rev to expect and only refreshes when someone ELSE wrote too.
//   * refreshNow(): router.refresh() after creates, deletes and cascades.
//   * A refresh can read the database before one of our own writes commits (e.g. "+ Add task", then typing the
//     title before the refresh lands). useServerState would adopt those props once its 2.5 s guard ends and
//     flash the old value back. So when a write finishes close to a refresh (requested or arrived in the last
//     5 s), or props arrive after a write we didn't refresh for, we ask for one more refresh; the guard then
//     adopts props that include the write.
// Returns { stale, refresh } from useRevPoll (the "New changes · Refresh" pill) plus wrote and refreshNow.
const NEAR_MS = 5000;

export default function useBoardSync({ projectId, initialRev, initialArchived, dirty = false, props }) {
  const router = useRouter();
  const serverRev = String(initialRev ?? '0');
  const [own, setOwn] = useState({ base: serverRev, n: 0 });
  const baseRef = useRef(serverRev);
  baseRef.current = serverRev;
  const writes = useRef(0);
  const askedAt = useRef(0);          // writes.current when we last asked for a refresh
  const lastAsk = useRef(0);          // Date.now() of that request
  const lastProps = useRef(0);        // Date.now() when server props last arrived
  const timer = useRef(null);

  const refreshNow = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    askedAt.current = writes.current;
    lastAsk.current = Date.now();
    router.refresh();
  }, [router]);
  const soon = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(refreshNow, 250);
  }, [refreshNow]);

  const wrote = useCallback(() => {
    writes.current += 1;
    setOwn((o) => (o.base === baseRef.current ? { base: o.base, n: o.n + 1 } : { base: baseRef.current, n: 1 }));
    const now = Date.now();
    if (now - lastAsk.current < NEAR_MS || now - lastProps.current < NEAR_MS) soon();
  }, [soon]);

  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    lastProps.current = Date.now();
    if (writes.current > askedAt.current) soon();
  }, [props, soon]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const expectedRev = own.base === serverRev ? String(BigInt(serverRev) + BigInt(own.n)) : serverRev;
  const { stale, refresh } = useRevPoll(`/api/projects/${projectId}/rev`, 20_000, {
    initialRev: expectedRev, initialArchived, dirty,
  });
  return { stale, refresh, wrote, refreshNow };
}
