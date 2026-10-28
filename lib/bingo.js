// Office bingo rules (Neil, 2026-10-19): a monthly challenge where offices compete on one shared 5x5 card. Each
// playing office marks ONE square a day (Central), on the honor system, for what its GeoGuessr round earned. The
// first office to complete a row, column or diagonal wins "First bingo"; the first to mark all four corners wins
// "Four corners". Isomorphic and import-free: the API, the loaders and the client all use it.
// Neil, 2026-10-28: a third prize, "First C-A-G-E-O": the first office with a square under every letter (one in each
// column). It goes by the day played, not the moment marked, so offices that get there the same day tie.
//
// A pick: { id, square (0..24), play_date 'YYYY-MM-DD', created_at ISO }. Winners are worked out from the picks
// that stand (not undone), so undoing a pick can never leave a stale winner behind.

export const SIZE = 5;
export const CELLS = SIZE * SIZE;
export const SQUARE_MAX = 120;            // characters per square
export const CORNERS = [0, SIZE - 1, CELLS - SIZE, CELLS - 1];
export const LETTERS = ['C', 'A', 'G', 'E', 'O'];   // the column heads; CAGEO is Neil's name for office bingo

// The GeoGuessr card Neil wrote for October 2026, in his order (the setup form shuffles it).
export const DEFAULT_SQUARES = [
  'Get a 5K with under 25 steps',
  'Complete a game in 100 steps or fewer',
  'Complete a game in 50 steps or fewer',
  'Get no more than 50 miles from a pin in the entire round',
  'Get all five guesses within 100 total miles',
  'Get within 1 mile of the correct location',
  'Get within 10 yards of the correct location',
  'Get a personal best',
  'Finish a round with no score under 4,500',
  'Finish a round with no score under 4,000',
  'Get all 5 countries correct',
  'Beat the other office',
  'Score in the 20,000s',
  'Score in the 21,000s',
  'Score in the 22,000s',
  'Score in the 23,000s',
  'Score in the 24,000s',
  'Have a gold-average week',
  'Have a silver-average week',
  'Get a gold medal',
  'Get a silver medal',
  'Get a bronze medal',
  'Score 3+ 5Ks in one round',
  'Score 2 5Ks in one round',
  'Score a 5K',
];

export const DEFAULT_RULES = [
  '%h How it works',
  '- After your office’s GeoGuessr round, mark ONE square your round earned.',
  '- One square per office per day. Honor system.',
  '- First office to get five in a row (across, down or diagonal) wins First CAGEO.',
  '- First office to mark all four corners wins Four corners.',
  '- First office to mark a square under every letter (C, A, G, E and O) wins First C-A-G-E-O. Offices that get there on the same day tie.',
].join('\n');

// The 12 lines: 5 rows, 5 columns, 2 diagonals, each a list of square indexes.
export const LINES = (() => {
  const out = [];
  for (let r = 0; r < SIZE; r++) out.push({ key: `r${r}`, label: `Row ${r + 1}`, cells: [...Array(SIZE)].map((_, i) => r * SIZE + i) });
  for (let c = 0; c < SIZE; c++) out.push({ key: `c${c}`, label: `Column ${c + 1}`, cells: [...Array(SIZE)].map((_, i) => i * SIZE + c) });
  out.push({ key: 'd0', label: 'Diagonal', cells: [...Array(SIZE)].map((_, i) => i * SIZE + i) });
  out.push({ key: 'd1', label: 'Diagonal', cells: [...Array(SIZE)].map((_, i) => i * SIZE + (SIZE - 1 - i)) });
  return out;
})();

// Squares as sent by the form or the API: exactly 25 non-blank strings, each trimmed, single-line, at most 120
// characters. Returns the clean array, or null when it isn't valid (the caller answers 400).
export function cleanSquares(raw) {
  if (!Array.isArray(raw) || raw.length !== CELLS) return null;
  const out = raw.map((s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : ''));
  if (out.some((s) => !s || s.length > SQUARE_MAX || s.includes('\u0000'))) return null;
  return out;
}

// Stored squares (JSON text) -> array of 25 strings; a damaged value falls back to numbered squares.
export function readSquares(text) {
  try {
    const a = JSON.parse(text || '[]');
    if (Array.isArray(a) && a.length === CELLS) return a.map((s) => String(s ?? ''));
  } catch { /* fall through */ }
  return [...Array(CELLS)].map((_, i) => `Square ${i + 1}`);
}

