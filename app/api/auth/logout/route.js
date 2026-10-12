import { NextResponse } from 'next/server';
import { handle } from '@/lib/http';
import { deleteSession, COOKIE } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/auth/logout: sign out this device (inventory §1.1). Deletes this session row, as today (matched by
// hash, or by plaintext only for a row with no hash yet, so a stored 'v2;<hash>' value signs nobody out), and
// clears the cookie. Public, and a failed delete still clears the cookie.
export const POST = handle(async ({ req }) => {
  try { await deleteSession(req.cookies.get(COOKIE)?.value); } catch (e) { console.error('logout: session delete failed', e?.code || e); }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return res;
}, { auth: 'public', maxBody: 10_000 });
