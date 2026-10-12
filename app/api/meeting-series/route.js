import { handle } from '@/lib/http';
import { createSeries } from '@/lib/queries/project';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/meeting-series {project_id, name}: a new meeting series (blank name -> 'Series'). Anyone who can
// see the project. Today's response shape: { id, project_id, name, position }.
export const POST = handle(async ({ viewer, body }) => createSeries(viewer, await body()), { legacyWrite: true });
