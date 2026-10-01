'use client';

// Full-screen confetti for the 5K Club button: paper confetti, spinning gold
// "5K"s and glitter, launched from a point and pulled down by gravity. One
// shared canvas sits over the whole page (so nothing gets clipped); every
// burst just adds pieces, so rapid taps stack. The canvas removes itself when
// the last piece has landed.

const PAPER = ['#ffd23f', '#f5cf45', '#e0a800', '#fff1a8', '#c99a00', '#CBCE00', '#3ad0e0', '#ffffff'];
const FONT = '900 {s}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

let canvas = null;
let ctx = null;
let pieces = [];
let frame = 0;
let last = 0;

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function ensureCanvas() {
  if (canvas) return;
  canvas = document.createElement('canvas');
  canvas.className = 'confetti-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  ctx = canvas.getContext('2d');
  resize();
  window.addEventListener('resize', resize);
}

function teardown() {
  window.removeEventListener('resize', resize);
  if (canvas) canvas.remove();
  canvas = null;
  ctx = null;
}

// Launch velocity: mostly upward, fanned out to the sides.
function launch(minSpeed, maxSpeed, spread = 1.35) {
  const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * spread;
  const speed = rand(minSpeed, maxSpeed);
  return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
}

function drawStar(r) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const rr = i % 2 === 0 ? r : r * 0.32;
    const a = (i * Math.PI) / 4;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

function draw(p) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.fade));
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  if (p.kind === 'text') {
    const s = p.size;
    ctx.font = FONT.replace('{s}', Math.round(s));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.scale(1, 0.75 + 0.25 * Math.cos(p.tilt)); // a little 3D wobble
    const g = ctx.createLinearGradient(0, -s / 2, 0, s / 2);
    g.addColorStop(0, '#fff6c2');
    g.addColorStop(0.45, '#f5cf45');
    g.addColorStop(1, '#b88400');
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, s / 7);
    ctx.strokeStyle = '#6b4a00';
    ctx.strokeText('5K', 0, 0);
    ctx.fillStyle = g;
    ctx.fillText('5K', 0, 0);
  } else if (p.kind === 'spark') {
    ctx.fillStyle = p.color;
    drawStar(p.size);
  } else {
    ctx.scale(1, Math.cos(p.tilt)); // paper flipping as it falls
    ctx.fillStyle = p.color;
    if (p.kind === 'dot') {
      ctx.beginPath();
      ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    }
  }
  ctx.restore();
}

function tick(t) {
  const dt = Math.min(0.034, last ? (t - last) / 1000 : 0.016);
  last = t;
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  const floor = window.innerHeight + 80;
  pieces = pieces.filter((p) => p.life > 0 && p.y < floor);
  for (const p of pieces) {
    const k = 1 - p.drag * dt;
    p.vx = p.vx * k + Math.sin(p.tilt) * p.sway * dt; // gentle side-to-side drift
    p.vy = p.vy * k + p.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    p.tilt += p.vt * dt;
    p.life -= dt;
    draw(p);
  }
  if (pieces.length) {
    frame = requestAnimationFrame(tick);
  } else {
    frame = 0;
    last = 0;
    teardown();
  }
}

export function burstConfetti(x, y) {
  if (typeof window === 'undefined') return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  ensureCanvas();
  // Fresh start values for each piece, so they don't all spin/flip in sync.
  const start = () => ({ x, y, rot: rand(0, Math.PI * 2), tilt: rand(0, Math.PI * 2) });

  // Paper confetti: strips, squares and a few dots.
  for (let i = 0; i < 220; i++) {
    const kind = Math.random() < 0.15 ? 'dot' : 'paper';
    const w = rand(8, 13);
    pieces.push({
      ...start(), ...launch(520, 1250), kind, color: pick(PAPER),
      w, h: kind === 'dot' ? w : rand(4, 7),
      g: rand(950, 1350), drag: rand(1.0, 1.9), sway: rand(30, 90),
      vr: rand(-12, 12), vt: rand(6, 14), life: rand(2.2, 3.4), fade: 0.6,
      x: x + rand(-14, 14), y: y + rand(-8, 8),
    });
  }
  // Big spinning gold "5K"s.
  for (let i = 0; i < 26; i++) {
    pieces.push({
      ...start(), rot: rand(-0.6, 0.6), ...launch(420, 1000, 1.25), kind: 'text', size: rand(18, 40),
      g: rand(650, 950), drag: rand(0.8, 1.4), sway: rand(10, 40),
      vr: rand(-2.4, 2.4), vt: rand(2, 5), life: rand(2.6, 3.6), fade: 0.7, // tumble, don't flip upside-down
      x: x + rand(-10, 10),
    });
  }
  // Glitter: quick, bright, barely affected by gravity.
  for (let i = 0; i < 34; i++) {
    pieces.push({
      ...start(), ...launch(300, 1300, 2), kind: 'spark', color: Math.random() < 0.6 ? '#ffffff' : '#fff1a8',
      size: rand(3, 6.5), g: 250, drag: rand(2.5, 4), sway: 0,
      vr: rand(-8, 8), vt: 0, life: rand(0.5, 1.1), fade: 0.4,
    });
  }
  if (!frame) frame = requestAnimationFrame(tick);
}
