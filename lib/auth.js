import crypto from 'crypto';
import { sql } from '@/lib/db';

export const COOKIE = 'tb_session';
export const MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(pw, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(pw, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(test, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await sql`INSERT INTO sessions (token, user_id, expires_at) VALUES (${token}, ${userId}, now() + interval '365 days')`;
  return token;
}

export async function sessionUser(token) {
  if (!token) return null;
  const r = await sql`
    SELECT u.id, u.username FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ${token} AND s.expires_at > now() LIMIT 1`;
  return r.rows[0] || null;
}

export async function deleteSession(token) {
  if (token) await sql`DELETE FROM sessions WHERE token = ${token}`;
}

export const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
  maxAge: MAX_AGE,
};
