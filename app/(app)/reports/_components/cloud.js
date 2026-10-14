// The redline revision cloud around a late attention item (design-amendments A11: Neil keeps the brick clouds; drawn
// as SVG on the server, around late items only). A plain module with no imports: the server sheet draws it for an
// estimated box, and the fit pass (sheet-fit.js) redraws the same path for the measured box so the arcs stay round.
// Arcs bulge outward around the box, the way REVCLOUD marks a drawing.

export const CLOUD_PAD_X = 7;   // room between the words and the cloud (px)
export const CLOUD_PAD_Y = 4;
export const CLOUD_STROKE = '#9A3B1F';

export function cloudPath(W, H, step = 13) {
  const w = Math.max(20, Number(W) || 0);
  const h = Math.max(14, Number(H) || 0);
  const pts = [];
  const nx = Math.max(2, Math.round(w / step));
  const ny = Math.max(2, Math.round(h / step));
  for (let i = 0; i < nx; i++) pts.push([w * i / nx, 0]);
  for (let i = 0; i < ny; i++) pts.push([w, h * i / ny]);
  for (let i = 0; i < nx; i++) pts.push([w - w * i / nx, h]);
  for (let i = 0; i < ny; i++) pts.push([0, h - h * i / ny]);
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i <= pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i % pts.length];
    const r = Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.6;
    d += `A${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
  }
  return `${d}Z`;
}

// The server's estimate of a late item's box on the printed sheet (the right column at full size): about 41
// characters of the item per line and 46 of the "from · need by · N days late" line.
export function cloudBox(item, who) {
  const lines = (s, per) => Math.max(1, Math.ceil(String(s || '').length / per));
  const W = 300 + CLOUD_PAD_X * 2;
  const H = Math.round(lines(item, 41) * 17.3 + 1.3 + lines(who, 46) * 16.6 + CLOUD_PAD_Y * 2);
  return { W, H };
}
