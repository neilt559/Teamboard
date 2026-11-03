// Office bingo rules (Neil, 2026-10-19): a monthly challenge where offices compete on one shared 5x5 card. Each
// playing office marks ONE square a day (Central), on the honor system, for what its GeoGuessr round earned. The
// first office to complete a row, column or diagonal wins "First bingo"; the first to mark all four corners wins
// "Four corners". Isomorphic and import-free: the API, the loaders and the client all use it.
// Neil, 2026-10-28: a third prize, "First C-A-G-E-O": the first office with a square under every letter (one in each
// column). It goes by the day played, not the moment marked, so offices that get there the same day tie.
// Neil, 2026-11-02: weekdays only (no squares on Saturday or Sunday). Every prize goes by the day played, so offices
// that win one on the same day both get it. At the end of the month the office with the most prizes is the champion;
// equal prizes go to the office with more squares marked (still equal = co-champions).
// Neil, 2026-11-03: two more prizes. Plus: the center square and the 4 touching its sides. Box: the 8 squares
// around the center (not the center itself).
// Neil, 2026-11-03 (later): no more "first to": every office can complete every pattern. Whoever completes the most
// of the 5 patterns by the end of the month wins; equal = more squares marked (still equal = co-champions).
//
// A pick: { id, square (0..24), play_date 'YYYY-MM-DD', created_at ISO }. Winners are worked out from the picks
// that stand (not undone), so undoing a pick can never leave a stale winner behind.

export const SIZE = 5;
export const CELLS = SIZE * SIZE;
export const SQUARE_MAX = 120;            // characters per square
export const CORNERS = [0, SIZE - 1, CELLS - SIZE, CELLS - 1];
export const PLUS = [7, 11, 12, 13, 17];
export const BOX = [6, 7, 8, 11, 13, 16, 17, 18];
export const PRIZES = ['bingo', 'corners', 'letters', 'plus', 'box'];
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
  '- Each weekday, your office can mark 1 square on the CAGEO board. There’s no playing on weekends.',
  '%h 5 patterns to complete',
  '- CAGEO: 5 squares in a row, like bingo (across, down or diagonal).',
  '- Four Corners: all 4 corner squares.',
  '- C-A-G-E-O: a square under every letter. The squares don’t need to be in a row.',
  '- Plus: the center square and the 4 squares touching its sides.',
  '- Box: all 8 squares around the center.',
  '- Every office can complete every pattern. Getting one first doesn’t stop anyone else.',
  '%h Champion',
  '- At the end of the month, the office that completed the most patterns wins. If two offices completed the same number, the office with more squares marked wins.',
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
// made a bingo / completed the corners / put a square under every letter / the plus / the box (null while not yet).
//   -> { marked: Set<number>, lines: [line keys], bingo: { pick, line } | null, corners, letters, plus, box: { pick } | null }
export function officeProgress(picks) {
  const marked = new Set();
  const cols = new Set();
  let bingo = null;
  let corners = null;
  let letters = null;
  let plus = null;
  let box = null;
  for (const p of [...picks].sort(byPickOrder)) {
    marked.add(Number(p.square));
    cols.add(Number(p.square) % SIZE);
    if (!letters && cols.size === SIZE) letters = { pick: p };
    if (!bingo) {
      const line = LINES.find((l) => l.cells.includes(Number(p.square)) && l.cells.every((i) => marked.has(i)));
      if (line) bingo = { pick: p, line: line.key };
    }
    if (!corners && CORNERS.every((i) => marked.has(i))) corners = { pick: p };
    if (!plus && PLUS.every((i) => marked.has(i))) plus = { pick: p };
    if (!box && BOX.every((i) => marked.has(i))) box = { pick: p };
  }
  const lines = LINES.filter((l) => l.cells.every((i) => marked.has(i))).map((l) => l.key);
  return { marked, lines, bingo, corners, letters, plus, box };
}

// The patterns across offices: each one lists every office that has completed it, earliest day first (then the order
// given). Nobody yet = null.
//   offices: [{ id, name, picks }] -> { bingo, corners, letters, plus, box }, each null or
//     { office_ids: [..], office_name: 'Charlotte and Asheville', offices: [{ id, name, play_date }] }
export function winners(offices) {
  const progress = offices.map((o, i) => ({ o, i, prog: officeProgress(o.picks || []) }));
  const prize = (kind) => {
    const got = progress.filter((x) => x.prog[kind]).map((x) => ({ ...x, day: x.prog[kind].pick.play_date }))
      .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.i - b.i));
    if (!got.length) return null;
    return {
      office_ids: got.map((x) => String(x.o.id)), office_name: joinNames(got.map((x) => x.o.name)),
      offices: got.map((x) => ({ id: String(x.o.id), name: x.o.name, play_date: x.day })),
    };
  };
  return Object.fromEntries(PRIZES.map((k) => [k, prize(k)]));
}

// The champion race: every office with the patterns it completed and squares marked, most patterns first, then most squares, then the order given. The champion is null until the month is over (final), then
// every office level with the leader on both.
//   -> { standings: [{ id, name, wins, marks }], champion: { office_ids, office_name, wins, marks, tie } | null }
export function championRace(offices, w, final = false) {
  const standings = offices.map((o, i) => ({
    id: String(o.id), name: o.name, i, marks: officeProgress(o.picks || []).marked.size,
    wins: PRIZES.filter((k) => w[k]?.office_ids.includes(String(o.id))).length,
  })).sort((a, b) => b.wins - a.wins || b.marks - a.marks || a.i - b.i).map(({ i, ...x }) => x);   // eslint-disable-line no-unused-vars
  const top = standings[0];
  const champs = final && top ? standings.filter((x) => x.wins === top.wins && x.marks === top.marks) : [];
  return {
    standings,
    champion: champs.length ? { office_ids: champs.map((x) => x.id), office_name: joinNames(champs.map((x) => x.name)),
      wins: top.wins, marks: top.marks, tie: champs.length > 1 } : null,
  };
}

// Weekdays only: 'YYYY-MM-DD' -> true on Saturday or Sunday; nextPlayDay -> the next weekday after it.
export const isWeekend = (ymd) => [0, 6].includes(new Date(`${ymd}T12:00:00Z`).getUTCDay());
export function nextPlayDay(ymd) {
  const d = new Date(`${ymd}T12:00:00Z`);
  do d.setUTCDate(d.getUTCDate() + 1); while ([0, 6].includes(d.getUTCDay()));
  return d.toISOString().slice(0, 10);
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
  if (today < c.starts_on || today > c.ends_on || isWeekend(today)) return false;
  if (!(playing || []).map(String).includes(String(officeId))) return false;
  return isAdmin(v) || inOffice(v, officeId);
}
// Undo a pick: the office's people for today's pick only; admins any pick.
export function canUndo(v, c, pick, today) {
  if (!v || !c || !pick) return false;
  if (isAdmin(v)) return true;
  return !c.archived && pick.play_date === today && inOffice(v, pick.office_id);
}
