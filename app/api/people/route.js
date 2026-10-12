import { handle, bad, str } from '@/lib/http';
import { query } from '@/lib/db';
import { normHex } from '@/app/_ui/people';
import { listRoster } from '@/lib/queries/admin';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// "Names on tasks": the task-assignee roster (the people table, separate from login accounts).
//
// GET  -> { people: [{ id, name, color, kind, user_id, archived_at, user_name, user_username, user_verified }] }
//      Non-archived names, ordered by lower(name) then id (today's People modal order). Admins may pass
//      ?archived=1 for archived rows too (plus task_count). The linked account's name is public: the roster
//      shows "Linked to Kyler Hugg".
// POST { name, color?, kind? } adds an unlinked name ('person', the default) or a group (as today: anyone).
//      Returns the new row, keeping today's { id, name, color } shape.
export const GET = handle(async ({ req, viewer }) => {
  const url = new URL(req.url);
  const archived = viewer.is_admin && url.searchParams.get('archived') === '1';
  return { people: await listRoster({ includeArchived: archived, withCounts: !!viewer.is_admin }) };
});

export const POST = handle(async ({ viewer, body }) => {
  const b = await body();
  const name = str(b.name, 120);
  if (!name) throw bad('name required');
  const color = b.color == null || b.color === '' ? '#5B5859' : normHex(b.color);
  if (!color) throw bad('Pick a valid color like #5B5859.');
  const kind = b.kind == null || b.kind === '' ? 'person' : b.kind;
  if (kind !== 'person' && kind !== 'group') throw bad('kind must be person or group.');
  const r = await query(
    `WITH p AS (INSERT INTO people (name, color, kind) VALUES ($1::text, $2::text, $3::text)
                RETURNING id, name, color, kind, user_id, archived_at, created_at),
     a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
           SELECT $4::bigint, 'person.create', 'people', p.id::text, jsonb_build_object('name', p.name, 'kind', p.kind) FROM p)
     SELECT * FROM p`,
    [name, color, kind, String(viewer.id)]);
  const row = r.rows[0];
  return { ...row, id: String(row.id), user_id: null };
}, { legacyWrite: true });
