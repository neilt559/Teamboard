'use client';
import { useState, useEffect, useRef } from 'react';
import { IconZoomIn, IconZoomOut, IconRotate, IconRestore } from './icons';

// Headshot cropper: the photo sits behind a circular frame (the same shape the
// headshot is shown in). Drag to position it; zoom with the slider, +/- buttons,
// mouse wheel or a pinch; rotate in 90° steps. Saves a small square JPEG for
// display plus a larger copy of the photo so it can be re-cropped later.

const OUT = 200;       // saved headshot size (px, square)
const SRC_MAX = 1200;  // longest side of the copy kept for re-cropping
const MAX_ZOOM = 8;    // × the smallest zoom that still fills the circle

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Couldn’t read that image — try a JPG or PNG.'));
    i.src = src;
  });
}

// Draw an image into a canvas, shrunk to fit maxSide and optionally rotated.
function toCanvas(img, maxSide, rotate = 0) {
  const w0 = img.naturalWidth || img.width;
  const h0 = img.naturalHeight || img.height;
  const k = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.round(w0 * k);
  const h = Math.round(h0 * k);
  const turned = rotate % 180 !== 0;
  const c = document.createElement('canvas');
  c.width = turned ? h : w;
  c.height = turned ? w : h;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; // JPEG has no transparency
  g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingQuality = 'high';
  g.translate(c.width / 2, c.height / 2);
  g.rotate((rotate * Math.PI) / 180);
  g.drawImage(img, -w / 2, -h / 2, w, h);
  return c;
}

