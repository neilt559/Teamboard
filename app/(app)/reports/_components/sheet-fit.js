import { CLOUD_PAD_X, CLOUD_PAD_Y, CLOUD_STROKE, cloudPath } from './cloud';

// How a project's owner report sits on paper (design-amendments A11: "everything on one page"). Runs in the browser
// after the fonts load (SheetFit.js), on a COPY of the server-drawn sheet placed in the empty .rs-out next to it, so
// React never reconciles anything this moves. It measures in sheet geometry (data-measure: full sheet width, zoom 1,
// a few px of extra bottom padding as a safety margin), whatever the window is showing.
//   1. One sheet: try density 0..4 (spacing first, then type, down to 8.5 pt body / 7.5 pt small). At each density
//      try a few column arrangements (meetings under the attention items or under the notes; how the width is split)
//      and keep the best balanced one that fits.
//   2. Two sheets: only when the floor still overflows. The submittal log moves to sheet 2, which repeats the title
//      block; density goes back up to the largest step at which sheet 1 holds the rest.
//   3. Continuation: if even that fails at the floor, trailing notes / items / meetings continue on the next sheet
//      under "continued" titles, and log rows run on to further sheets with the header repeated.
// Every sheet is then checked: nothing may extend into the title block. The revision clouds are redrawn around the
// late items from the laid-out boxes. The result goes on the copy's .rs-pack as data-mode / data-sheets / data-fit /
// data-ok (the harness reads them).

const LEVELS = [0, 1, 2, 3, 4];
const RATIOS = [1.22, 1.05, 1.4, 0.9];

