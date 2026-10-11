import { useCallback, useEffect, useRef, useState } from 'react';

// Optimistic local copy of server-rendered props (design §7.4). Today's poll-guard model: after a local
// change, fresh props from router.refresh() wait until 2.5 s have passed since the last change, then the
// newest props are adopted (so a refresh that raced your edit never flashes the old value back).
//   const [data, setData, touch] = useServerState(props.data);
//   setData(...)  updates locally and starts the guard; touch() starts the guard without a change.
// Rows returned by a PATCH are merged at once with setData((d) => ({ ...d, tasks: mergeById(d.tasks, row) })).
const GUARD_MS = 2500;

export default function useServerState(initial) {
  const [data, setState] = useState(initial);
  const guard = useRef(0);
  const latest = useRef(initial);

  const touch = useCallback(() => { guard.current = Date.now() + GUARD_MS; }, []);
  const setData = useCallback((v) => { guard.current = Date.now() + GUARD_MS; setState(v); }, []);

  useEffect(() => {
    latest.current = initial;
    let t = null;
    const adopt = () => {
      const wait = guard.current - Date.now();
      if (wait > 0) { t = setTimeout(adopt, wait + 20); return; }   // a newer local change moved the guard
      setState(latest.current);
    };
    adopt();
    return () => { if (t) clearTimeout(t); };
  }, [initial]);

  return [data, setData, touch];
}

// Replace (or append) the row with the same id; ids compare as strings (BIGINT arrives as text).
export function mergeById(list, row) {
  if (!row) return list;
  const arr = list || [];
  const i = arr.findIndex((x) => String(x.id) === String(row.id));
  if (i < 0) return [...arr, row];
  const next = arr.slice();
  next[i] = { ...arr[i], ...row };
  return next;
}
