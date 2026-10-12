'use client';
import { IconAlert } from '@/app/icons';

// The page's error line (the old app showed failed calls in one banner at the top of the page).
export default function ErrorBanner({ error, onDismiss }) {
  if (!error) return null;
  return (
    <div className="banner" role="alert">
      <IconAlert size={16} />
      <span>{error}</span>
      <span className="spacer" />
      {onDismiss && <button type="button" className="btn btn-plain btn-sm" onClick={onDismiss}>Dismiss</button>}
    </div>
  );
}