export function fitPack(pack) {
  const ORIGINAL = pack.innerHTML;
  const hasItems = !!pack.querySelector('.rs-items');
  const restore = () => { pack.innerHTML = ORIGINAL; };
  const sheets = () => [...pack.querySelectorAll(':scope > .rs-sheet')];
  const field = (s) => s.querySelector('.rs-field');
  const over = (s) => { const f = field(s); return f.scrollHeight - f.clientHeight; };
  const fits = (s) => over(s) <= 0.5;
  const allFit = () => sheets().every(fits);
  const h = (el) => (el ? el.getBoundingClientRect().height : 0);

  const ARRS = [];
  for (const side of hasItems ? ['right', 'left'] : ['right']) for (const r of RATIOS) ARRS.push({ side, r });
  function arrange(arr) {
    const cols = pack.querySelector('.rs-cols');
    if (!cols) return;
    cols.style.gridTemplateColumns = `minmax(0, ${arr.r}fr) minmax(0, 1fr)`;
    if (arr.side === 'left') pack.querySelector('.rs-col-l').append(pack.querySelector('.rs-meet'));
  }
  const colsHeight = (s) => Math.max(h(s.querySelector('.rs-col-l')), h(s.querySelector('.rs-col-r')));
  const colsGap = (s) => Math.abs(h(s.querySelector('.rs-col-l')) - h(s.querySelector('.rs-col-r')));

  function addSheet() {
    const first = pack.querySelector('.rs-sheet');
    const s = document.createElement('section');
    s.className = 'rs-sheet';
    const frame = document.createElement('div');
    frame.className = 'rs-frame';
    const f = document.createElement('div');
    f.className = 'rs-field';
    frame.append(f, first.querySelector('.rs-tb').cloneNode(true));
    s.append(frame);
    pack.append(s);
    return s;
  }
  function logToNextSheet() {
    const s1 = sheets()[0];
    s1.querySelector('.rs-sp-c')?.remove();
    field(addSheet()).append(s1.querySelector('.rs-log'));
  }

  // ---- continuation (step 3) ----
  function contSection(sheet, src, side) {
    const key = src.classList.contains('rs-notes') ? 'rs-notes' : src.classList.contains('rs-items') ? 'rs-items' : 'rs-meet';
    let cols = field(sheet).querySelector(':scope > .rs-cols');
    if (!cols) {
      cols = document.createElement('div');
      cols.className = 'rs-cols';
      cols.style.gridTemplateColumns = pack.querySelector('.rs-cols')?.style.gridTemplateColumns || '';
      cols.innerHTML = '<div class="rs-col rs-col-l"></div><div class="rs-col rs-col-r"></div>';
      field(sheet).prepend(cols);
      const sp = document.createElement('div');
      sp.className = 'rs-sp rs-sp-c';
      cols.after(sp);
    }
    let sec = cols.querySelector(`.${key}`);
    if (!sec) {
      sec = src.cloneNode(true);
      sec.querySelector('.rs-vt h2').insertAdjacentHTML('beforeend', '<small>continued</small>');
      sec.querySelector('.rs-vt p')?.remove();
      if (key === 'rs-notes') sec.querySelector('.rs-prose').replaceChildren();
      if (key === 'rs-meet') sec.querySelector('.rs-mtgs')?.replaceChildren();
      if (key === 'rs-items') sec.querySelector('ol.rs-list').replaceChildren();
      cols.querySelector(side === 'l' ? '.rs-col-l' : '.rs-col-r').append(sec);
    }
    return sec;
  }
  function pushUnit(from, to) {
    // the column that reaches lowest gives up its last unit
    const cols = [...from.querySelectorAll('.rs-cols > .rs-col')].filter((c) => c.children.length);
    if (!cols.length) return false;
    cols.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
    const col = cols[0];
    const side = col.classList.contains('rs-col-l') ? 'l' : 'r';
    const sec = col.lastElementChild;
    const dst = contSection(to, sec, side);
    if (sec.classList.contains('rs-notes')) {
      const blks = sec.querySelectorAll('.rs-prose > .rs-blk');
      const last = blks[blks.length - 1];
      const prose = dst.querySelector('.rs-prose');
      const lis = last ? last.querySelectorAll(':scope > ul > li') : [];
      if (last && last.classList.contains('rs-grp') && lis.length > 1) {
        // a header's bullets carry over one at a time (the header stays with the ones left on this sheet)
        let cont = prose.firstElementChild;
        if (!cont || !cont.classList.contains('rs-cont')) {
          cont = document.createElement('div');
          cont.className = 'rs-blk rs-grp rs-cont';
          cont.append(document.createElement('ul'));
          prose.prepend(cont);
        }
        cont.querySelector('ul').prepend(lis[lis.length - 1]);
        return true;
      }
      if (last) {
        prose.prepend(last);
        // the rest of a header's bullets were already carried over: put them back under it
        const cont = last.nextElementSibling;
        if (cont?.classList.contains('rs-cont') && last.classList.contains('rs-grp')) {
          let ul = last.querySelector(':scope > ul');
          if (!ul) { ul = document.createElement('ul'); last.append(ul); }
          ul.append(...cont.querySelectorAll(':scope > ul > li'));
          cont.remove();
        }
      }
      if (blks.length <= 1) sec.remove();
    } else if (sec.classList.contains('rs-meet')) {
      const m = sec.querySelectorAll('.rs-mtg');
      if (!m.length) { sec.remove(); return true; }
      dst.querySelector('.rs-mtgs').prepend(m[m.length - 1]);
      if (m.length <= 1) sec.remove();
    } else {
      const ol = sec.querySelector('ol.rs-list');
      dst.querySelector('ol.rs-list').prepend(ol.lastElementChild);
      dst.querySelector('ol.rs-list').setAttribute('start', String(sec.querySelectorAll('.rs-item').length + 1));
      dst.style.counterReset = `rsn ${sec.querySelectorAll('.rs-item').length}`;
      if (!sec.querySelector('.rs-item')) sec.remove();
    }
    return true;
  }
  function pushLogRows(from, to) {
    const log = from.querySelector('.rs-log');
    if (!log) return false;
    const rows = log.querySelectorAll('tbody tr');
    if (rows.length <= 2) { field(to).prepend(log); return true; }
    let dst = to.querySelector('.rs-log');
    if (!dst) {
      dst = log.cloneNode(true);
      dst.querySelector('.rs-vt h2').insertAdjacentHTML('beforeend', '<small>continued</small>');
      dst.querySelector('.rs-vt p')?.remove();
      dst.querySelector('tbody').replaceChildren();
      field(to).prepend(dst);
    }
    dst.querySelector('tbody').prepend(rows[rows.length - 1]);
    return true;
  }

  function drawClouds() {
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

  function finalize(mode, level) {
    const all = sheets();
    const N = all.length;
    all.forEach((s, i) => {
      s.setAttribute('aria-label', `Sheet ${i + 1} of ${N}`);
      const hasStatus = !!s.querySelector('.rs-notes, .rs-items, .rs-meet');
      const hasLog = !!s.querySelector('.rs-log');
      let title = 'Status report';
      if (N > 1) {
        title = i === 0 ? 'Status & attention items'
          : hasStatus && hasLog ? 'Status & log, continued' : hasLog ? 'Submittals & permits' : 'Status, continued';
      }
      s.querySelector('.rs-tb-title').textContent = title;
      s.querySelector('.rs-num').textContent = String(i + 1);
      s.querySelector('.rs-of').textContent = `of ${N}`;
      const last = field(s).lastElementChild;
      if (last?.classList.contains('rs-sp')) last.remove();
    });
    drawClouds();
    // the guarantee: every sheet's content ends above its title block, and the title block holds its own text
    const checks = all.map((s) => {
      const tb = s.querySelector('.rs-tb');
      const tbTop = tb.getBoundingClientRect().top;
      let low = 0;
      field(s).querySelectorAll('*').forEach((e) => { const r = e.getBoundingClientRect(); if (r.height) low = Math.max(low, r.bottom); });
      return { over: over(s), clear: tbTop - low, tbOver: tb.scrollHeight - tb.clientHeight };
    });
    const ok = checks.every((c) => c.clear >= 0 && c.over <= 0.5 && c.tbOver <= 1);
    Object.assign(pack.dataset, { mode, sheets: String(N), fit: String(level), ok: ok ? '1' : '0' });
    return { mode, level, sheets: N, ok, checks };
  }

  // The largest type and spacing that fits wins; among the arrangements that fit at that step, the lowest and most
  // evenly ending pair of columns wins, with a small preference for meetings on the right at 1.22:1.
  function best(setup) {
    for (const level of LEVELS) {
      const ok = [];
      for (const arr of ARRS) {
        restore(); pack.dataset.fit = String(level); arrange(arr); setup();
        if (allFit()) {
          const s1 = sheets()[0];
          ok.push({ arr, score: colsHeight(s1) + 0.3 * colsGap(s1) + (arr.side === 'left' ? 6 : 0) + Math.abs(arr.r - 1.22) * 10 });
        }
      }
      if (ok.length) { ok.sort((a, b) => a.score - b.score); return { level, arr: ok[0].arr }; }
    }
    return null;
  }
  const finish = (mode, setup, pick) => {
    restore(); pack.dataset.fit = String(pick.level); arrange(pick.arr); setup();
    return finalize(mode, pick.level);
  };

  const oneSheet = () => {};
  const twoSheets = () => { if (pack.querySelector('.rs-log')) logToNextSheet(); };
  let pick = best(oneSheet);
  if (pick) return finish('one', oneSheet, pick);
  pick = best(twoSheets);
  if (pick) return finish('two', twoSheets, pick);

  const continued = () => {
    if (pack.querySelector('.rs-log')) logToNextSheet();
    let guard = 0;
    for (let i = 0; i < sheets().length; i++) {
      while (!fits(sheets()[i])) {
        if (++guard > 600) return;
        const next = sheets()[i + 1] || addSheet();
        if (!pushLogRows(sheets()[i], next) && !pushUnit(sheets()[i], next)) return;
      }
    }
  };
  let arrBest = ARRS[0];
  let hBest = Infinity;
  for (const a of ARRS) {
    restore(); pack.dataset.fit = '4'; arrange(a);
    const hh = colsHeight(sheets()[0]);
    if (hh < hBest) { hBest = hh; arrBest = a; }
  }
  return finish('continued', continued, { level: 4, arr: arrBest });
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
