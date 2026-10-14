import { handle } from '@/lib/http';
import { createProject } from '@/lib/queries/project';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/projects {project_number, name, owner_company, jurisdiction, stages: [keys], current_stage?, team_id}:
// create a project in a team (design §8.2, design-amendments A6.4). Project number, name, owner company and
// jurisdiction are required, with at least one stage (concept, preliminary, final, bidding, construction);
// current_stage defaults to the first chosen stage and the schedule status starts unset. Anyone may create in
// their own offices' teams, PMs and up anywhere (canCreateProjectIn); the creator and the team's roster become
// members in the same statement. Response keeps today's shape ({ id, team_id, name, notes, ... } plus the A6
// columns, stages as an array) and team_members_added.
export const POST = handle(async ({ viewer, body }) => createProject(viewer, await body()), { legacyWrite: true });
