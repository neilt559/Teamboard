'use client';
import { useRefreshOnFocus } from '@/app/_ui/useRefresh';

// Challenge pages refresh when the tab regains focus (design §7.5: "Challenge: refresh on focus"), at most every 30 s.
export default function RefreshOnFocus({ minMs = 30_000 }) {
  useRefreshOnFocus(minMs);
  return null;
}
