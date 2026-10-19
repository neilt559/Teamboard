'use client';
// GeoGuessr UI, copied verbatim from the old single page (app/_legacy/page.legacy.js:1622-1910; design §2.3,
// §10(d)). Neil's rule: GeoGuessr stays exactly as it is. The ONE approved change: GeoTracker's default date
// is the browser's local date (localISO(new Date())) instead of the UTC date, so it no longer pre-fills
// tomorrow after 7-8 PM Eastern. The second (Neil, 2026-10-19: "everyone but admins can only touch their office's
// stats"): GeoPage takes canEdit(officeId), and FiveKCounter / GeoTracker take readOnly, which hides the score form,
// the deletes and the 5K taps for other offices. Everything else below is byte-for-byte the old code.
// The handlers that feed these components live in GeoClient.js (also verbatim).
import { useState, useRef } from 'react';
import { burstConfetti } from '@/app/confetti';
import { IconGlobe, IconStar } from '@/app/icons';
import { localISO } from '@/app/_ui/tasks';

// Every GeoGuessr office side by side, each with its full tracker.
function GeoPage({ offices, available, geo, onAddGeo, onDeleteGeo, onFiveK, onJoin, onCreate, canEdit = () => true }) {
  const [adding, setAdding] = useState(false);
  return (
    <>
      <div className="proj-head">
        <h1 className="wi-h"><IconGlobe size={24} /> Daily GeoGuessr</h1>
        <button className="btn btn-lime btn-sm" onClick={() => setAdding(true)}>+ Add office</button>
      </div>
      {offices.length === 0 && <p className="geo-page-empty">No offices are playing yet — hit “+ Add office” to start tracking scores.</p>}
      <div className="geo-page">
        {offices.map((o) => (
          <section key={o.id} className="office-section geo-office">
            <div className="section-head">
              <h2 className="geo-office-name">{o.name}</h2>
            </div>
            <FiveKCounter count={Number(o.fivek) || 0} onChange={(delta) => onFiveK(o.id, delta)} readOnly={!canEdit(o.id)} />
            <GeoTracker
              scores={geo.filter((g) => String(g.office_id) === String(o.id))}
              onAdd={(score, date) => onAddGeo(o.id, score, date)}
              onDelete={onDeleteGeo}
              readOnly={!canEdit(o.id)}
              officeName={o.name}
            />
          </section>
        ))}
      </div>
      {adding && <AddGeoOfficeModal available={available} onJoin={onJoin} onCreate={onCreate} onClose={() => setAdding(false)} />}
    </>
  );
}

function AddGeoOfficeModal({ available, onJoin, onCreate, onClose }) {
  const [name, setName] = useState('');
  const create = () => { const n = name.trim(); if (!n) return; onCreate(n); onClose(); };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal add-task-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add an office to GeoGuessr</h2>
        {available.length > 0 && (
          <>
            <label className="atm-label">Existing offices</label>
            {available.map((o) => (
              <div key={o.id} className="geo-avail-row">
                <span>{o.name}</span>
                <button className="btn btn-plain btn-sm" onClick={() => { onJoin(o); onClose(); }}>Add</button>
              </div>
            ))}
          </>
        )}
        <label className="atm-label">{available.length ? 'Or create a new office' : 'New office name'}</label>
        <input
          className="field"
          autoFocus
          placeholder="e.g. Raleigh"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
        />
        <p className="geo-modal-note">New offices also appear in the sidebar, so they can use the rest of TeamBoard too.</p>
        <div className="modal-actions">
          <button className="btn btn-plain" onClick={onClose}>Cancel</button>
          <button className="btn btn-ink" onClick={create} disabled={!name.trim()}>Create office</button>
        </div>
      </div>
    </div>
  );
}

// Big celebratory tally of perfect 5,000-point guesses. Tap to add one (with a
// little burst); "Undo one" takes it back if someone hits it by accident.
function FiveKCounter({ count, onChange, readOnly = false }) {
  const [burst, setBurst] = useState(0);
  const btnRef = useRef(null);
  const hit = () => {
    onChange(1);
    setBurst((b) => b + 1);
    // Confetti + gold "5K"s erupt from the middle of the button, with the rings and +1.
    const r = btnRef.current.getBoundingClientRect();
    burstConfetti(r.left + r.width / 2, r.top + r.height / 2);
    if (btnRef.current.animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      btnRef.current.animate(
        [{ transform: 'scale(1)', filter: 'brightness(1)' }, { transform: 'scale(1.045)', filter: 'brightness(1.3)' }, { transform: 'scale(1)', filter: 'brightness(1)' }],
        { duration: 420, easing: 'cubic-bezier(.2, 1.4, .4, 1)' },
      );
    }
  };
  return (
    <div className="fivek">
      <div className="fivek-stage">
        <button ref={btnRef} type="button" className="fivek-btn" onClick={readOnly ? undefined : hit} disabled={readOnly} title={readOnly ? 'Only this office’s people can add its 5Ks' : 'Nailed a 5,000? Tap to add one!'}>
          <span className="fivek-shine" aria-hidden />
          <span className="fivek-top"><IconStar /> 5K Club <IconStar /></span>
          <span key={burst} className={`fivek-count${burst ? ' pop' : ''}`}>{count.toLocaleString()}</span>
          <span className="fivek-sub">{readOnly ? 'perfect 5,000s' : 'perfect 5,000s — tap when you nail one!'}</span>
        </button>
        {burst > 0 && (
          <div key={burst} className="fivek-burst" aria-hidden>
            <span className="fivek-ring" />
            <span className="fivek-ring late" />
            <b>+1</b>
          </div>
        )}
      </div>
      {!readOnly && <div className="fivek-foot">
        <button type="button" className="fivek-undo" onClick={() => onChange(-1)} disabled={count <= 0} title="Pressed it by accident? Take one back">− Undo one</button>
      </div>}
    </div>
  );
}

