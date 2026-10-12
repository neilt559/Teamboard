import { handle } from '@/lib/http';
import { loadGeo } from '@/app/(app)/culture/geoguessr/geo-data';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// GeoGuessr's 4 s poll (design §7.5, §8.2, §10(d)): { offices, geo } with exactly the rows, columns and order
// of the old GET /api/state `offices` and `geo` arrays. The same for every signed-in viewer.
export const GET = handle(async () => loadGeo());
