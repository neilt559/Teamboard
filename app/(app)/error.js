'use client';
import { startTransition, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { IconAlert } from '@/app/icons';

// Retry boundary for every page in the shell (design §2.1). In production the browser only sees the error's
// digest, so a data-layer 503 (lock or statement timeout while a deploy migrates) is recognized by the
// digest 'TB_UPDATING' that tagUpdating() in lib/viewer.js sets (requirePageViewer, page loaders), or by
// its message in development.
const UPDATING = 'TeamBoard is updating — try again in a moment.';
const isUpdating = (e) => e?.digest === 'TB_UPDATING'
  || /TeamBoard is updating|55P03|40P01|40001|57014|lock timeout|deadlock detected|could not serialize|statement timeout/i
    .test(String(e?.message || ''));

export default function AppError({ error, reset }) {
  const router = useRouter();
  const updating = isUpdating(error);
  const retried = useRef(false);

  const retry = () => startTransition(() => { router.refresh(); reset(); });

  useEffect(() => {
    if (!updating) { console.error(error); return undefined; }
    // One automatic retry: a migration holds its locks for a few seconds at most.
    if (retried.current) return undefined;
    retried.current = true;
    const t = setTimeout(retry, 3000);
    return () => clearTimeout(t);
  }, [error, updating]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="empty shell-error" role="alert">
      <h3 className="wi" style={{ justifyContent: 'center' }}>
        <IconAlert size={18} /> {updating ? UPDATING : 'Something went wrong — please try again.'}
      </h3>
      {!updating && error?.digest && <p>Reference: {error.digest}</p>}
      <button type="button" className="btn btn-lime" onClick={retry}>Try again</button>
    </div>
  );
}
