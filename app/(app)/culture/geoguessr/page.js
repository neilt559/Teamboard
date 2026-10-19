import { requirePageViewer, tagUpdating } from '@/lib/viewer';
import { loadGeo } from './geo-data';
import GeoClient from './GeoClient';

// /culture/geoguessr (design §2.1, §10(d)): GeoGuessr, unchanged. Every playing office (archived included)
// for every signed-in viewer, whatever their office scope. The server render hands the client the same
// offices + geo arrays the old page got from /api/state; GeoClient then polls GET /api/geo/state every 4 s.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'GeoGuessr' };

export default async function GeoGuessrPage() {
  const viewer = await requirePageViewer();
  // Who may change which office's scores and 5Ks (Neil, 2026-10-19): admins any, everyone else their own offices.
  const rights = { is_admin: !!viewer.is_admin, office_ids: (viewer.office_ids || []).map(String) };
  let data;
  try {
    data = await loadGeo();
  } catch (e) {
    throw tagUpdating(e);
  }
  // .geo-route only scopes the shell's phone and disabled-button rules away from GeoGuessr (app/styles/shell.css),
  // so it looks exactly as it did. The one change since (Neil, 2026-10-19): other offices' columns are read-only
// unless you're an admin (rights -> GeoPage canEdit).
  return <div className="geo-route"><GeoClient initial={data} rights={rights} /></div>;
}
