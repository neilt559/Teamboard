import Link from 'next/link';
import { tagUpdating } from '@/lib/viewer';
import { IconGlobe, IconChevronRight } from '@/app/icons';
import { loadGeoWidget } from '../culture/geoguessr/geo-data';

// Home dashboard widget 'geo' (design §2.1 "GeoGuessr link", §11). An async Server Component with no required
// props: <GeoWidget />. It reads its own small query (every playing office, archived included, as on the
// GeoGuessr page); a dashboard batch that already has the rows from loadGeoWidget() may pass them as
// `offices`. The whole card is one link to /culture/geoguessr.

function fmtDay(ymd) {
  const p = String(ymd || '').split('-').map(Number);
  if (p.length !== 3 || p.some((n) => !Number.isFinite(n))) return String(ymd || '');
  const d = new Date(p[0], p[1] - 1, p[2]);
  return isNaN(d) ? String(ymd) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default async function GeoWidget({ offices: given } = {}) {
  let offices = Array.isArray(given) ? given : null;
  if (!offices) {
    try {
      offices = await loadGeoWidget();
    } catch (e) {
      if (tagUpdating(e)?.digest === 'TB_UPDATING') throw e;
      console.error('[GeoWidget]', e);
      offices = null;   // still render the link
    }
  }
  const list = offices || [];
  const playing = list.length;
  return (
    <Link href="/culture/geoguessr" prefetch={false} className="home-card geo-widget">
      <span className="home-card-icon"><IconGlobe size={22} /></span>
      <span className="home-card-main">
        <span className="home-card-name">Daily GeoGuessr</span>
        <span className="home-card-stats">
          {offices == null ? 'Scores, charts and the 5K Club'
            : playing ? `${playing} office${playing === 1 ? '' : 's'} playing · add today's score`
              : 'No offices are playing yet'}
        </span>
        {list.length > 0 && (
          <span className="geo-widget-rows">
            {list.map((o) => (
              <span key={o.id} className="geo-widget-row">
                <span className="geo-widget-office">{o.name}</span>
                <span className="geo-widget-meta">
                  5K Club {(Number(o.fivek) || 0).toLocaleString('en-US')}
                  {o.last_score != null && (
                    <> · last {Number(o.last_score).toLocaleString('en-US')}{o.last_date ? ` (${fmtDay(o.last_date)})` : ''}</>
                  )}
                </span>
              </span>
            ))}
          </span>
        )}
      </span>
      <IconChevronRight size={18} className="geo-widget-go" />
    </Link>
  );
}
