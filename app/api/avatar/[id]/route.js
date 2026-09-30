import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';

const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;
const MAX_IMAGE = 400000;    // the cropped headshot (~20 KB in practice)
const MAX_SOURCE = 2500000;  // the larger photo kept for re-cropping (~300 KB in practice)

// Serve a user's headshot, or with ?src=1 the larger photo it was cropped
// from. The page adds ?v=<avatar_v>, so each version can be cached forever.
export async function GET(req, { params }) {
  try {
    await ensureSchema();
    const { id } = await params;
    const wantSrc = new URL(req.url).searchParams.get('src') === '1';
    const r = await sql`SELECT avatar, avatar_src FROM users WHERE id = ${id}`;
    const row = r.rows[0] || {};
    const m = DATA_URL.exec((wantSrc ? row.avatar_src : row.avatar) || '');
    if (!m) return new Response('Not found', { status: 404 });
    return new Response(Buffer.from(m[2], 'base64'), {
      headers: { 'Content-Type': m[1], 'Cache-Control': 'private, max-age=31536000, immutable' },
    });
  } catch (e) {
    return new Response('Error', { status: 500 });
  }
}

// Set a headshot: { image, crop, source? }. source (the larger photo) is only
// sent when it's new or was rotated — re-cropping keeps the stored one. Any
// signed-in user can set anyone's, so one person can load the whole office.
export async function PUT(req, { params }) {
  try {
    await ensureSchema();
    const { id } = await params;
    const { image, source, crop } = await req.json();
    if (typeof image !== 'string' || image.length > MAX_IMAGE || !DATA_URL.test(image)) {
      return NextResponse.json({ error: 'Please use a JPG, PNG or WebP image.' }, { status: 400 });
    }
    if (source != null && (typeof source !== 'string' || source.length > MAX_SOURCE || !DATA_URL.test(source))) {
      return NextResponse.json({ error: 'That photo is too large — try a smaller one.' }, { status: 400 });
    }
    const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const cropText = crop ? JSON.stringify({ x: n(crop.x), y: n(crop.y), w: n(crop.w) }) : null;
    const r = source
      ? await sql`UPDATE users SET avatar = ${image}, avatar_src = ${source}, avatar_crop = ${cropText}, avatar_v = ${Date.now()}
                  WHERE id = ${id} RETURNING id, avatar_v, avatar_crop, (avatar_src IS NOT NULL) AS has_src`
      : await sql`UPDATE users SET avatar = ${image}, avatar_crop = ${cropText}, avatar_v = ${Date.now()}
                  WHERE id = ${id} RETURNING id, avatar_v, avatar_crop, (avatar_src IS NOT NULL) AS has_src`;
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
    await sql`UPDATE users SET avatar = NULL, avatar_src = NULL, avatar_crop = NULL, avatar_v = NULL WHERE id = ${id}`;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
