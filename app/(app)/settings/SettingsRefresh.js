'use client';
import { useRefreshOnFocus } from '@/app/_ui/useRefresh';

// Settings refreshes when the tab regains focus, at most every 30 s (design §7.5). Open drafts keep their
// edits: each form adopts new server data only while it has no unsaved changes.
export default function SettingsRefresh() {
  useRefreshOnFocus(30_000);
  return null;
}
