import { handle, HttpError, parseId } from '@/lib/http';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// Headshots (inventory §1.16; design §8.2). Same semantics and limits as before:
//   GET    /api/avatar/:id[?src=1]   the cropped headshot, or the larger photo it was cropped from. The page adds
//                                    ?v=<avatar_v>, so each version is cached forever (rule 36).
//   PUT    /api/avatar/:id { image, crop, source? }   source only when the photo is new or rotated (rule 37)
//   DELETE /api/avatar/:id
// Anyone signed in may set or remove anyone's photo (Neil's deliberate choice, rule 50); every change records
// who made it (avatar_set_by / avatar_set_at, plus an audit row). Before the profile is finished only your own
// photo can change (the wizard's photo step); old tabs keep their 48 h grace (legacyWrite).

const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;
const MAX_IMAGE = 400000;    // the cropped headshot (~20 KB in practice)
const MAX_SOURCE = 2500000;  // the larger photo kept for re-cropping (~300 KB in practice)

const notFoundText = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });

export const GET = handle(async ({ req, params }) => {
  const id = /^[0-9]{1,18}$/.test(String(params.id ?? '')) ? String(params.id) : null;
  if (!id) return notFoundText();
  const wantSrc = new URL(req.url).searchParams.get('src') === '1';
  const r = await query(
    wantSrc ? 'SELECT avatar_src AS img FROM users WHERE id = $1::bigint' : 'SELECT avatar AS img FROM users WHERE id = $1::bigint',
    [id]);
  const m = DATA_URL.exec(r.rows[0]?.img || '');
  if (!m) return notFoundText();
  return new Response(Buffer.from(m[2], 'base64'), {
    headers: { 'Content-Type': m[1], 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' },
  });
}, { allowIncomplete: true });

// Profile not finished: only your own photo (§5.2 allow-list), unless this is an old tab inside the grace.
function checkWho(viewer, id, legacyClient) {
  if (!viewer.profile_done && !legacyClient && String(viewer.id) !== String(id)) {
    throw new HttpError(403, 'Finish your profile first.', { code: 'profile_required' });
  }
}

export const PUT = handle(async ({ viewer, params, body, legacyClient }) => {
  const id = parseId(params.id);
  checkWho(viewer, id, legacyClient);
  const { image, source, crop } = await body();
  if (typeof image !== 'string' || image.length > MAX_IMAGE || !DATA_URL.test(image)) {
    throw new HttpError(400, 'Please use a JPG, PNG or WebP image.');
  }
  if (source != null && (typeof source !== 'string' || source.length > MAX_SOURCE || !DATA_URL.test(source))) {
    throw new HttpError(400, 'That photo is too large — try a smaller one.');
  }
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const cropText = crop && typeof crop === 'object' ? JSON.stringify({ x: n(crop.x), y: n(crop.y), w: n(crop.w) }) : null;
  const r = await query(
    `WITH u AS (UPDATE users SET avatar = $2::text,
                  avatar_src = CASE WHEN $3::text IS NULL THEN avatar_src ELSE $3::text END,
                  avatar_crop = $4::text, avatar_v = $5::bigint, avatar_set_by = $6::bigint, avatar_set_at = now()
                WHERE id = $1::bigint
                RETURNING id, avatar_v, avatar_crop, (avatar_src IS NOT NULL) AS has_src),
     a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
           SELECT $6::bigint, 'avatar.set', 'users', u.id::text, jsonb_build_object('new_source', $3::text IS NOT NULL) FROM u)
     SELECT * FROM u`,
    [id, image, source ?? null, cropText, Date.now(), viewer.id]);
  if (!r.rows.length) throw new HttpError(404, 'User not found');
  const row = r.rows[0];
  return { id: String(row.id), avatar_v: row.avatar_v, avatar_crop: row.avatar_crop, has_src: !!row.has_src };
}, { allowIncomplete: true, legacyWrite: true, maxBody: 3_000_000 });

export const DELETE = handle(async ({ viewer, params, legacyClient }) => {
  const id = parseId(params.id);
  checkWho(viewer, id, legacyClient);
  await query(
    `WITH u AS (UPDATE users SET avatar = NULL, avatar_src = NULL, avatar_crop = NULL, avatar_v = NULL,
                  avatar_set_by = $2::bigint, avatar_set_at = now()
                WHERE id = $1::bigint AND (avatar IS NOT NULL OR avatar_src IS NOT NULL OR avatar_v IS NOT NULL)
                RETURNING id)
     INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
     SELECT $2::bigint, 'avatar.remove', 'users', u.id::text, '{}'::jsonb FROM u`,
    [id, viewer.id]);
  return { ok: true };
}, { allowIncomplete: true, legacyWrite: true, maxBody: 10_000 });
