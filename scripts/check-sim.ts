// Headless checks. Two halves, and they catch different things.
//
// The first asserts against numbers derived from the Sonic Physics Guide, not against
// whatever this sim happens to produce. That is the only way to catch a constant that
// is uniformly wrong - a 2x error reads as "feels a bit sluggish" and is invisible to
// play. Tolerance is 5%, which covers 120Hz discretisation and nothing else.
//
// The second runs the real act, because the seams between chunks are where a body
// wedges and no synthetic slope reproduces them.

import { K, ONEWAY, R, STEP, TILE, kill, newPlayer, parseLevel, restart, step, type Input, type Level, type Player, type Ring } from "../src/sim.ts";
import { follow, newCam } from "../src/camera.ts";
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

// --- crouching -------------------------------------------------------------
{
  // Holding down while too slow to roll has to settle. If left/right still accelerates
  // you, you cross the roll threshold, roll friction drops you back under it, and the
  // body flips height 2.5px at a time - 145 times in two seconds, which is what the
  // player felt. The spindash also becomes unreachable, because gsp is never under the
  // threshold on the frame you press jump.
  const lv = parseLevel(field());
  const p = newPlayer(lv);
  const bag: Ring[] = [];
  for (let k = 0; k < 20; k++) step(p, NO, lv, bag);
  const hold = input({ x: 1, down: true });
  let flips = 0;
  let was = p.rolling;
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k < 240; k++) {
    step(p, hold, lv, bag);
    if (p.rolling !== was) ((flips++), (was = p.rolling));
    lo = Math.min(lo, p.y);
    hi = Math.max(hi, p.y);
  }
  ok("crouching does not flip ball form", flips === 0, `${flips} flips, body swing ${(hi - lo).toFixed(2)}px`);
  ok("crouching holds you still", Math.abs(p.gsp) < 1, `${p.gsp.toFixed(2)} px/s`);
}
{
  // And the payoff: you can still build speed from a standstill, holding a direction.
  const lv = parseLevel(field());
  const p = newPlayer(lv);
  const bag: Ring[] = [];
  for (let k = 0; k < 20; k++) step(p, NO, lv, bag);
  const charge = input({ x: 1, down: true, jump: true, jumpDown: true });
  for (let k = 0; k < 60; k++) {
    step(p, charge, lv, bag);
    charge.jumpDown = k % 6 === 4;
  }
  const revved = p.spinning;
  step(p, input({ x: 1 }), lv, bag);
  ok("can spindash while holding a direction", revved && p.gsp > K.topSpeed, `${p.gsp.toFixed(0)} px/s`);
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

// --- a player, roughly -----------------------------------------------------
// Nothing clever: hold right, roll into anything that descends, jump when the floor
// ahead stops. Deliberately stupid - it never spindashes and never brakes - so what it
// gets through is a floor on what the act asks of a person, not a ceiling.
//
// The floor probe cannot be solidAt: that deliberately reports one-way platforms as
// non-solid, because they must never block a wall or a ceiling. A bot asking "is there
// floor ahead" with it sees every shelf as a hole and jumps on every step, bouncing
// across the upper route without ever landing on it. A player looking at the screen
// sees a platform, so the bot has to as well - any non-empty tile counts.
const floorAt = (lv: Level, x: number, y: number): boolean => {
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  if (tx < 0 || tx >= lv.w || ty < 0 || ty >= lv.h) return false;
  return lv.tiles[ty * lv.w + tx] !== 0;
};

function bot(p: Player, i: Input, lv: Level, bag: Ring[], roll = true): void {
  i.down = roll && p.grounded && p.angle < -0.1 && Math.abs(p.gsp) > 90;
  let hole = p.grounded && Math.abs(p.angle) <= 0.2;
  if (hole) for (let d = 0; d < 40 && hole; d += 4) hole = !floorAt(lv, p.x + 26, p.y + 11 + d);
  i.jump = i.jumpDown = hole;
  step(p, i, lv, bag);
  i.jumpDown = false;
}

// --- camera ----------------------------------------------------------------
{
  // A respawn teleports the body. If the camera scrolls to catch up instead of cutting,
  // it walks back across the level at its capped rate - measured at 611px over 3.35
  // seconds of the world sliding past, on every single death.
  const lv = parseLevel(ACT_1);
  const p = newPlayer(lv);
  const bag: Ring[] = [];
  const c = newCam();
  const i = input({ x: 1 });
  const frame = () => follow(c, p, p.x, p.y, lv, 160, 112, 1 / 60);
  for (let k = 0; k < 120 * 8; k++) {
    bot(p, i, lv, bag);
    if (k % 2 === 0) frame();
  }
  const away = c.x;
  ok("the camera keeps up while running", Math.abs(p.x - 80 - c.x) < 60, `${Math.abs(p.x - 80 - c.x).toFixed(0)}px behind at speed`);

  kill(p, lv);
  frame();
  // Clamped, not centred: the spawn is 28px from the level's left edge, so the camera
  // cannot put the player mid-screen and is right not to try.
  const want = Math.min(Math.max(p.x - 80, 0), lv.w * TILE - 160);
  const cut = Math.abs(c.x - want);
  const at = c.x;
  frame();
  ok("a respawn cuts, never scrolls", cut < 0.5, `${(away - c.x).toFixed(0)}px in one frame, ${cut.toFixed(2)}px off target`);
  ok("and does not keep drifting after", Math.abs(c.x - at) < 0.5, `${Math.abs(c.x - at).toFixed(2)}px on the next frame`);

  // It still eases rather than snapping when nothing teleported. Run far enough that the
  // left clamp is no longer holding it, or this measures nothing.
  for (let k = 0; k < 120 * 4; k++) {
    bot(p, i, lv, bag);
    if (k % 2 === 0) frame();
  }
  const before = c.x;
  for (let k = 0; k < 120; k++) {
    bot(p, i, lv, bag);
    if (k % 2 === 0) frame();
  }
  const moved = c.x - before;
  ok("normal following still eases", moved > 0 && moved <= K.rollCap, `${moved.toFixed(0)}px over 1s, cap ${K.rollCap}`);
}

// --- respawn points --------------------------------------------------------
{
  // Every point the game can put a body back at has to be a point a body can stand at.
  // A respawn 5.5px into the rock is not a stuck player, it is an unrecoverable death
  // loop: you fall through the world, die, and respawn into the same rock.
  const lv = parseLevel(ACT_1);
  const p = newPlayer(lv);
  const bag: Ring[] = [];
  const points = [{ x: lv.spawn.x, standY: lv.spawn.y, what: "spawn" }, ...lv.checkpoints.map((c) => ({ x: c.x, standY: c.standY, what: `checkpoint col ${(c.x / TILE).toFixed(0)}` }))];
  const bad: string[] = [];
  for (const pt of points) {
    p.respawnX = pt.x;
    p.respawnY = pt.standY;
    kill(p, lv);
    const deaths = p.deaths;
    for (let k = 0; k < 240; k++) step(p, NO, lv, bag);
    if (!p.grounded || p.deaths > deaths || Math.abs(p.y - pt.standY) > TILE) bad.push(pt.what);
  }
  ok("every respawn point is standable", bad.length === 0, bad.length ? `sunk: ${bad.join(", ")}` : `${points.length} checked`);
}
{
  // And the other half: that touching a checkpoint stores a standable point. The check
  // above would still pass if the trigger wrote the star's draw position instead.
  const lv = parseLevel(ACT_1);
  const p = newPlayer(lv);
  const bag: Ring[] = [];
  // On `hit`, not on respawnY: the lower route's checkpoint sits on the same ground row
  // as the spawn, so its standY is byte-identical and watching that value sees nothing.
  const i = input({ x: 1 });
  for (let k = 0; k < 120 * 60 && !lv.checkpoints.some((c) => c.hit); k++) bot(p, i, lv, bag);
  const got = lv.checkpoints.find((c) => c.hit);
  kill(p, lv);
  const deaths = p.deaths;
  for (let k = 0; k < 240; k++) step(p, NO, lv, bag);
  ok(
    "a touched checkpoint respawns you standing",
    !!got && p.grounded && p.deaths === deaths && Math.abs(p.y - got.standY) < TILE,
    got ? `col ${(got.x / TILE).toFixed(0)}, landed row ${(p.y / TILE).toFixed(1)}, grounded ${p.grounded}` : "the bot reached none",
  );
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
  let onShelf = 0;
  let top = 0;
  let topVX = 0;
  let high = Infinity;
  let n = 0;
  // Standing on a one-way tile is the honest "took the upper route" signal now that the
  // shelves sit at different heights along the act.
  const shelfUnderfoot = () => {
    const tx = Math.floor(p.x / TILE);
    const ty = Math.floor((p.y + (p.rolling ? R.rollH : R.h) + 1) / TILE);
    return p.grounded && tx >= 0 && tx < lv.w && ty >= 0 && ty < lv.h && lv.tiles[ty * lv.w + tx] === ONEWAY;
  };
  for (; n < 120 * 200 && !p.done; n++) {
    bot(p, i, lv, bag);
    if (p.grounded) grounded++;
    if (p.rolling) rolling++;
    if (shelfUnderfoot()) onShelf++;
    top = Math.max(top, Math.abs(p.gsp));
    topVX = Math.max(topVX, Math.abs(p.vx));
    high = Math.min(high, p.y);
  }
  const secs = n * STEP;
  console.log(`  goal reached       ${p.done ? "yes" : "NO"}  in ${secs.toFixed(1)}s`);
  console.log(`  deaths             ${p.deaths}`);
  console.log(`  rings              ${p.rings}`);
  console.log(`  grounded           ${((grounded / n) * 100).toFixed(0)}%`);
  console.log(`  rolling            ${((rolling / n) * 100).toFixed(0)}%`);
  // Ground speed is not capped - only vx is, exactly as the SPG has it - so a steep
  // grade carries a scalar the horizontal motion never spends.
  console.log(`  top ground speed   ${top.toFixed(0)} px/s   ${(top / TILE).toFixed(1)} tiles/s`);
  console.log(`  top horizontal     ${topVX.toFixed(0)} px/s   (cap ${K.rollCap})`);
  console.log(`  on the upper route ${((onShelf / n) * 100).toFixed(0)}% of the run`);
  console.log(`  highest reached    row ${(high / TILE).toFixed(1)}`);
  ok("act 1 is completable", p.done, `${secs.toFixed(1)}s`);
  ok("nothing wedges", secs < 190);
  ok("the descents reach the rolling cap", topVX >= K.rollCap - 1, `${topVX.toFixed(0)} of ${K.rollCap} px/s`);
  ok("rolling takes the upper route", onShelf > 0, `${((onShelf / n) * 100).toFixed(0)}% of the run on a shelf`);

  // The gate, from the other side - and not the invariant I first wrote here, which was
  // "running alone is refused the shelf". That is false, and the act proved it: above
  // top speed, holding a direction gives no acceleration but also no friction, so a
  // runner on a long descent gains the slope's 100.6 px/s2 with nothing taking it back
  // and arrives at the ramp near 300, not 180. Rolling is worth 2x that on the way down
  // and half the cost on the way up - it buys speed, not exclusive access, which is what
  // it buys in Sonic too. What must stay true is that only rolling reaches the cap.
  {
    const lo = parseLevel(ACT_1);
    const q = newPlayer(lo);
    const sack: Ring[] = [];
    const j = input({ x: 1 });
    let peak = 0;
    let k = 0;
    for (; k < 120 * 200 && !q.done; k++) {
      bot(q, j, lo, sack, false);
      peak = Math.max(peak, Math.abs(q.vx));
    }
    const runSecs = k * STEP;
    console.log(`\n  never rolling:     ${q.done ? "finished" : "DID NOT FINISH"} in ${runSecs.toFixed(1)}s, top horizontal ${peak.toFixed(0)} px/s`);
    console.log(`  rolling is worth   ${(runSecs - secs).toFixed(1)}s and ${(topVX - peak).toFixed(0)} px/s`);
    ok("only rolling reaches the cap", peak < K.rollCap - 20, `running peaks at ${peak.toFixed(0)}`);
    ok("rolling is the faster line", secs < runSecs, `${secs.toFixed(1)}s vs ${runSecs.toFixed(1)}s`);
    ok("running alone still finishes", q.done, `${runSecs.toFixed(1)}s`);
  }

  // A cleared act has to be replayable. `step` early-returns on `done`, so anything
  // that resets the position without clearing it leaves a sim that is not ticking.
  restart(p, lv, bag);
  const cleared = { done: p.done, time: p.time, rings: p.rings, at: p.x };
  let ran = 0;
  for (let k = 0; k < 600; k++) ((bot(p, i, lv, bag)), (ran = p.x - cleared.at));
  ok(
    "a cleared act restarts",
    !cleared.done && cleared.time === 0 && cleared.rings === 0 && Math.abs(cleared.at - lv.spawn.x) < 1 && ran > TILE * 4,
    `back at spawn, moved ${(ran / TILE).toFixed(1)} tiles`,
  );
}

console.log(failures ? `\n${failures} FAILED\n` : "\nall checks passed\n");
process.exit(failures ? 1 : 0);
