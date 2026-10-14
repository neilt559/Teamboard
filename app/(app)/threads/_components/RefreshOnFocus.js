'use client';
import { useRefreshOnFocus } from '@/app/_ui/useRefresh';

// /threads refreshes when the tab regains focus (design §7.5: thread lists refresh on focus).
export default function RefreshOnFocus({ minMs = 30_000 }) {
  useRefreshOnFocus(minMs);
  return null;
}
