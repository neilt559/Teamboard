'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { markRead } from './space-api';

// Opening a section marks it read (design-amendments A5.6). From an effect, so link prefetches never mark
// anything read. When something was unread, the page refreshes once so the header badge and the space list
// catch up (the open section already shows 0).
export default function MarkRead({ space, section, unread = 0 }) {
  const router = useRouter();
  useEffect(() => {
    let alive = true;
    markRead(space, section)
      .then(() => { if (alive && unread > 0) router.refresh(); })
      .catch(() => {});
    return () => { alive = false; };
  }, [space, section]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
