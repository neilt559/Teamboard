import { redirect } from 'next/navigation';
import { safeNext } from '@/lib/policy';
import { viewerForLogin } from '@/lib/queries/profile';
import LoginForm from './LoginForm';

// /login (design §2.1, §5.1): Sign in / Create account. ?next= is the page to return to, checked by safeNext
// (same origin only; backslashes and control characters refused). ?signup=1 opens "Create account".
// Someone already signed in goes straight on (to /password or /welcome first when those are pending).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Sign in' };

const ORIGIN = 'http://teamboard.invalid';

export default async function LoginPage({ searchParams }) {
  const raw = typeof searchParams?.next === 'string' ? searchParams.next : '';
  let next = safeNext(raw, ORIGIN);
  if (next && /^\/(login|api)([/?#]|$)/.test(next)) next = null;
  const v = await viewerForLogin();
  if (v) redirect(v.must_change ? '/password' : !v.profile_done ? '/welcome' : (next || '/'));
  return <LoginForm next={next || ''} initialMode={searchParams?.signup ? 'signup' : 'login'} />;
}
