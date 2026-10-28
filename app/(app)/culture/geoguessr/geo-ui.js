'use client';
// GeoGuessr UI, copied verbatim from the old single page (app/_legacy/page.legacy.js:1622-1910; design §2.3,
// §10(d)). Neil's rule: GeoGuessr stays exactly as it is. The ONE approved change: GeoTracker's default date
// is the browser's local date (localISO(new Date())) instead of the UTC date, so it no longer pre-fills
// tomorrow after 7-8 PM Eastern. The second (Neil, 2026-10-19: "everyone but admins can only touch their office's
// stats"): GeoPage takes canEdit(officeId), and FiveKCounter / GeoTracker take readOnly, which hides the score form,
// the deletes and the 5K taps for other offices. Everything else below is byte-for-byte the old code.
// The handlers that feed these components live in GeoClient.js (also verbatim).
// The third (Neil, 2026-10-22: more stats, "it needs to look clean and the order needs to make sense ... i like hovering
// over them to see the days score and the weeks average and the monthly average"): GeoTracker's stats block is now
// GeoMedals at the top (the medal row replaces the color legend) and GeoChartStats under each graph (math in
// lib/geo-stats.js), and GeoChart shows a hover card instead of the browser's plain tooltip. GeoPage, AddGeoOfficeModal, FiveKCounter,
// GEO_TIERS and tierColor are unchanged.
import { useState, useRef } from 'react';
import { burstConfetti } from '@/app/confetti';
import { IconGlobe, IconStar } from '@/app/icons';
import { localISO } from '@/app/_ui/tasks';
import { geoStats, weeklyAverages, monthlyAverages, tierOf, fmtGeoDay, fmtGeoDate, fmtGeoShort, fmtGeoWeek, fmtGeoMonth, fmtGeoMonthShort } from '@/lib/geo-stats';

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

// The office's numbers (Neil, 2026-10-22): the medal count across the top ("I like the screenshot you have with the
// bronzes, silvers, golds, and diamonds"), then each graph with its own three numbers under it: the daily graph's
// highest, lowest and today's score; the weekly graph's highest, lowest and this week's average; the monthly graph's
// highest, lowest and this month's average. The math is in lib/geo-stats.js.
const MEDAL_ORDER = ['Bronze', 'Silver', 'Gold', 'Diamond'];
const MEDAL_RANGE = { Bronze: '5,000+', Silver: '15,000+', Gold: '22,500+', Diamond: '25,000' };

function GeoStatTile({ label, value, sub, color, muted = false, pct = '' }) {
  return (
    <div className={`gx-tile${color ? ' gx-medal' : ''}${muted ? ' gx-zero' : ''}`} style={color ? { '--tier': color } : undefined}>
      <span className="gx-label">{color && <i aria-hidden />}{label}{pct ? <span className="gx-pct">– {pct}</span> : null}</span>
      <span className="gx-val">{value}</span>
      {sub ? <span className="gx-sub">{sub}</span> : <span className="gx-sub" aria-hidden>&nbsp;</span>}
    </div>
  );
}

// Each medal's share of all the office's rounds (Neil, 2026-10-28: "a % ... just something small", then "smaller and
// maybe like GOLD - 12%"), in the label line after the medal's name (on a phone the medal tiles go two by two so it
// fits): whole percents,
// "<1%" for a medal that is there but rounds to 0.
function medalPct(count, days) {
  if (!days) return '';
  const p = (count / days) * 100;
  return count && p < 0.5 ? '<1%' : `${Math.round(p)}%`;
}

function GeoMedals({ stats }) {
  const color = (label) => (GEO_TIERS.find((t) => t.label === label) || {}).color;
  return (
    <div className="gx gx-medals">
      <div className="gx-head">Medals <span>days at each tier</span></div>
      <div className="gx-row gx-row-4">
        {MEDAL_ORDER.map((m) => (
          <GeoStatTile key={m} label={m} value={(stats.medals[m] || 0).toLocaleString()} pct={medalPct(stats.medals[m] || 0, stats.days)} sub={MEDAL_RANGE[m]} color={color(m)} muted={!stats.medals[m]} />
        ))}
      </div>
    </div>
  );
}

