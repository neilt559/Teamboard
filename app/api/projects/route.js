import { handle } from '@/lib/http';
import { createProject } from '@/lib/queries/project';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/projects {name, team_id}: create a project in a team (design §8.2). Anyone may create in their own
// offices' teams, PMs and up anywhere (canCreateProjectIn); the creator becomes a member in the same statement.
// Response keeps today's shape ({ id, team_id, name, notes, ... }), so tabs open across the deploy still work.
export const POST = handle(async ({ viewer, body }) => createProject(viewer, await body()), { legacyWrite: true });
