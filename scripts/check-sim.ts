// Headless checks. Two halves, and they catch different things.
//
// The first asserts against numbers derived from the Sonic Physics Guide, not against
// whatever this sim happens to produce. That is the only way to catch a constant that
// is uniformly wrong - a 2x error reads as "feels a bit sluggish" and is invisible to
// play. Tolerance is 5%, which covers 120Hz discretisation and nothing else.
//
// The second runs the real act, because the seams between chunks are where a body
// wedges and no synthetic slope reproduces them.

import { K, R, STEP, TILE, newPlayer, parseLevel, solidAt, step, type Input, type Level, type Player, type Ring } from "../src/sim.ts";
import { ACT_1 } from "../src/levels.ts";

const DEG = Math.PI / 180;
let failures = 0;

function near(what: string, got: number, want: number, tol = 0.05): void {
  const good = Math.abs(got - want) <= Math.abs(want) * tol;
  if (!good) failures++;
  const pct = ((got - want) / want) * 100;
  console.log(
    `  ${good ? "ok  " : "FAIL"} ${what.padEnd(33)} ${got.toFixed(2).padStart(9)}   want ${want.toFixed(2).padStart(9)}   ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`,
  );
}

function ok(what: string, cond: boolean, detail = ""): void {
  if (!cond) failures++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${what.padEnd(33)} ${detail}`);
}

const NO: Input = { x: 0, down: false, jump: false, jumpDown: false };
const input = (o: Partial<Input> = {}): Input => ({ ...NO, ...o });

// A flat field, or a constant grade built from a slope pair. `rise` is rows per pair,
// negative for a climb; it bounces off the top and bottom so the field never runs out.
function field(pair?: [string, string], rise = 0): string[] {
  const w = 600;
  const surface = new Array<number>(w).fill(20);
  if (pair) {
    let row = 20;
    let dir = rise;
    for (let x = 0; x < w; x += 2) {
      surface[x] = surface[x + 1] = row;
      if (row + dir < 2 || row + dir > 36) dir = -dir;
      row += dir;
    }
  }
  const rows: string[] = [];
  for (let y = 0; y < 42; y++) {
    let s = "";
    for (let x = 0; x < w; x++) {
      const g = surface[x];
      s += y < g ? " " : y === g && pair ? (x % 2 ? pair[1] : pair[0]) : "#";
    }
    rows.push(s);
  }
  rows[19] = "   @" + rows[19].slice(4);
  return rows;
}

// Settle on the ground, then hold `i` for `n` steps.
function drive(lv: Level, i: Input, n: number, from?: Player): Player {
  const p = from ?? newPlayer(lv);
  const bag: Ring[] = [];
  if (!from) for (let k = 0; k < 20; k++) step(p, NO, lv, bag);
  for (let k = 0; k < n; k++) {
    step(p, i, lv, bag);
    i.jumpDown = false;
  }
  return p;
}

console.log("\nground truth  (SPG constants, converted at 1 Genesis block = 1 of our tiles)\n");

// --- running ---------------------------------------------------------------
{
  const lv = parseLevel(field());
  const p = newPlayer(lv);
  const bag: Ring[] = [];
  for (let k = 0; k < 20; k++) step(p, NO, lv, bag);
  let t = 0;
  const go = input({ x: 1 });
  for (let k = 0; k < 2000; k++) {
    step(p, go, lv, bag);
    if (p.gsp >= K.topSpeed - 1e-6) {
      t = (k + 1) * STEP;
      break;
    }
  }
  near("time to top speed, s", t, 2.133);
  near("top speed, px/s", drive(lv, input({ x: 1 }), 600).gsp, 180);
}
{
  const lv = parseLevel(field());
  const p = drive(lv, input({ x: 1 }), 400);
  const bag: Ring[] = [];
  const x0 = p.x;
  for (let k = 0; k < 3000 && p.gsp > 0; k++) step(p, NO, lv, bag);
  near("coast distance running, px", p.x - x0, 192);
}
{
  const lv = parseLevel(field());
  const p = drive(lv, input({ x: 1 }), 400);
  const bag: Ring[] = [];
  const roll = input({ down: true });
  step(p, roll, lv, bag); // enter the ball
  const x0 = p.x;
  for (let k = 0; k < 6000 && p.gsp > 0; k++) step(p, roll, lv, bag);
  near("coast distance rolling, px", p.x - x0, 384);
}
{
  const lv = parseLevel(field());
  const p = drive(lv, input({ x: 1 }), 400);
  const bag: Ring[] = [];
  const x0 = p.x;
  const brake = input({ x: -1 });
  for (let k = 0; k < 3000 && p.gsp > 0; k++) step(p, brake, lv, bag);
  near("braking distance, px", p.x - x0, 18);
}

// --- jumping ---------------------------------------------------------------
// Measured at the feet, not the center: entering ball form on a jump sinks the center
// by 2.5px so the feet stay put, and reading the center hides that inside the arc.
const foot = (p: Player) => p.y + (p.rolling ? R.rollH : R.h);
function apex(hold: boolean): number {
  const lv = parseLevel(field());
  const p = newPlayer(lv);
  const bag: Ring[] = [];
  for (let k = 0; k < 20; k++) step(p, NO, lv, bag);
  const y0 = foot(p);
  let lo = y0;
  step(p, input({ jump: true, jumpDown: true }), lv, bag);
  const after = hold ? input({ jump: true }) : NO;
  for (let k = 0; k < 400 && !p.grounded; k++) {
    step(p, after, lv, bag);
    lo = Math.min(lo, foot(p));
  }
  return y0 - lo;
}
near("jump apex, held, px", apex(true), 48.29);
// Release clamps the rise to 120 px/s, but only from the step after the jump - so the
// first step's 1.6px of travel is banked before the cut can take it.
near("jump apex, released at once, px", apex(false), 120 * 120 / (2 * K.gravity) + K.jumpForce * STEP);

// --- slopes ----------------------------------------------------------------
// One long monotonic grade, entered with speed set by hand. Driving onto a climb is not
// an option: running up 26.6 is net negative, so the player would never arrive at all -
// which is the point being measured and cannot also be the way to set it up.
function grade26(dir: 1 | -1): string[] {
  const w = 160;
  const h = 46;
  const g = Array.from({ length: h }, () => new Array<string>(w).fill(" "));
  const start = dir > 0 ? 6 : 40;
  let row = start;
  for (let x = 0; x + 1 < w && row > 1 && row < h - 1; x += 2) {
    g[row][x] = dir > 0 ? "d" : "c";
    g[row][x + 1] = dir > 0 ? "D" : "C";
    for (let y = row + 1; y < h; y++) g[y][x] = g[y][x + 1] = "#";
    row += dir;
  }
  g[start - 1][2] = "@";
  return g.map((r) => r.join(""));
}

function rollAccel(dir: 1 | -1, gsp0: number): number {
  const lv = parseLevel(grade26(dir));
  const p = newPlayer(lv);
  const bag: Ring[] = [];
  for (let k = 0; k < 40 && !p.grounded; k++) step(p, NO, lv, bag);
  p.gsp = gsp0;
  const roll = input({ down: true });
  step(p, roll, lv, bag);
  const want = dir > 0 ? -0.4 : 0.4;
  let acc = dir > 0 ? -Infinity : Infinity;
  for (let k = 0; k < 200; k++) {
    const before = p.gsp;
    step(p, roll, lv, bag);
    if (!p.grounded || Math.sign(p.angle) !== Math.sign(want) || Math.abs(p.angle) < 0.4) continue;
    const a = (p.gsp - before) / STEP;
    acc = dir > 0 ? Math.max(acc, a) : Math.min(acc, a);
  }
  return acc;
}
near("roll gain on 26.6 down, px/s2", rollAccel(1, 200), K.slopeRollDown * Math.sin(26.565 * DEG) - K.rollFriction);
near("roll cost on 26.6 up, px/s2", rollAccel(-1, 320), -(K.slopeRollUp * Math.sin(26.565 * DEG) + K.rollFriction));
{
  // Running uphill is net negative at every real gradient - that is the whole design.
  const gain = K.accel - K.slopeRun * Math.sin(26.565 * DEG);
  ok("cannot run up 26.6 degrees", gain < 0, `net ${gain.toFixed(1)} px/s2`);
}
{
  // 63.4 is a vertical stack, not a horizontal pair: `A` over `a`, two rows per column.
  const w = 70;
  const h = 46;
  const FLAT = 38;
  const RUNUP = 40; // long enough to actually reach top speed before the wall
  const g = Array.from({ length: h }, () => new Array<string>(w).fill(" "));
  for (let x = 0; x < RUNUP; x++) for (let y = FLAT; y < h; y++) g[y][x] = "#";
  let row = FLAT - 2;
  for (let x = RUNUP; x < w && row > 1; x++) {
    g[row][x] = "A";
    g[row + 1][x] = "a";
    for (let y = row + 2; y < h; y++) g[y][x] = "#";
    row -= 2;
  }
  g[FLAT - 1][1] = "@";
  const lv = parseLevel(g.map((r) => r.join("")));
  const p = newPlayer(lv);
  const bag: Ring[] = [];
  const go = input({ x: 1 });
  let slipped = false;
  let peak = 0;
  for (let k = 0; k < 3000 && !slipped; k++) {
    step(p, go, lv, bag);
    peak = Math.max(peak, p.x);
    slipped = p.ctrlLock > 0;
  }
  // The lock is the point, not the detach: Sonic re-lands almost immediately. What has
  // to be true is that you slide back down the slope while still holding forward.
  for (let k = 0; k < 90; k++) step(p, go, lv, bag);
  ok("slips on a 63 climb under 75 px/s", slipped, `lock set at col ${(peak / TILE).toFixed(1)}`);
  ok("and slides back while holding on", p.x < peak - TILE, `fell back ${((peak - p.x) / TILE).toFixed(1)} tiles`);
}

// --- spindash --------------------------------------------------------------
{
  const lv = parseLevel(field());
  const p = newPlayer(lv);
  const bag: Ring[] = [];
  for (let k = 0; k < 20; k++) step(p, NO, lv, bag);
  const charge = input({ down: true, jump: true, jumpDown: true });
  for (let k = 0; k < 40; k++) {
    step(p, charge, lv, bag);
    charge.jumpDown = k % 6 === 4;
  }
  step(p, input({ x: 1 }), lv, bag);
  ok("spindash releases 240..360 px/s", p.gsp >= 239 && p.gsp <= 361, `${p.gsp.toFixed(0)} px/s`);
  ok("spindash beats running", p.gsp > K.topSpeed, `${(p.gsp / K.topSpeed).toFixed(2)}x top speed`);
}

// --- the act ---------------------------------------------------------------
console.log("\nact 1  (a bot holding right, rolling into descents, jumping holes)\n");
{
  const lv = parseLevel(ACT_1);
  const p = newPlayer(lv);
  const bag: Ring[] = [];
  const i = input({ x: 1 });
  let grounded = 0;
  let rolling = 0;
  let top = 0;
  let high = Infinity;
  let n = 0;
  // Nothing clever: roll into anything that descends, and jump when the floor ahead
  // stops. That is enough of a player to tell whether the act is passable.
  const hole = () => {
    if (!p.grounded || Math.abs(p.angle) > 0.2) return false;
    for (let d = 0; d < 40; d += 4) if (solidAt(lv, p.x + 26, p.y + 11 + d)) return false;
    return true;
  };
  for (; n < 120 * 200 && !p.done; n++) {
    i.down = p.grounded && p.angle < -0.1 && Math.abs(p.gsp) > 90;
    i.jumpDown = i.jump = hole();
    step(p, i, lv, bag);
    i.jumpDown = false;
    if (p.grounded) grounded++;
    if (p.rolling) rolling++;
    top = Math.max(top, Math.abs(p.gsp));
    high = Math.min(high, p.y);
  }
  const secs = n * STEP;
  console.log(`  goal reached       ${p.done ? "yes" : "NO"}  in ${secs.toFixed(1)}s`);
  console.log(`  deaths             ${p.deaths}`);
  console.log(`  rings              ${p.rings}`);
  console.log(`  grounded           ${((grounded / n) * 100).toFixed(0)}%`);
  console.log(`  rolling            ${((rolling / n) * 100).toFixed(0)}%`);
  console.log(`  top ground speed   ${top.toFixed(0)} px/s   ${(top / TILE).toFixed(1)} tiles/s`);
  console.log(`  highest reached    row ${(high / TILE).toFixed(1)}   (shelf is row 14)`);
  console.log(`  took the shelf     ${high < 16 * TILE ? "yes" : "no"}`);
  ok("act 1 is completable", p.done, `${secs.toFixed(1)}s`);
  ok("nothing wedges", secs < 190);
}

console.log(failures ? `\n${failures} FAILED\n` : "\nall checks passed\n");
process.exit(failures ? 1 : 0);
