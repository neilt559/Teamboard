'use client';
import { useRefreshOnFocus } from '@/app/_ui/useRefresh';

// People pages refresh when the tab regains focus, at most every 30 s (design §7.5).
export default function RefreshOnFocus({ minMs = 30_000 }) {
  useRefreshOnFocus(minMs);
  return null;
}
