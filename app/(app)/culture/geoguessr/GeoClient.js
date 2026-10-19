'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api as tbApi } from '@/app/_ui/api';
import { byPos } from '@/app/_ui/tasks';
import { IconAlert, IconGlobe } from '@/app/icons';
import GeoPage from './geo-ui';
import { canTouchOfficeStats } from '@/lib/policy';

// GeoGuessr's data and handlers, kept exactly as they were on the old single page (design §2.3, §10(d)):
// addGeo, deleteGeo (with its native confirm), joinGeo, createGeoOffice and bumpFiveK are copied verbatim from
// app/_legacy/page.legacy.js:307-322 and 453-474, and send the same request bodies to the same endpoints
// (POST /api/geo, DELETE /api/geo/:id, PATCH /api/offices/:id {geo_on:true}, POST /api/offices
// {name, geo_on:true}, POST /api/fivek). load/touch are the old poll and its guard: every 4 s, skipped for
// 2.5 s after any local change. The only differences from the old page are plumbing:
//   - the first data comes from the server render, so there is no load(true) on mount (the UI itself still
//     renders in the browser only, as before; see `mounted` below);
//   - the poll reads GET /api/geo/state (the old /api/state offices + geo arrays, nothing else) and runs while
//     the tab is visible, with one immediate load when it becomes visible again;
//   - fresh server props (router.refresh() on Back/Forward) are adopted outside the guard window.

export const POLL_MS = 4000;   // same 4 s poll as the old page

// The shared client helper (X-TB-Client: 2, sign-in and profile redirects). Errors show in this page's own
// banner, as they did on the old page, so the shell banner stays quiet.
const api = (path, opts) => tbApi(path, { quiet: true, ...opts });

const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';

export default function GeoClient({ initial, rights = null }) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState(null);
  const guard = useRef(0);
  // GeoPage renders in the browser only, as it always did: its default date, "This week" and number
  // formatting depend on the browser's clock, time zone and locale, which the server can't know (Vercel runs
  // in UTC). Server-rendering it would hydrate the date input with the server's date (the very UTC bug the
  // local-date fix removes) and trip a hydration mismatch. The server sends the page heading only.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const load = useCallback(async (force = false) => {
    if (!force && Date.now() < guard.current) return;
    try {
      const d = await api('/api/geo/state');
      setData(d);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    const t = setInterval(() => { if (visible()) load(false); }, POLL_MS);
    const onVis = () => { if (visible()) load(false); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [load]);

  // New props from a server re-render (router.refresh()): adopt them unless a local change is in its guard
  // window (the next poll catches up then).
  const firstProps = useRef(true);
  useEffect(() => {
    if (firstProps.current) { firstProps.current = false; return; }
    if (Date.now() >= guard.current) setData(initial);
  }, [initial]);

  const touch = () => { guard.current = Date.now() + 2500; };

  // ---- geoguessr ----
  async function addGeo(officeId, score, date) {
    touch();
    try { await api('/api/geo', { method: 'POST', body: JSON.stringify({ office_id: officeId, score, score_date: date }) }); await load(true); }
    catch (e) { setError(e.message); }
  }
  async function deleteGeo(id) {
    const g = data.geo.find((x) => String(x.id) === String(id));
    const office = g && data.offices.find((o) => String(o.id) === String(g.office_id));
    const what = g ? `the ${Number(g.score).toLocaleString()} score${g.score_date ? ` from ${g.score_date}` : ''}${office ? ` (${office.name})` : ''}` : 'this score';
    if (!confirm(`Delete ${what}?\n\nOnly do this to fix a mistake — it can’t be undone.`)) return;
    setData((d) => ({ ...d, geo: d.geo.filter((x) => x.id !== id) }));
    touch();
    try { await api(`/api/geo/${id}`, { method: 'DELETE' }); }
    catch (e) { setError(e.message); }
  }

  // Joining GeoGuessr is one-way: there's deliberately no way to take an
  // office back off the GeoGuessr page.
  async function joinGeo(office) {
    setData((d) => ({ ...d, offices: d.offices.map((x) => (x.id === office.id ? { ...x, geo_on: true } : x)) }));
    touch();
    try { await api(`/api/offices/${office.id}`, { method: 'PATCH', body: JSON.stringify({ geo_on: true }) }); }
    catch (e) { setError(e.message); }
  }
  async function createGeoOffice(name) {
    touch();
    try { await api('/api/offices', { method: 'POST', body: JSON.stringify({ name, geo_on: true }) }); await load(true); }
    catch (e) { setError(e.message); }
  }
  async function bumpFiveK(officeId, delta) {
    setData((d) => ({
      ...d,
      offices: d.offices.map((o) => (String(o.id) === String(officeId) ? { ...o, fivek: Math.max(0, (Number(o.fivek) || 0) + delta) } : o)),
    }));
    touch();
    try { await api('/api/fivek', { method: 'POST', body: JSON.stringify({ office_id: officeId, delta }) }); }
    catch (e) { setError(e.message); }
  }

  if (!mounted) {
    return (
      <div className="proj-head">
        <h1 className="wi-h"><IconGlobe size={24} /> Daily GeoGuessr</h1>
      </div>
    );
  }

  const activeOffices = [...data.offices].filter((o) => !o.archived).sort(byPos);

  return (
    <>
      {error && (
        <div className="banner">
          <IconAlert size={16} />
          <span>{error}</span>
        </div>
      )}
      <GeoPage
        // Archived offices stay on the GeoGuessr page — once an office
        // plays, its column (and its scores) never disappear.
        offices={[...data.offices].filter((o) => o.geo_on !== false).sort(byPos)}
        available={activeOffices.filter((o) => o.geo_on === false)}
        geo={data.geo}
        onAddGeo={addGeo}
        onDeleteGeo={deleteGeo}
        onFiveK={bumpFiveK}
        onJoin={joinGeo}
        onCreate={createGeoOffice}
        canEdit={(officeId) => canTouchOfficeStats(rights, officeId)}
      />
    </>
  );
}
