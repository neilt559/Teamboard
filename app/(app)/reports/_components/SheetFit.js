'use client';
import { useEffect } from 'react';
import { fitAll } from './sheet-fit';

// Fits every owner report sheet on the page (design-amendments A11; the algorithm is in sheet-fit.js) once the
// report faces have loaded, so the measurements match what prints. Renders nothing. When it is done the
// .rs-set gets data-ready="1" (the PDF harness waits for it). If the faces arrive later (a slow network), it fits
// again. Without JavaScript the server-drawn sheet shows as it is.
const FACES = ['400 10pt Barlow', '500 10pt Barlow', '600 10pt Barlow', '700 10pt Barlow',
  '500 10pt "Barlow Condensed"', '600 10pt "Barlow Condensed"', '700 10pt "Barlow Condensed"'];

export default function SheetFit() {
  useEffect(() => {
    let gone = false;
    const set = document.querySelector('.rs-set');
    const run = () => {
      if (gone) return;
      const res = fitAll(document);
      if (set) {
        set.setAttribute('data-ready', '1');
        set.setAttribute('data-fit-result', JSON.stringify(res.map((r) => ({ id: r.id, mode: r.mode, sheets: r.sheets, level: r.level, ok: r.ok, error: r.error }))));
      }
    };
    const fonts = typeof document !== 'undefined' ? document.fonts : null;
    if (!fonts?.load) { run(); return () => { gone = true; }; }
    const timeout = new Promise((r) => setTimeout(r, 4000));
    Promise.race([Promise.all(FACES.map((f) => fonts.load(f).catch(() => null))).then(() => fonts.ready), timeout]).then(run);
    const again = () => { if (set?.getAttribute('data-ready')) run(); };
    fonts.addEventListener?.('loadingdone', again);
    return () => { gone = true; fonts.removeEventListener?.('loadingdone', again); };
  }, []);
  return null;
}
