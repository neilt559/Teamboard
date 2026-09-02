import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { sessionUser, COOKIE } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req) {
  try {
    await ensureSchema();
    const token = req.cookies.get(COOKIE)?.value;
    const user = await sessionUser(token);
    return NextResponse.json({ user: user || null });
  } catch (e) {
    return NextResponse.json({ user: null });
  }
}
