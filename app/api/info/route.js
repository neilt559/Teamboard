import { handle } from '@/lib/http';
import { createInfo } from '@/lib/queries/project';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/info {project_id}: a blank "Additional project info" row at the end (design §8.2). Anyone who can
// see the project. Today's response shape: { id, project_id, label, value, position }.
export const POST = handle(async ({ viewer, body }) => createInfo(viewer, await body()), { legacyWrite: true });
