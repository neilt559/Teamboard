import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

// Paths reachable without a session (the login page and the auth endpoints).
const PUBLIC = new Set([
  '/login',
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/logout',
  '/api/auth/me',
]);

export async function middleware(req) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.has(pathname)) return NextResponse.next();

  const token = req.cookies.get('tb_session')?.value;
  let valid = false;
  if (token) {
    try {
      const cs = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
      const sql = neon(cs, { fetchOptions: { cache: 'no-store' } });
      const rows = await sql`SELECT 1 FROM sessions WHERE token = ${token} AND expires_at > now() LIMIT 1`;
      valid = Array.isArray(rows) && rows.length > 0;
    } catch {
      valid = false;
    }
  }

  if (valid) return NextResponse.next();

  if (pathname.startsWith('/api')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