// Summary stats for GeoGuessr scores. "Work week" = Monday–Friday; weekly
// averages group weekday scores by the Monday of their week.
function geoStats(scores) {
  const vals = scores.map((s) => Number(s.score)).filter((v) => !isNaN(v));
  if (!vals.length) return null;
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const high = Math.max(...vals);
  const low = Math.min(...vals);
  const mean = sum(vals) / vals.length;

  const parseLocal = (s) => { const p = String(s).split('-').map(Number); return new Date(p[0], (p[1] || 1) - 1, p[2] || 1); };
  const fmtLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const mondayOf = (d) => { const dow = d.getDay(); const diff = dow === 0 ? 6 : dow - 1; const m = new Date(d); m.setDate(d.getDate() - diff); return m; };

  const weeks = {};
  scores.forEach((s) => {
    const v = Number(s.score);
    if (isNaN(v) || !s.score_date) return;
    const d = parseLocal(s.score_date);
    if (isNaN(d.getTime())) return;
    const dow = d.getDay();
    if (dow === 0 || dow === 6) return; // work week = Mon–Fri only
    const key = fmtLocal(mondayOf(d));
    (weeks[key] = weeks[key] || []).push(v);
  });
  const avgs = Object.values(weeks).map((arr) => sum(arr) / arr.length);
  const bestWeek = avgs.length ? Math.max(...avgs) : null;
  const worstWeek = avgs.length ? Math.min(...avgs) : null;
  const curKey = fmtLocal(mondayOf(new Date()));
  const currentWeek = weeks[curKey] ? sum(weeks[curKey]) / weeks[curKey].length : null;

  return { high, low, mean, bestWeek, worstWeek, currentWeek };
}

// Work-week (Mon–Fri) averages, keyed by the Monday of each week.
function weeklyAverages(scores) {
  const parse = (s) => { const p = String(s).split('-').map(Number); return new Date(p[0], (p[1] || 1) - 1, p[2] || 1); };
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const monday = (d) => { const dow = d.getDay(); const diff = dow === 0 ? 6 : dow - 1; const m = new Date(d); m.setDate(d.getDate() - diff); return m; };
  const weeks = {};
  scores.forEach((s) => {
    const v = Number(s.score);
    if (isNaN(v) || !s.score_date) return;
    const d = parse(s.score_date);
    if (isNaN(d.getTime())) return;
    const dow = d.getDay();
    if (dow === 0 || dow === 6) return;
    const key = fmt(monday(d));
    (weeks[key] = weeks[key] || []).push(v);
  });
  return Object.keys(weeks).sort().map((k) => ({ id: 'w' + k, score: Math.round(weeks[k].reduce((a, b) => a + b, 0) / weeks[k].length), score_date: k }));
}

// Calendar-month averages, keyed by YYYY-MM.
function monthlyAverages(scores) {
  const months = {};
  scores.forEach((s) => {
    const v = Number(s.score);
    if (isNaN(v) || !s.score_date) return;
    const key = String(s.score_date).slice(0, 7);
    (months[key] = months[key] || []).push(v);
  });
  return Object.keys(months).sort().map((k) => ({ id: 'm' + k, score: Math.round(months[k].reduce((a, b) => a + b, 0) / months[k].length), score_date: k }));
}

