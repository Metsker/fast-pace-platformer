// Emerald Hill, roughly. 704 x 96 tiles - 35 screens across, 6.9 down.
//
// Composed in 16-column chunks, the same unit Sonic 2 uses, but painted into one board
// with a surface array rather than stamped into a fixed grid of 16x16 cells. The grid
// did not survive contact with the speed budget: reaching the 480 px/s rolling cap from
// a standing run takes 473px of 26.6 degree surface, which is 53 tiles across and **32
// rows down** - twice a band's height. Every full-speed descent would cross two band
// seams, and each seam is an off-by-one that reads as an 8px wall.
//
// So the act is a walk left to right tracking the ground row, and the seams are correct
// by construction. What the chunk grid was for - authoring 35 screens without typing
// 60,000 characters - the painters below do instead.
//
//   descent length   speed at the bottom
//   1 chunk          304 px/s      <- what the old act had, and what it measured
//   2 chunks         390 px/s
//   3 chunks         461 px/s
//   4 chunks         480 px/s      <- the rolling cap
//
// The act therefore runs its descents 4 and 5 chunks long, so the cap is not merely
// touched at the bottom but held for the last stretch of each one.

const CH = 16; // columns per chunk, the unit the act is composed in
const W = 44 * CH;
const H = 96;
const CRUST = 10; // rows of rock under the surface. Deeper is invisible and not free.

const g = Array.from({ length: H }, () => new Array<string>(W).fill(" "));
const surface: number[] = [];

let col = 0;
let row = 14;

const put = (x: number, y: number, ch: string) => {
  if (y >= 0 && y < H && x >= 0 && x < W) g[y][x] = ch;
};

// Ground records the column's surface row as well as drawing it, so the crust pass can
// fill under every column without knowing which painter put it there.
const ground = (x: number, y: number, ch: string) => {
  put(x, y, ch);
  surface[x] = y;
};

const flatCols = (n: number) => {
  for (let k = 0; k < n; k++) ground(col++, row, "#");
};
const flat = (chunks: number) => flatCols(chunks * CH);
const gap = (n: number) => (col += n);

// 26.6 degrees, the only grade you stay planted on at speed. A pair carries the surface
// from row*8 to (row+1)*8, so a descent from surface row S ends at S + 8 per chunk.
const down = (chunks: number) => {
  for (let k = 0; k < chunks * CH; k += 2) {
    ground(col++, row, "d");
    ground(col++, row, "D");
    row++;
  }
};

// And a climb has to start one row above where a matching descent ended: `c` carries its
// left edge at (r+1)*8, not r*8. This is the off-by-one that reads as a wall.
const up = (chunks: number) => {
  let r = row - 1;
  for (let k = 0; k < chunks * CH; k += 2) {
    ground(col++, r, "c");
    ground(col++, r, "C");
    r--;
  }
  row = r + 1;
};

// A 45 degree kicker, then open air. Leaving the lip sets vy = -gsp * sin(45), so how
// high you get is exactly how fast you arrived. `row` is left alone: whatever follows
// the gap resumes at the level the ramp started from, which is what makes a failed
// launch a demotion rather than a death.
const ramp = (cols: number, over: number) => {
  let r = row - 1;
  for (let k = 0; k < cols; k++) ground(col++, r--, "u");
  const lip = { row: r + 1, col };
  gap(over);
  return lip;
};

const rings = (x: number, y: number, n: number, step = 2) => {
  for (let k = 0; k < n; k++) put(x + k * step, y, "o");
};

// A one-way platform: passable from below, so a launch that overshoots still lands on it.
const shelf = (x: number, len: number, y: number) => {
  for (let k = 0; k < len; k++) {
    put(x + k, y, "=");
    put(x + k, y + 1, "=");
  }
};

const spikes = (x: number, n: number, y: number) => {
  for (let k = 0; k < n; k++) put(x + k, y, "^");
};

// The shelf sits 3 rows over the lip: 24px of rise across the 7 tiles to its start,
// which 180 px/s cannot buy and 240 can - so it is bought on the descent before it.
const GATE = 3;
const REACH = 7;

// --- act 1 ------------------------------------------------------------------

flat(3);
put(3, row - 1, "@");
rings(10, row - 1, 6);

down(5); // 14 -> 54, and the cap is reached about four fifths of the way down
flat(1);
rings(col - 26, row - 1, 8);
up(3); // 54 -> 30

const lip1 = ramp(5, 3);
const shelfTop1 = lip1.row - GATE;
flat(4);
spikes(lip1.col + 30, 5, row - 1); // the hazard the upper route buys you past
shelf(lip1.col + REACH, 46, shelfTop1);
rings(lip1.col + REACH + 6, shelfTop1 - 1, 8);
put(lip1.col + REACH + 40, shelfTop1 - 1, "P");
put(lip1.col + 12, row - 1, "P"); // and a star post on the low road too

down(5); // 30 -> 70
flat(1);
rings(col - 24, row - 1, 6);
up(3); // 70 -> 46

const lip2 = ramp(5, 3);
const shelfTop2 = lip2.row - GATE;
flatCols(28);
gap(10); // the pit the second shelf buys you past
flatCols(26);
shelf(lip2.col + REACH, 44, shelfTop2);
rings(lip2.col + REACH + 6, shelfTop2 - 1, 8);
put(lip2.col + REACH + 38, shelfTop2 - 1, "P");

down(4); // 46 -> 78
flat(2);
rings(col - 28, row - 1, 6);
put(col - 6, row - 1, "G");
flatCols(CH);

// --- crust ------------------------------------------------------------------
// Each column fills to its neighbours' depth as well as its own, which is what makes a
// ramp lip and a pit edge read as a face rather than a floating lip.
for (let x = 0; x < W; x++) {
  const s = surface[x];
  if (s === undefined) continue;
  const deep = Math.max(s, surface[x - 1] ?? s, surface[x + 1] ?? s);
  for (let y = s + 1; y <= Math.min(H - 1, deep + CRUST); y++) put(x, y, "#");
}

const end = surface.length + 2;
export const ACT_1 = g.map((r) => r.slice(0, end).join(""));
