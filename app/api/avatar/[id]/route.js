import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';

const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;
const MAX_LEN = 400000; // ~300 KB image; the client sends ~15 KB squares

// Serve a user's headshot. The page adds ?v=<avatar_v> to the URL, so the
// browser can cache each version forever.
export async function GET(req, { params }) {
  try {
    await ensureSchema();
    const { id } = await params;
    const r = await sql`SELECT avatar FROM users WHERE id = ${id}`;
    const m = DATA_URL.exec((r.rows[0] && r.rows[0].avatar) || '');
    if (!m) return new Response('Not found', { status: 404 });
    return new Response(Buffer.from(m[2], 'base64'), {
      headers: { 'Content-Type': m[1], 'Cache-Control': 'private, max-age=31536000, immutable' },
    });
  } catch (e) {
    return new Response('Error', { status: 500 });
  }
}

// Set a headshot. Any signed-in user can set anyone's, so one person can load
// the whole office's photos at once.
export async function PUT(req, { params }) {
  try {
    await ensureSchema();
    const { id } = await params;
    const { image } = await req.json();
    if (typeof image !== 'string' || image.length > MAX_LEN || !DATA_URL.test(image)) {
      return NextResponse.json({ error: 'Please use a JPG, PNG or WebP image.' }, { status: 400 });
    }
    const r = await sql`UPDATE users SET avatar = ${image}, avatar_v = ${Date.now()} WHERE id = ${id} RETURNING id, avatar_v`;
    if (!r.rows.length) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    return NextResponse.json(r.rows[0]);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    await ensureSchema();
    const { id } = await params;
    await sql`UPDATE users SET avatar = NULL, avatar_v = NULL WHERE id = ${id}`;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
