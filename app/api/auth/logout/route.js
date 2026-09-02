import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { deleteSession, COOKIE } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
  const token = req.cookies.get(COOKIE)?.value;
  try { await ensureSchema(); await deleteSession(token); } catch {}
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return res;
}