// The three numbers under one graph.
function GeoChartStats({ stats, kind, today }) {
  const year = today.slice(0, 4);
  const num = (v) => (v == null ? '—' : Math.round(v).toLocaleString());
  const soFar = (x) => (x ? `${x.n} ${x.n === 1 ? 'day' : 'days'} so far` : 'No scores yet');
  let tiles;
  if (kind === 'week') {
    const weekOf = (w) => (w ? `Week of ${fmtGeoShort(w.week, year)}` : '');
    tiles = [
      ['Highest week', num(stats.bestWeek?.score), weekOf(stats.bestWeek)],
      ['Lowest week', num(stats.worstWeek?.score), weekOf(stats.worstWeek)],
      ['This week', num(stats.currentWeek?.score), soFar(stats.currentWeek)],
    ];
  } else if (kind === 'month') {
    tiles = [
      ['Highest month', num(stats.bestMonth?.score), fmtGeoMonthShort(stats.bestMonth?.month)],
      ['Lowest month', num(stats.worstMonth?.score), fmtGeoMonthShort(stats.worstMonth?.month)],
      ['This month', num(stats.currentMonth?.score), soFar(stats.currentMonth)],
    ];
  } else {
    const t = stats.today ? tierOf(stats.today.score, GEO_TIERS) : '';
    tiles = [
      ['Highest', num(stats.high.score), fmtGeoShort(stats.high.date, year)],
      ['Lowest', num(stats.low.score), fmtGeoShort(stats.low.date, year)],
      ['Today', num(stats.today?.score), stats.today ? (t === 'Black' ? 'Under 5,000' : t) : 'No score yet'],
    ];
  }
  return (
    <div className="gx-row gx-under" data-kind={kind}>
      {tiles.map(([label, value, sub]) => <GeoStatTile key={label} label={label} value={value} sub={sub} />)}
    </div>
  );
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
  const stats = geoStats(scores, { tiers: GEO_TIERS, today });
  return (
    <>
      {readOnly ? <p className="geo-readonly">Only {officeName || 'this office'}’s people (and admins) add {officeName || 'its'} scores.</p> : <div className="geo-add">
        <input type="date" className="date-input" value={date} onChange={(e) => setDate(e.target.value)} />
        <input type="number" className="geo-input" placeholder="Score" value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
        <button className="btn btn-ink btn-sm" onClick={submit}>+ Add</button>
      </div>}
      {stats && <GeoMedals stats={stats} />}
      <div className="geo-chart-title">Daily scores</div>
      <GeoChart data={sorted} kind="day" />
      {stats && <GeoChartStats stats={stats} kind="day" today={today} />}
      <div className="geo-chart-title">Weekly average <span>(Mon–Fri)</span></div>
      <GeoChart data={weekly} kind="week" />
      {stats && <GeoChartStats stats={stats} kind="week" today={today} />}
      <div className="geo-chart-title">Monthly average</div>
      <GeoChart data={monthly} kind="month" />
      {stats && <GeoChartStats stats={stats} kind="month" today={today} />}
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

// What the hover card says for one bar: the day's score, or the week's / month's average with how many days it covers.
function geoTip(d, kind) {
  const v = Number(d.score);
  const tier = tierOf(v, GEO_TIERS);
  const medal = tier === 'Black' ? '' : tier;
  const days = (n) => `${n} ${n === 1 ? 'day' : 'days'}`;
  if (kind === 'week') return { value: `${v.toLocaleString()} avg`, when: `Week of ${fmtGeoWeek(d.score_date)}`, more: [days(d.n), medal].filter(Boolean).join(' · ') };
  if (kind === 'month') return { value: `${v.toLocaleString()} avg`, when: fmtGeoMonth(d.score_date), more: [days(d.n), medal].filter(Boolean).join(' · ') };
  return { value: v.toLocaleString(), when: fmtGeoDay(d.score_date) || 'No date', more: medal };
}

// Bars colored by medal tier. Hovering a bar (or tapping it on a phone) shows a card with its date and score; the
// whole column above a bar is the hover target, so short bars are as easy to hit as tall ones. A dashed line marks
// the average of the bars shown (Neil, 2026-10-28: "an average line ... like the 12500 and 25000 but its the
// average and it changes over time"; then "on the left ... more grayscale. so its not as in your face"), in light gray
// and labeled at its left end; it moves as scores come in.
function GeoChart({ data, kind = 'day' }) {
  const [hover, setHover] = useState(null);
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
  const axis = (d) => (kind === 'month' ? fmtGeoMonth(d.score_date) : fmtGeoDate(d.score_date)) || d.score_date || '';
  // the average of the bars (weekly and monthly bars use their exact averages, not the rounded ones)
  const avg = data.reduce((a, d) => a + Number(d.avg ?? d.score), 0) / n;
  const h = hover != null && hover < n ? hover : null;
  let tip = null;
  if (h != null) {
    const cx = pad.l + band * h + band / 2;
    const top = y(Number(data[h].score));
    tip = { ...geoTip(data[h], kind), left: (cx / W) * 100, top: Math.min(Math.max(top / H, 0.3), 0.62) * 100, side: cx > W / 2 ? 'left' : 'right' };
  }
  return (
    <div className="geo-chart-wrap gx-chart" onMouseLeave={() => setHover(null)}>
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
            <rect key={d.id} className={h != null && h !== i ? 'gx-dim' : undefined} x={cx - barW / 2} y={top} width={barW} height={Math.max(0, baseline - top)} rx="2" fill={tierColor(v)} />
          );
        })}
        <g className="gx-avg" data-avg={Math.round(avg)}>
          <line x1={pad.l} y1={y(avg)} x2={W - pad.r} y2={y(avg)} />
          <text x={pad.l + 4} y={y(avg) - 4} textAnchor="start">avg {fmt(avg)}</text>
        </g>
        {data.map((d, i) => (
          <rect key={`hit-${d.id}`} className="gx-hit" x={pad.l + band * i} y={pad.t} width={band} height={ih} fill="transparent"
            onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
        ))}
        <text x={pad.l} y={H - 8} textAnchor="start" className="geo-axis">{axis(data[0])}</text>
        {n > 1 && <text x={W - pad.r} y={H - 8} textAnchor="end" className="geo-axis">{axis(data[n - 1])}</text>}
      </svg>
      {tip && (
        <div className={`gx-tip gx-tip-${tip.side}`} style={{ left: `${tip.left}%`, top: `${tip.top}%` }} role="status">
          <b>{tip.value}</b>
          <span>{tip.when}</span>
          {tip.more && <span className="gx-tip-more">{tip.more}</span>}
        </div>
      )}
    </div>
  );
}

export default GeoPage;
export { GeoPage, AddGeoOfficeModal, FiveKCounter, geoStats, weeklyAverages, monthlyAverages, GeoTracker, GeoMedals, GeoChartStats, GEO_TIERS, tierColor, GeoChart };
