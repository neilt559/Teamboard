'use client';
import { useEffect } from 'react';

// Marks the report set ready (data-ready="1" on .rs-set) once the report's fonts have loaded, so Save as PDF and the
// PDF test harness wait for the final layout. The standard report flows on its own; nothing is measured or scaled.
// Renders nothing.
export default function ReportReady() {
  useEffect(() => {
    let gone = false;
    const done = () => { if (!gone) document.querySelector('.rs-set')?.setAttribute('data-ready', '1'); };
    const fonts = typeof document !== 'undefined' ? document.fonts : null;
    if (!fonts?.ready) { done(); return () => { gone = true; }; }
    Promise.race([fonts.ready, new Promise((r) => setTimeout(r, 4000))]).then(done);
    return () => { gone = true; };
  }, []);
  return null;
}
