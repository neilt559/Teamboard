import { requirePageViewer } from '@/lib/viewer';
import { IconGlobe } from '@/app/icons';

// Placeholder from M0 so the route exists and is guarded; replaced in M2 (C1) (design §2.1, §15).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'GeoGuessr' };

export default async function GeoGuessrPage() {
  const viewer = await requirePageViewer();
  return (
    <div className="coming-soon">
      <div className="proj-head">
        <h1 className="wi-h"><IconGlobe size={24} /> GeoGuessr</h1>
      </div>
      <div className="empty">
        <h3>Coming soon</h3>
        <p>GeoGuessr scores, charts and the 5K Club, exactly as before.</p>
      </div>
    </div>
  );
}
