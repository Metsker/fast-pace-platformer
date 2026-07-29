// Emerald Hill, roughly. Sonic 2's own level format: a library of fixed-size chunks
// and a small grid saying where each one goes. 15 x 3 chunks of 16x16 glyphs is
// 240 x 48 tiles - 12 screens across, 3.4 down.
//
// Three bands, and the whole two-tier structure lives in how they stack:
//
//   band 0  rows  0-15   sky, with the upper route's shelf on its bottom two rows
//   band 1  rows 16-31   the lower route. Its surface sits at row 22.
//   band 2  rows 32-47   rock, or void where there is a pit
//
// The shelf (row 14) sits 3 rows above the launch ramp's lip (row 17). That gap is the
// gate: clearing it needs 24px of rise over 56px of travel, which running's 180 px/s
// cannot buy and a spindash's 240 can. Failing it drops you back on the lower route -
// the punishment for missing the fast line is the slow line, never a death.

const W = 16;
const H = 16;

type Set = (x: number, y: number, ch: string) => void;

const chunk = (draw: (set: Set) => void): string[] => {
  const g = Array.from({ length: H }, () => new Array<string>(W).fill(" "));
  draw((x, y, ch) => {
    if (y >= 0 && y < H && x >= 0 && x < W) g[y][x] = ch;
  });
  return g.map((r) => r.join(""));
};

const box = (set: Set, x0: number, y0: number, x1: number, y1: number, ch: string) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, ch);
};

const GROUND = 6; // the lower route's surface, local to band 1
const SHELF = 14; // the upper route's surface, local to band 0

// A run of rings, spaced 2 apart - Sonic's rings are the drawn line of the route.
const ringRow = (set: Set, x0: number, y: number, n: number) => {
  for (let k = 0; k < n; k++) set(x0 + k * 2, y, "o");
};

// --- band 1, the lower route -------------------------------------------------

const flat = (extra?: (set: Set) => void) =>
  chunk((set) => {
    box(set, 0, GROUND, W - 1, H - 1, "#");
    extra?.(set);
  });

// 26.6 degrees, the only grade you stay planted on. Two tiles per row of drop, so the
// pair `dD` (or `cC` climbing) is one step. Rock is filled under every column.
// A pair placed at row r carries the surface from (r+1)*8 on its left edge to r*8 on
// its right, so a climb has to *start* one row above where a matching descent ended -
// GROUND+7, not GROUND+8. An off-by-one here is an 8px step at the chunk seam, which
// the push sensor reads as a wall and the run stops dead against it.
const grade = (dir: 1 | -1) =>
  chunk((set) => {
    let row = dir > 0 ? GROUND : GROUND + 7;
    for (let x = 0; x < W; x += 2) {
      set(x, row, dir > 0 ? "d" : "c");
      set(x + 1, row, dir > 0 ? "D" : "C");
      box(set, x, row + 1, x + 1, H - 1, "#");
      row += dir;
    }
  });

// Flat, then a 45 degree ramp, then nothing. The lip is the launcher: leaving it sets
// vy = -gsp * sin(45), so how high you get is exactly how fast you arrived.
const ramp = chunk((set) => {
  box(set, 0, GROUND, 7, H - 1, "#");
  // Same seam rule: `u` carries its left edge at (row+1)*8, so the first one sits at
  // GROUND-1 to meet the flat it leaves. Five columns puts the lip at row 1, three
  // rows under the shelf - which is the 24px the gate is built around.
  let row = GROUND - 1;
  for (let x = 8; x <= 12; x++) {
    set(x, row, "u");
    box(set, x, row + 1, x, H - 1, "#");
    row--;
  }
});

// --- band 0, the upper route -------------------------------------------------

const shelf = (x0: number, x1: number, rings: boolean) =>
  chunk((set) => {
    box(set, x0, SHELF, x1, SHELF + 1, "=");
    if (rings) ringRow(set, x0 + 2, SHELF - 1, 6);
  });

const CHUNKS: Record<string, string[]> = {
  _: chunk(() => {}),
  X: chunk((set) => box(set, 0, 0, W - 1, H - 1, "#")),
  V: chunk(() => {}),

  // lower route
  S: flat((set) => {
    set(3, GROUND - 1, "@");
    ringRow(set, 8, GROUND - 1, 4);
  }),
  L: flat(),
  l: flat((set) => ringRow(set, 2, GROUND - 1, 6)),
  K: flat((set) => box(set, 6, GROUND - 1, 9, GROUND - 1, "^")),
  N: grade(1),
  M: grade(-1),
  J: ramp,
  q: chunk((set) => {
    box(set, 0, GROUND, 4, H - 1, "#");
    box(set, 11, GROUND, W - 1, H - 1, "#");
  }),
  // Where the first shelf drops you back down, so both routes pass the checkpoint.
  "+": flat((set) => {
    ringRow(set, 2, GROUND - 1, 4);
    set(12, GROUND - 1, "P");
  }),
  Z: flat((set) => set(8, GROUND - 1, "G")),

  // upper route
  y: shelf(4, W - 1, false),
  T: shelf(0, W - 1, true),
  t: shelf(0, 9, true),
};

// Each row is one band; each character is one chunk. Read it as a map.
//
// The shelf over chunks 5-7 skips the spike patch at 6; the shelf over 11-13 skips the
// pit at 12. That is the deal the two tiers make - the fast line is also the safe one,
// and you only get it by arriving at a ramp with rolling speed.
const ACT = [
  "_____yTt___yTt_",
  "SlNMJLK+NMJLqlZ",
  "XXXXXXXXXXXXVXX",
];

function assemble(grid: string[]): string[] {
  const rows: string[] = [];
  for (const band of grid) {
    const cells = [...band].map((c) => {
      const ch = CHUNKS[c];
      if (!ch) throw new Error(`no chunk '${c}'`);
      return ch;
    });
    for (let y = 0; y < H; y++) rows.push(cells.map((c) => c[y]).join(""));
  }
  return rows;
}

export const ACT_1 = assemble(ACT);
