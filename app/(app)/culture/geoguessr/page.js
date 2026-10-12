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
  await requirePageViewer();
  let data;
  try {
    data = await loadGeo();
  } catch (e) {
    throw tagUpdating(e);
  }
  // .geo-route only scopes the shell's phone and disabled-button rules away from GeoGuessr (app/styles/shell.css),
  // so it looks exactly as it did; GeoClient and geo-ui.js are unchanged.
  return <div className="geo-route"><GeoClient initial={data} /></div>;
}
