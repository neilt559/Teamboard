import { handle } from '@/lib/http';
import { createMeeting } from '@/lib/queries/project';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/project-meetings {project_id, series_id?, title, meeting_date, attendance, notes}: a meeting is
// written up first and posted in one go (design §8.2). series_id must belong to the same project.
// Today's response shape (the created row).
export const POST = handle(async ({ viewer, body }) => createMeeting(viewer, await body()), { legacyWrite: true });
