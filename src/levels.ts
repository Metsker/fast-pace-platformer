// The mountain. Built by walking a descent profile left to right, tracking the ground
// row as it drops. '#' solid, '=' one-way, slope chars per sim.ts SLOPE_CHARS.
//
// The profile is the level. Everything else here is bookkeeping.

type Seg =
  | ["flat", number] // n columns, no drop
  | ["d26", number] // n columns, drops n/2 rows - the long cruising grade
  | ["d45", number] // n columns, drops n rows
  | ["d63", number] // n columns, drops 2n rows - the plunges
  | ["cliff", number] // no columns, drops n rows - free fall
  | ["u45", number]; // n columns, climbs n rows - the occasional lip to launch off

// The shallow grade (d26) carries the descent; it is the only one you can stay planted
// on at cruise. d45 tracks exactly, so you skim it. d63 and cliffs throw you off on
// purpose - that is where the fall boost is earned - so they are rationed, and each is
// followed by something shallow enough to land back onto.
//
// Eight shoulders, each a long grade, a shelf to breathe on, a pitch, and a drop.
//
// Four of them end `u45` then `cliff`: a lip that throws you, over nothing. Ramp and
// drop are one feature - the launch is only worth what the height buys on the way down.
// Four and not eight: on every shoulder the run is 28% grounded and stops being a
// descent at all. These are punctuation.
const PROFILE: Seg[] = [
  ["flat", 26], // the summit

  ["d26", 76], ["flat", 46], ["d45", 20], ["cliff", 6],
  ["d26", 88], ["d45", 16], ["flat", 50], ["u45", 5], ["cliff", 8],
  ["d26", 72], ["flat", 44], ["d63", 5], ["d26", 60], ["cliff", 7],
  ["d26", 96], ["d45", 24], ["flat", 52], ["u45", 5], ["cliff", 10],
  ["d26", 80], ["flat", 46], ["d45", 18], ["d26", 64], ["cliff", 8],
  ["d26", 92], ["d63", 6], ["d26", 56], ["flat", 54], ["u45", 8], ["cliff", 9],
  ["d26", 84], ["d45", 22], ["flat", 44], ["u45", 4], ["cliff", 7],
  ["d26", 100], ["flat", 50], ["d45", 20], ["d26", 68], ["cliff", 10],

  ["d26", 60], ["flat", 60], // the basin
];

const CRUST = 2; // rows of rock under the surface. Deeper is invisible and not free.
const START_ROW = 14;

// Pass one: walk the profile, recording what glyph sits where and how low the surface
// gets in each column.
const cells: [number, number, string][] = [];
const surface: number[] = [];
let col = 0;
let row = START_ROW;

const put = (c: number, r: number, ch: string) => {
  cells.push([c, r, ch]);
  surface[c] = Math.max(surface[c] ?? 0, r);
};

for (const [kind, n] of PROFILE) {
  if (kind === "cliff") {
    row += n;
    continue;
  }
  if (kind === "flat") {
    for (let i = 0; i < n; i++) put(col++, row, "#");
  } else if (kind === "d45") {
    for (let i = 0; i < n; i++) put(col++, row++, "n");
  } else if (kind === "u45") {
    for (let i = 0; i < n; i++) put(col++, --row, "u");
  } else if (kind === "d26") {
    for (let i = 0; i < n; i += 2) {
      put(col++, row, "d");
      put(col++, row, "D");
      row++;
    }
  } else if (kind === "d63") {
    for (let i = 0; i < n; i++) {
      put(col, row, "B");
      put(col, row + 1, "b");
      col++;
      row += 2;
    }
  }
}

const W = col;
const H = row + CRUST + 6;
const grid = Array.from({ length: H }, () => new Array<string>(W).fill(" "));

for (const [c, r, ch] of cells) if (grid[r]?.[c] !== undefined) grid[r][c] = ch;

// Pass two: rock under the surface. Each column fills down to its neighbours' depth as
// well as its own, which is what makes a cliff read as a face instead of a floating lip.
for (let c = 0; c < W; c++) {
  const deepest = Math.max(surface[c], surface[c - 1] ?? 0, surface[c + 1] ?? 0);
  for (let r = surface[c] + 1; r <= deepest + CRUST; r++) if (grid[r]) grid[r][c] = "#";
}

// One-way ledges over the slopes: optional high lines, never required.
for (let c = 60; c < W - 40; c += 47) {
  const r = surface[c] - 9;
  if (r > 2) for (let i = 0; i < 12 && c + i < W; i++) if (grid[r]) grid[r][c + i] = "=";
}

grid[START_ROW - 1][3] = "@";

export const TEST_LEVEL = grid.map((r) => r.join(""));
