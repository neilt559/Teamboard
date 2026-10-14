'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/app/_ui/api';

// Opening a board marks it read (design-amendments A10.4). From an effect, so a link prefetch never marks anything
// read. When something was unread, the page refreshes once so the header badge and the switcher catch up (the
// cards keep their "Unread" chips: the client froze the previous visit when it mounted).
export default function MarkBoardRead({ board, unread = 0 }) {
  const router = useRouter();
  useEffect(() => {
    let alive = true;
    api('/api/suggestions/read', { method: 'POST', body: { space: board }, quiet: true })
      .then(() => { if (alive && unread > 0) router.refresh(); })
      .catch(() => {});
    return () => { alive = false; };
  }, [board]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
