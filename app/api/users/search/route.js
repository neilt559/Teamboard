import { handle } from '@/lib/http';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/users/search?q=&project_id=&limit=&photos=1 (design §4.6, §8.2): people pickers.
// Only public fields: id, name (display_name || username), username, display_name, identity_verified, office,
// department { name, color }, team, approved position name, avatar_v. Never email, position_pending, is_admin
// or image data. photos=1 (Voter photos) adds avatar_crop and has_src, which the re-crop needs.
// project_id orders members first and adds is_member ONLY when the caller can see that project
// (tb_can_see_project); otherwise it is ignored, so membership never leaks.
// Disabled accounts never show; zz_ test accounts show only to other zz_ accounts (rule 51; the local harness).
// An empty q lists everyone (by name), up to limit (default 20, max 500).
export const GET = handle(async ({ req, viewer }) => {
  const sp = new URL(req.url).searchParams;
  const q = String(sp.get('q') || '').trim().toLowerCase().slice(0, 80);
  const pid = /^[0-9]{1,18}$/.test(sp.get('project_id') || '') ? sp.get('project_id') : null;
  const limit = Math.min(500, Math.max(1, Number.parseInt(sp.get('limit') || '20', 10) || 20));
  const photos = sp.get('photos') === '1';
  const zz = /^zz_/.test(viewer.username || '');

  const r = await query(
    `WITH pv AS (SELECT CASE WHEN $2::bigint IS NULL THEN false
                             ELSE COALESCE(tb_can_see_project($1::bigint, $2::bigint), false) END AS ok)
     SELECT u.id, u.username, u.display_name, COALESCE(NULLIF(u.display_name, ''), u.username) AS name,
            (u.identity_verified_at IS NOT NULL) AS identity_verified, u.avatar_v,
            CASE WHEN $6::boolean THEN u.avatar_crop END AS avatar_crop,
            CASE WHEN $6::boolean THEN (u.avatar_src IS NOT NULL) END AS has_src,
            o.name AS office, u.office_id, d.name AS dept_name, d.color AS dept_color, t.name AS team, ap.name AS position,
            CASE WHEN pv.ok THEN EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = $2::bigint
                                           AND m.user_id = u.id AND m.removed_at IS NULL) END AS is_member,
            CASE WHEN $3::text = '' THEN 0
                 WHEN lower(COALESCE(NULLIF(u.display_name, ''), u.username)) = $3::text OR u.username = $3::text THEN 0
                 WHEN starts_with(lower(COALESCE(NULLIF(u.display_name, ''), u.username)), $3::text)
                   OR starts_with(u.username, $3::text) THEN 1
                 ELSE 2 END AS rank
     FROM users u CROSS JOIN pv
     LEFT JOIN offices o ON o.id = u.office_id LEFT JOIN departments d ON d.id = u.department_id
     LEFT JOIN teams t ON t.id = u.team_id LEFT JOIN positions ap ON ap.id = u.approved_position_id
     WHERE u.disabled_at IS NULL
       AND ($4::boolean OR u.username NOT LIKE 'zz!_%' ESCAPE '!')
       AND ($3::text = '' OR strpos(lower(COALESCE(NULLIF(u.display_name, ''), u.username)), $3::text) > 0
            OR strpos(u.username, $3::text) > 0)
     ORDER BY (CASE WHEN pv.ok AND EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = $2::bigint
                                             AND m.user_id = u.id AND m.removed_at IS NULL) THEN 0 ELSE 1 END),
              rank, lower(COALESCE(NULLIF(u.display_name, ''), u.username)), u.id
     LIMIT $5::int`,
    [String(viewer.id), pid, q, zz, limit, photos]);

  return {
    users: r.rows.map((u) => ({
      id: String(u.id),
      username: u.username,
      display_name: u.display_name || '',
      name: u.name,
      identity_verified: !!u.identity_verified,
      avatar_v: u.avatar_v == null ? null : String(u.avatar_v),
      ...(photos ? { avatar_crop: u.avatar_crop || null, has_src: !!u.has_src } : {}),
      office: u.office || null,
      office_id: u.office_id == null ? null : String(u.office_id),
      department: u.dept_name ? { name: u.dept_name, color: u.dept_color } : null,
      team: u.team || null,
      position: u.position || null,
      ...(u.is_member == null ? {} : { is_member: !!u.is_member }),
    })),
  };
}, { allowIncomplete: true });