// Read a picked file into a downscaled JPEG data URL we can crop (and keep).
export async function fileToSource(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    return toCanvas(img, SRC_MAX).toDataURL('image/jpeg', 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function PhotoCropper({ title, src, initialCrop, fresh, onCancel, onSave }) {
  const [V] = useState(() => (typeof window === 'undefined' ? 280 : Math.max(200, Math.min(280, window.innerWidth - 90))));
  const [cur, setCur] = useState(src);        // current photo (changes when rotated)
  const [rotated, setRotated] = useState(false);
  const [img, setImg] = useState(null);
  const [view, setView] = useState(null);     // { s: scale, cx, cy: image-center offset from the circle's center }
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const stageRef = useRef(null);
  const pts = useRef(new Map());
  const small = useRef(null);
  const big = useRef(null);

  useEffect(() => {
    let live = true;
    setImg(null);
    setView(null);
    loadImage(cur).then((i) => { if (live) setImg(i); }).catch((e) => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, [cur]);

  const W = img ? img.naturalWidth : 1;
  const H = img ? img.naturalHeight : 1;
  const minS = V / Math.min(W, H);
  const maxS = minS * MAX_ZOOM;

  // Keep the photo covering the whole circle — no empty edges.
  const clamp = (v) => {
    const s = Math.min(maxS, Math.max(minS, v.s));
    const mx = Math.max(0, (W * s - V) / 2);
    const my = Math.max(0, (H * s - V) / 2);
    return { s, cx: Math.min(mx, Math.max(-mx, v.cx)), cy: Math.min(my, Math.max(-my, v.cy)) };
  };
  // Zoom to scale s2 while keeping the point (px, py) — relative to the
  // circle's center — fixed under the cursor/fingers.
  const zoomTo = (v, s2, px = 0, py = 0) => {
    const next = Math.min(maxS, Math.max(minS, s2));
    const k = next / v.s;
    return clamp({ s: next, cx: px - (px - v.cx) * k, cy: py - (py - v.cy) * k });
  };
  // Fill the circle, nudged toward the top of tall photos (where faces are).
  const defaultView = () => clamp({ s: minS, cx: 0, cy: Math.max(0, (H * minS - V) / 2) * 0.5 });

  // Start from the saved crop when adjusting an existing photo.
  useEffect(() => {
    if (!img) return;
    const c = initialCrop;
    if (c && !rotated && c.w > 0) {
      const s = V / (c.w * W);
      setView(clamp({ s, cx: (W * s) / 2 - V / 2 - c.x * W * s, cy: (H * s) / 2 - V / 2 - c.y * H * s }));
    } else {
      setView(defaultView());
    }
  }, [img]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mouse-wheel zoom (a native listener so it can stop the page scrolling).
  useEffect(() => {
    const el = stageRef.current;
    if (!el || !img) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left - V / 2;
      const py = e.clientY - r.top - V / 2;
      setView((v) => (v ? zoomTo(v, v.s * Math.exp(-e.deltaY * 0.0015), px, py) : v));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [img, V]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drag with one pointer; pinch-zoom (and pan) with two.
  const onDown = (e) => {
    if (!view) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {} // keeps the drag going outside the frame
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onMove = (e) => {
    const map = pts.current;
    const prev = map.get(e.pointerId);
    if (!prev || !view) return;
    const before = [...map.values()].map((p) => ({ ...p }));
    map.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (map.size === 1) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      setView((v) => clamp({ ...v, cx: v.cx + dx, cy: v.cy + dy }));
    } else if (map.size === 2) {
      const [a0, b0] = before;
      const [a1, b1] = [...map.values()];
      const d0 = Math.hypot(a0.x - b0.x, a0.y - b0.y) || 1;
      const d1 = Math.hypot(a1.x - b1.x, a1.y - b1.y) || 1;
      const r = stageRef.current.getBoundingClientRect();
      const m0 = { x: (a0.x + b0.x) / 2 - r.left - V / 2, y: (a0.y + b0.y) / 2 - r.top - V / 2 };
      const m1 = { x: (a1.x + b1.x) / 2 - r.left - V / 2, y: (a1.y + b1.y) / 2 - r.top - V / 2 };
      setView((v) => {
        const z = zoomTo(v, v.s * (d1 / d0), m1.x, m1.y);
        return clamp({ ...z, cx: z.cx + (m1.x - m0.x), cy: z.cy + (m1.y - m0.y) });
      });
    }
  };
  const onUp = (e) => { pts.current.delete(e.pointerId); };
  const onKey = (e) => {
    if (!view) return;
    const step = 12;
    const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[e.key]) {
      e.preventDefault();
      const [dx, dy] = moves[e.key];
      setView((v) => clamp({ ...v, cx: v.cx + dx, cy: v.cy + dy }));
    } else if (e.key === '+' || e.key === '=') { e.preventDefault(); setView((v) => zoomTo(v, v.s * 1.15)); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); setView((v) => zoomTo(v, v.s / 1.15)); }
  };

  // Slider runs on a log scale so each notch feels like the same amount of zoom.
  const t = view ? Math.log(view.s / minS) / Math.log(MAX_ZOOM) : 0;
  const setT = (nt) => setView((v) => zoomTo(v, minS * Math.pow(MAX_ZOOM, nt)));

  // The square of the original photo that sits inside the circle.
  const crop = view && img ? { sx: (W * view.s / 2 - V / 2 - view.cx) / view.s, sy: (H * view.s / 2 - V / 2 - view.cy) / view.s, size: V / view.s } : null;

  // Live previews at the sizes people will actually see.
  useEffect(() => {
    if (!crop) return;
    [small.current, big.current].forEach((c) => {
      if (!c) return;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.clearRect(0, 0, c.width, c.height);
      g.drawImage(img, crop.sx, crop.sy, crop.size, crop.size, 0, 0, c.width, c.height);
    });
  });

  const rotate = () => {
    if (!img) return;
    setRotated(true);
    setCur(toCanvas(img, SRC_MAX, 90).toDataURL('image/jpeg', 0.9));
  };

  const save = async () => {
    if (!crop) return;
    setSaving(true);
    setErr('');
    const c = document.createElement('canvas');
    c.width = OUT;
    c.height = OUT;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, OUT, OUT);
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, crop.sx, crop.sy, crop.size, crop.size, 0, 0, OUT, OUT);
    const payload = {
      image: c.toDataURL('image/jpeg', 0.9),
      crop: { x: crop.sx / W, y: crop.sy / H, w: crop.size / W },
    };
    // Only send the (larger) photo itself when it's new or was rotated.
    if (fresh || rotated) payload.source = cur;
    try { await onSave(payload); }
    catch (e) { setErr(e.message || 'Couldn’t save the photo'); setSaving(false); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal crop-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <div
          ref={stageRef}
          className={`crop-stage${view ? '' : ' loading'}`}
          style={{ width: V, height: V }}
          tabIndex={0}
          aria-label="Photo position. Drag or use the arrow keys to move it, plus and minus to zoom."
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onKeyDown={onKey}
        >
          {img && view && (
            <img
              src={cur}
              alt=""
              draggable={false}
              className="crop-img"
              style={{
                width: W * view.s,
                height: H * view.s,
                transform: `translate3d(${V / 2 + view.cx - (W * view.s) / 2}px, ${V / 2 + view.cy - (H * view.s) / 2}px, 0)`,
              }}
            />
          )}
          {!view && !err && <span className="crop-loading">Loading…</span>}
          <div className="crop-mask" aria-hidden="true" />
        </div>

        <div className="crop-zoom">
          <button type="button" className="crop-icon-btn" title="Zoom out" onClick={() => setView((v) => v && zoomTo(v, v.s / 1.2))} disabled={!view}><IconZoomOut size={18} /></button>
          <input type="range" min="0" max="1" step="0.001" value={t} onChange={(e) => setT(Number(e.target.value))} disabled={!view} aria-label="Zoom" />
          <button type="button" className="crop-icon-btn" title="Zoom in" onClick={() => setView((v) => v && zoomTo(v, v.s * 1.2))} disabled={!view}><IconZoomIn size={18} /></button>
        </div>

        <div className="crop-row">
          <div className="crop-tools">
            <button type="button" className="btn btn-plain btn-sm wi" onClick={rotate} disabled={!img}><IconRotate size={14} /> Rotate</button>
            <button type="button" className="btn btn-plain btn-sm wi" onClick={() => setView(defaultView())} disabled={!view}><IconRestore size={14} /> Reset</button>
          </div>
          <div className="crop-previews" title="How it will look">
            <canvas ref={big} width="96" height="96" className="crop-prev lg" />
            <canvas ref={small} width="48" height="48" className="crop-prev sm" />
          </div>
        </div>
        <p className="crop-hint">Drag to move · scroll, pinch or use the slider to zoom</p>
        {err && <div className="bk-err">{err}</div>}

        <div className="modal-actions">
          <button className="btn btn-plain" onClick={onCancel} disabled={saving}>Cancel</button>
          <button className="btn btn-ink" onClick={save} disabled={!crop || saving}>{saving ? 'Saving…' : 'Save photo'}</button>
        </div>
      </div>
    </div>
  );
}