function GeoTracker({ scores, onAdd, onDelete, readOnly = false, officeName = '' }) {
  const today = localISO(new Date());
  const [date, setDate] = useState(today);
  const [val, setVal] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const submit = () => { const n = parseInt(val, 10); if (isNaN(n)) return; onAdd(n, date); setVal(''); };
  const sorted = [...scores].sort((a, b) => (a.score_date || '').localeCompare(b.score_date || '') || (Number(a.id) - Number(b.id)));
  const weekly = weeklyAverages(scores);
  const monthly = monthlyAverages(scores);
  const stats = geoStats(scores);
  const fmt = (v) => (v == null ? '—' : Math.round(v).toLocaleString());
  return (
    <>
      {readOnly ? <p className="geo-readonly">Only {officeName || 'this office'}’s people (and admins) add {officeName || 'its'} scores.</p> : <div className="geo-add">
        <input type="date" className="date-input" value={date} onChange={(e) => setDate(e.target.value)} />
        <input type="number" className="geo-input" placeholder="Score" value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
        <button className="btn btn-ink btn-sm" onClick={submit}>+ Add</button>
      </div>}
      <div className="geo-chart-title">Daily scores</div>
      <GeoChart data={sorted} />
      <div className="geo-chart-title">Weekly average <span>(Mon–Fri)</span></div>
      <GeoChart data={weekly} />
      <div className="geo-chart-title">Monthly average</div>
      <GeoChart data={monthly} />
      <div className="geo-legend">
        {[...GEO_TIERS].reverse().map((t) => (
          <span key={t.label} className="geo-leg"><i style={{ background: t.color }} />{t.label}</span>
        ))}
      </div>
      {stats && (
        <div className="geo-stats">
          <div className="geo-stat"><span className="gs-label">High</span><span className="gs-val">{fmt(stats.high)}</span></div>
          <div className="geo-stat"><span className="gs-label">Low</span><span className="gs-val">{fmt(stats.low)}</span></div>
          <div className="geo-stat"><span className="gs-label">All-time avg</span><span className="gs-val">{fmt(stats.mean)}</span></div>
          <div className="geo-stat"><span className="gs-label">This week avg</span><span className="gs-val">{fmt(stats.currentWeek)}</span></div>
          <div className="geo-stat"><span className="gs-label">Best week avg</span><span className="gs-val">{fmt(stats.bestWeek)}</span></div>
          <div className="geo-stat"><span className="gs-label">Worst week avg</span><span className="gs-val">{fmt(stats.worstWeek)}</span></div>
        </div>
      )}
      {sorted.length > 0 && (
        <div className="geo-history">
          <button className="geo-history-toggle" onClick={() => setShowHistory((s) => !s)}>
            {showHistory ? '▾' : '▸'} Score history ({sorted.length})
          </button>
          {showHistory && (
            <div className="geo-list">
              {[...sorted].reverse().map((s) => (
                <div key={s.id} className="geo-row">
                  <span className="geo-date">{s.score_date || '—'}</span>
                  <span className="geo-score">{Number(s.score).toLocaleString()}</span>
                  {!readOnly && <button className="row-x" title="Delete" onClick={() => onDelete(s.id)}>×</button>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

// GeoGuessr medal tiers by score.
const GEO_TIERS = [
  { min: 25000, color: '#3ad0e0', label: 'Diamond' }, // 25000
  { min: 22500, color: '#e0a800', label: 'Gold' },    // 22500–24999
  { min: 15000, color: '#9aa4ad', label: 'Silver' },  // 15000–22499
  { min: 5000, color: '#cd7f32', label: 'Bronze' },   // 5000–14999
  { min: 0, color: '#2f2e2e', label: 'Black' },       // 0–4999
];
function tierColor(v) {
  for (const t of GEO_TIERS) { if (v >= t.min) return t.color; }
  return '#2f2e2e';
}

function GeoChart({ data }) {
  if (!data.length) return <div className="geo-chart-empty">Add a score to start the graph.</div>;
  const W = 520, H = 210;
  const pad = { l: 48, r: 14, t: 14, b: 30 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const scores = data.map((d) => Number(d.score));
  const yMin = 0;
  const yMax = Math.max(25000, ...scores);
  const n = data.length;
  const band = iw / n;
  const barW = Math.max(2, Math.min(38, band * 0.72));
  const y = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin || 1)) * ih;
  const yTicks = [0, 12500, 25000];
  const fmt = (v) => Math.round(v).toLocaleString();
  const baseline = pad.t + ih;
  return (
    <div className="geo-chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="geo-chart" preserveAspectRatio="xMidYMid meet">
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} y1={y(t)} x2={W - pad.r} y2={y(t)} stroke="#ecedee" strokeWidth="1" />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" className="geo-axis">{fmt(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const v = Number(d.score);
          const cx = pad.l + band * i + band / 2;
          const top = y(v);
          return (
            <rect key={d.id} x={cx - barW / 2} y={top} width={barW} height={Math.max(0, baseline - top)} rx="2" fill={tierColor(v)}>
              <title>{d.score_date || ''}: {v.toLocaleString()}</title>
            </rect>
          );
        })}
        <text x={pad.l} y={H - 8} textAnchor="start" className="geo-axis">{data[0].score_date || ''}</text>
        {n > 1 && <text x={W - pad.r} y={H - 8} textAnchor="end" className="geo-axis">{data[n - 1].score_date || ''}</text>}
      </svg>
    </div>
  );
}

export default GeoPage;
export { GeoPage, AddGeoOfficeModal, FiveKCounter, geoStats, weeklyAverages, monthlyAverages, GeoTracker, GEO_TIERS, tierColor, GeoChart };
