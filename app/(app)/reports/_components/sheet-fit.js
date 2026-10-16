import { CLOUD_PAD_X, CLOUD_PAD_Y, CLOUD_STROKE, cloudPath } from './cloud';

// How a project's owner report sits on paper (Neil, 2026-10-16: landscape, and "it should always fit the information
// on one page ... the text should maybe scale up or down based on how much there is. that way if theres less to update
// on a week it doesnt look empty"). Runs in the browser after the fonts load (SheetFit.js), on a COPY of the
// server-drawn sheet placed in the empty .rs-out next to it, so React never reconciles anything this moves. It
// measures in sheet geometry (data-measure: full sheet size, zoom 1, a few px of extra bottom padding as a safety
// margin), whatever the window is showing.
//   For each column arrangement (meetings under the Status Report, as in the mockup, or under the attention items and
//   schedule; a few ways of splitting the width), a binary search finds the largest type scale --k (every type size
//   and gap is a multiple of it; the title block is fixed) at which the field holds everything. The arrangement with
//   the largest scale wins; the mockup's arrangement wins near-ties. A light week therefore reads large (up to K_MAX)
//   and a heavy one shrinks until it fits (down to K_MIN; past that the sheet is marked not ok, which the harness
//   reports).
// The revision clouds are then redrawn around the late items from the laid-out boxes. The result goes on the copy's
// .rs-pack as data-k / data-mode ('one') / data-sheets ('1') / data-ok (the harness reads them).

export const K_MIN = 0.42;
export const K_MAX = 1.45;
const STEPS = 13;
const ARRS = [
  { side: 'left', r: 1.15 }, { side: 'left', r: 1.0 }, { side: 'left', r: 1.35 },
  { side: 'right', r: 1.15 }, { side: 'right', r: 1.0 }, { side: 'right', r: 0.85 },
];

export function fitPack(pack) {
  const ORIGINAL = pack.innerHTML;
  const restore = () => { pack.innerHTML = ORIGINAL; };
  const field = () => pack.querySelector('.rs-field');
  const fits = () => {
    const f = field();
    if (f.scrollHeight - f.clientHeight > 0.5) return false;
    // nothing may spill sideways either (a long unbroken word, a wide table); the revision clouds stand out past
    // their item on purpose, so the attention list is not checked (its text wraps anywhere)
    return [...f.querySelectorAll('.rs-mast, .rs-prose, .rs-mtgs, .rs-status, .rs-line, .rs-log table')].every((el) => el.scrollWidth - el.clientWidth <= 1);
  };
  const setK = (k) => { pack.style.setProperty('--k', k.toFixed(4)); };
  function arrange(arr) {
    const cols = pack.querySelector('.rs-cols');
    if (!cols) return;
    cols.style.gridTemplateColumns = `minmax(0, ${arr.r}fr) minmax(0, 1fr)`;
    if (arr.side === 'right') {
      const meet = pack.querySelector('.rs-meet');
      const right = pack.querySelector('.rs-col-r');
      if (meet && right) right.insertBefore(meet, pack.querySelector('.rs-sched'));
    }
  }
  // the largest k in [K_MIN, K_MAX] that fits with this arrangement, or null when even K_MIN overflows
  function maxK(arr) {
    restore(); arrange(arr);
    setK(K_MIN);
    if (!fits()) return null;
    setK(K_MAX);
    if (fits()) return K_MAX;
    let lo = K_MIN;
    let hi = K_MAX;
    for (let i = 0; i < STEPS; i++) {
      const mid = (lo + hi) / 2;
      setK(mid);
      if (fits()) lo = mid; else hi = mid;
    }
    return lo;
  }

  let pick = null;
  for (const arr of ARRS) {
    const k = maxK(arr);
    if (k == null) continue;
    // the arrangement allowing the largest type wins; the mockup's (meetings on the left, 1.15 : 1) breaks near-ties
    const score = k - (arr.side === 'left' && arr.r === 1.15 ? 0 : arr.side === 'left' ? 0.01 : 0.02);
    if (!pick || score > pick.score) pick = { arr, k, score };
  }
  restore();
  if (pick) { arrange(pick.arr); setK(pick.k); } else { arrange(ARRS[0]); setK(K_MIN); }
  drawClouds(pack);
  const ok = !!pick && fits();
  Object.assign(pack.dataset, { mode: 'one', sheets: '1', k: (pick ? pick.k : K_MIN).toFixed(3), fit: (pick ? pick.k : K_MIN).toFixed(3), ok: ok ? '1' : '0' });
  return { mode: 'one', sheets: 1, k: pick ? pick.k : K_MIN, level: pick ? pick.k : K_MIN, ok };
}

function drawClouds(pack) {
  pack.querySelectorAll('.rs-item.late').forEach((el) => {
    const svg = el.querySelector(':scope > .rs-cloud');
    const W = el.offsetWidth + CLOUD_PAD_X * 2;
    const H = el.offsetHeight + CLOUD_PAD_Y * 2;
    if (!svg || !W || !H) return;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const path = svg.querySelector('path');
    path.setAttribute('d', cloudPath(W, H));
    path.setAttribute('stroke', CLOUD_STROKE);
  });
}

// Every report on the page: copy each server sheet into its .rs-out, fit it there, then show the copy.
export function fitAll(root = document) {
  const results = [];
  for (const proj of root.querySelectorAll('.rs-proj')) {
    const src = proj.querySelector(':scope > .rs-src > .rs-pack');
    const out = proj.querySelector(':scope > .rs-out');
    if (!src || !out) continue;
    const pack = src.cloneNode(true);
    pack.querySelectorAll('[id]').forEach((e) => e.removeAttribute('id'));
    out.replaceChildren(pack);
    pack.dataset.measure = '1';
    let res;
    try {
      res = fitPack(pack);
    } catch (e) {
      out.replaceChildren();
      proj.removeAttribute('data-fitted');
      results.push({ id: proj.dataset.reportProject, error: String(e?.message || e) });
      continue;
    } finally {
      delete pack.dataset.measure;
    }
    proj.setAttribute('data-fitted', '1');
    results.push({ id: proj.dataset.reportProject, ...res });
  }
  return results;
}
