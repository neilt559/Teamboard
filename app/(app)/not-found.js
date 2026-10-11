import Link from 'next/link';
import { IconAlert } from '@/app/icons';

// One answer for "missing" and "not yours to see", so a 404 never reveals that something exists (§4.6).
export default function NotFound() {
  return (
    <div className="empty shell-error">
      <h3 className="wi" style={{ justifyContent: 'center' }}><IconAlert size={18} /> This page doesn't exist, or you don't have access to it.</h3>
      <p>Check the link, or head back to Home.</p>
      <Link href="/" prefetch={false} className="btn btn-lime">Go to Home</Link>
    </div>
  );
}