// A fresh order for the card (Fisher-Yates). rand defaults to Math.random.
export function shuffle(list, rand = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Pick order: the day played, then when it was marked, then id.
const pickKey = (p) => `${p.play_date}|${p.created_at || ''}|${String(p.id).padStart(20, '0')}`;
export const byPickOrder = (a, b) => (pickKey(a) < pickKey(b) ? -1 : pickKey(a) > pickKey(b) ? 1 : 0);

// One office's card from its standing picks: which squares are marked, the completed lines, and the pick that first
// made a bingo / completed the corners / put a square under every letter (null while not yet).
//   -> { marked: Set<number>, lines: [line keys], bingo: { pick, line } | null, corners: { pick } | null, letters: { pick } | null }
export function officeProgress(picks) {
  const marked = new Set();
  const cols = new Set();
  let bingo = null;
  let corners = null;
  let letters = null;
  for (const p of [...picks].sort(byPickOrder)) {
    marked.add(Number(p.square));
    cols.add(Number(p.square) % SIZE);
    if (!letters && cols.size === SIZE) letters = { pick: p };
    if (!bingo) {
      const line = LINES.find((l) => l.cells.includes(Number(p.square)) && l.cells.every((i) => marked.has(i)));
      if (line) bingo = { pick: p, line: line.key };
    }
    if (!corners && CORNERS.every((i) => marked.has(i))) corners = { pick: p };
  }
  const lines = LINES.filter((l) => l.cells.every((i) => marked.has(i))).map((l) => l.key);
  return { marked, lines, bingo, corners, letters };
}

// The prizes across offices. First bingo and Four corners: the earliest qualifying pick wins (day played first, then
// the time it was marked). First C-A-G-E-O: every office that got there on the earliest day, in the order given.
//   offices: [{ id, name, picks }] -> { bingo: { office_id, office_name, play_date, line } | null, corners: { ... } | null,
//     letters: { office_ids: [..], office_name: 'Charlotte and Asheville', play_date, tie } | null }
export function winners(offices) {
  const best = (kind) => {
    let win = null;
    for (const o of offices) {
      const got = officeProgress(o.picks || [])[kind];
      if (got && (!win || byPickOrder(got.pick, win.pick) < 0)) win = { ...got, office: o };
    }
    return win ? {
      office_id: String(win.office.id), office_name: win.office.name, play_date: win.pick.play_date,
      at: win.pick.created_at || null, ...(win.line ? { line: win.line } : {}),
    } : null;
  };
  const got = offices.map((o) => ({ o, day: officeProgress(o.picks || []).letters?.pick.play_date })).filter((x) => x.day);
  const day = got.reduce((d, x) => (!d || x.day < d ? x.day : d), null);
  const tied = got.filter((x) => x.day === day).map((x) => x.o);
  const letters = day ? {
    office_ids: tied.map((o) => String(o.id)), office_name: joinNames(tied.map((o) => o.name)), play_date: day, tie: tied.length > 1,
  } : null;
  return { bingo: best('bingo'), corners: best('corners'), letters };
}

// 'A', 'A and B', 'A, B and C'
export const joinNames = (names) => (names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

export const lineLabel = (key) => LINES.find((l) => l.key === key)?.label || '';

// Who may mark a square for an office today: the office's own people (home or extra office) while the challenge
// runs; admins for any playing office (to fix a missed or wrong pick). Neil, 2026-10-19: "everyone but admins can
// only touch their office's stats", so culture organizers set the game up but don't mark other offices' cards.
export const isAdmin = (v) => !!v?.is_admin;
export const inOffice = (v, officeId) => (v?.office_ids || []).map(String).includes(String(officeId));
export function canMark(v, c, officeId, playing, today) {
  if (!v || !c || c.kind !== 'bingo' || c.archived) return false;
  if (today < c.starts_on || today > c.ends_on) return false;
  if (!(playing || []).map(String).includes(String(officeId))) return false;
  return isAdmin(v) || inOffice(v, officeId);
}
// Undo a pick: the office's people for today's pick only; admins any pick.
export function canUndo(v, c, pick, today) {
  if (!v || !c || !pick) return false;
  if (isAdmin(v)) return true;
  return !c.archived && pick.play_date === today && inOffice(v, pick.office_id);
}
