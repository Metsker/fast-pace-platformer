// Headless sim check. Verifies the claims the design rests on: the DESIGN.md §10 arc
// table, that speed only grows on the ground, that one-way platforms are one-way, and
// that nothing tunnels through a floor.
import assert from "node:assert";
import { BASE_SPEED, BODY, K, STEP, TILE, TOP_SPEED, newPlayer, parseLevel, respawn, step, type Input } from "../src/sim.ts";
import { TEST_LEVEL } from "../src/levels.ts";

const input = (over: Partial<Input> = {}): Input => ({
  x: 0,
  down: false,
  jump: false,
  jumpDown: false,
  ...over,
});

const FLAT = ["@" + " ".repeat(1999), "#".repeat(2000)];
const SPEEDS = [240, 800, TOP_SPEED];

// Horizontal tiles covered by one jump, as a function of what the player does in the air.
function arc(speed: number, mode: "float" | "apex" | "instant" | "double"): number {
  const lv = parseLevel(FLAT);
  const p = newPlayer(lv);
  const i = input({ x: 1, jump: true });
  for (let k = 0; k < 10; k++) step(p, i, lv); // settle onto the floor
  p.vx = speed;

  i.jumpDown = true;
  step(p, i, lv);
  i.jumpDown = false;
  const x0 = p.x;

  let peaked = false;
  let doubled = false;
  for (let k = 0; k < 4000 && !p.grounded; k++) {
    if (p.vy >= 0) peaked = true;
    if (mode === "instant") i.down = true;
    if (mode === "apex") i.down = peaked;
    if (mode === "double" && peaked && !doubled) {
      i.jumpDown = true;
      doubled = true;
    }
    step(p, i, lv);
    i.jumpDown = false;
  }
  assert(p.grounded, `${speed} ${mode}: never landed`);
  return (p.x - x0) / TILE;
}

const MODES = ["float", "apex", "instant", "double"] as const;
const LABELS = {
  float: "never dive (pure float) ",
  apex: "dive at the apex        ",
  instant: "dive immediately        ",
  double: "air jump at apex, float ",
};
const table = MODES.map((m) => SPEEDS.map((s) => arc(s, m)));

console.log("jump arc, tiles covered  " + SPEEDS.map((s) => String(s).padStart(7)).join("  ") + " px/s");
MODES.forEach((m, r) => {
  console.log(`  ${LABELS[m]}` + table[r].map((v) => v.toFixed(1).padStart(7)).join("  "));
});

for (let s = 0; s < SPEEDS.length; s++) {
  assert(table[0][s] > table[1][s], `${SPEEDS[s]}: diving at the apex must shorten the arc`);
  assert(table[1][s] > table[2][s], `${SPEEDS[s]}: diving early must shorten it further`);
  assert(table[3][s] > table[0][s], `${SPEEDS[s]}: the air jump must extend the arc`);
}

// Running takes you to the cruise and stops there.
{
  const lv = parseLevel(FLAT);
  const p = newPlayer(lv);
  const i = input({ x: 1 });
  for (let k = 0; k < 10; k++) step(p, i, lv);
  let steps = 0;
  while (Math.abs(p.vx) < BASE_SPEED - 1 && steps < 4000) {
    step(p, i, lv);
    steps++;
  }
  assert(steps < 4000, "never reached the cruise speed");
  const atCruise = steps * STEP;
  for (let k = 0; k < 600; k++) step(p, i, lv);
  assert(Math.abs(p.vx) <= BASE_SPEED + 5, `running exceeded the cruise: ${p.vx.toFixed(0)}`);
  console.log(`\ncruise on flat ground          ${BASE_SPEED} px/s in ${atCruise.toFixed(2)}s, then held`);
}

// Falling is the accelerator, and the ground gives it back.
{
  const lv = parseLevel(["@" + " ".repeat(1999), ...Array(80).fill(" ".repeat(2000)), "#".repeat(2000)]);
  const p = newPlayer(lv);
  const i = input({ x: 1 });
  p.vx = BASE_SPEED;
  let peak = BASE_SPEED;
  for (let k = 0; k < 4000 && !p.grounded; k++) {
    step(p, i, lv);
    peak = Math.max(peak, Math.abs(p.vx));
  }
  assert(p.grounded, "never landed");
  assert(peak > BASE_SPEED + 100, `falling did not add speed: peaked ${peak.toFixed(0)}`);
  const onLanding = Math.abs(p.vx);
  for (let k = 0; k < 700; k++) step(p, i, lv);
  const settled = Math.abs(p.vx);
  assert(settled < onLanding, "the ground did not bleed the fall boost");
  assert(settled <= BASE_SPEED + 20, `boost survived on flat ground: ${settled.toFixed(0)}`);
  console.log(
    `falling from 80 tiles          ${BASE_SPEED} -> ${peak.toFixed(0)} px/s, back to ${settled.toFixed(0)} after 6s on the flat`,
  );
}

// Slopes: a descent is followed, not launched off, and a climb is climbed.
{
  // 45 degrees down for 30 columns, then flat.
  const rows: string[] = Array.from({ length: 60 }, () => " ".repeat(80));
  const g = rows.map((r) => r.split(""));
  g[4][2] = "@";
  for (let i = 0; i < 5; i++) g[5][i] = "#";
  for (let i = 0; i < 30; i++) g[5 + i][5 + i] = "n"; // descent
  for (let i = 0; i < 40; i++) g[34][35 + i] = "#"; // runout
  for (let c = 0; c < 80; c++) {
    for (let r = 0; r < 60; r++) if (g[r][c] !== " " && g[r][c] !== "@") for (let k = 1; k <= 3; k++) if (g[r + k]) g[r + k][c] = "#";
  }
  const lv = parseLevel(g.map((r) => r.join("")));
  const p = newPlayer(lv);
  const i = input({ x: 1 });
  p.vx = BASE_SPEED;
  let airborneSteps = 0;
  let maxGapBelow = 0;
  for (let k = 0; k < 2000 && p.x / TILE < 34; k++) {
    step(p, i, lv);
    if (!p.grounded) airborneSteps++;
    maxGapBelow = Math.max(maxGapBelow, p.grounded ? 0 : 1);
  }
  const frac = airborneSteps / 2000;
  assert(frac < 0.25, `launched off the descent: airborne ${(frac * 100).toFixed(0)}% of the run`);
  console.log(`45 deg descent at cruise       stayed attached, airborne ${(frac * 100).toFixed(0)}% of steps`);
}

// A descent must be a straight line, not a staircase. The surface table is what makes
// this true; snapping to whole pixels instead quantises 2.92 px/step into 3,3,4,2,3,
// which is invisible in aggregate and reads as jitter at 120Hz.
{
  const rows: string[] = Array.from({ length: 90 }, () => " ".repeat(140));
  const g = rows.map((r) => r.split(""));
  g[3][2] = "@";
  for (let i = 0; i < 8; i++) g[4][i] = "#";
  let r = 4;
  for (let i = 0; i < 100; i += 2) {
    g[r][8 + i] = "d";
    g[r][9 + i] = "D";
    r++;
  }
  for (let c = 0; c < 140; c++)
    for (let rr = 0; rr < 90; rr++)
      if (g[rr][c] !== " " && g[rr][c] !== "@") for (let k = 1; k <= 3; k++) if (g[rr + k]) g[rr + k][c] = "#";

  const lv = parseLevel(g.map((row) => row.join("")));
  const p = newPlayer(lv);
  const i = input({ x: 1 });
  p.vx = BASE_SPEED;
  const dy: number[] = [];
  for (let k = 0; k < 400 && p.x / TILE < 100; k++) {
    const y0 = p.y;
    step(p, i, lv);
    if (p.grounded && p.y > y0) dy.push(p.y - y0);
  }
  assert(dy.length > 40, `never got a sustained 26.6 descent: ${dy.length} steps`);
  const mid = dy.slice(10, -5); // drop the drop-on and the runout
  const mean = mid.reduce((a, v) => a + v, 0) / mid.length;
  const spread = Math.max(...mid) - Math.min(...mid);
  assert(spread < 0.05, `descent is a staircase, not a line: steps span ${spread.toFixed(2)} px`);
  console.log(
    `26.6 deg descent smoothness   ${mid.length} steps of ${mean.toFixed(2)} px, spread ${spread.toFixed(3)} px`,
  );
}

{
  // 45 degrees up for 12 columns.
  const g = Array.from({ length: 40 }, () => " ".repeat(60).split(""));
  g[29][2] = "@";
  for (let i = 0; i < 8; i++) g[30][i] = "#";
  for (let i = 0; i < 12; i++) g[30 - i][8 + i] = "u";
  for (let i = 0; i < 20; i++) g[18][20 + i] = "#";
  for (let c = 0; c < 60; c++) {
    for (let r = 0; r < 40; r++) if (g[r][c] !== " " && g[r][c] !== "@") for (let k = 1; k <= 3; k++) if (g[r + k]) g[r + k][c] = "#";
  }
  const lv = parseLevel(g.map((r) => r.join("")));
  const p = newPlayer(lv);
  const i = input({ x: 1 });
  const startY = p.y;
  for (let k = 0; k < 600; k++) step(p, i, lv);
  const climbed = (startY - p.y) / TILE;
  assert(climbed > 8, `did not climb the up-slope: rose ${climbed.toFixed(1)} tiles`);
  console.log(`45 deg climb at cruise         rose ${climbed.toFixed(1)} tiles`);
}

// A ramp lip throws you, and the altitude comes back as speed. Two runs down the same
// mountain, one with a ramp before the drop and one with the lip flattened off.
{
  const build = (ramp: boolean) => {
    const W = 300;
    const g = Array.from({ length: 200 }, () => " ".repeat(W).split(""));
    g[19][2] = "@";
    for (let c = 0; c < 40; c++) g[20][c] = "#"; // run-up
    // The lip: 6 columns of 45 up, or 6 more of flat if we are testing without it.
    let row = 20;
    for (let c = 40; c < 46; c++) {
      if (ramp) g[--row][c] = "u";
      else g[row][c] = "#";
    }
    for (let c = 46; c < W; c++) g[30][c] = "#"; // the floor, ten tiles below the run-up
    for (let c = 0; c < W; c++)
      for (let r = 0; r < 200; r++)
        if (g[r][c] !== " " && g[r][c] !== "@") for (let k = 1; k <= 3; k++) if (g[r + k]) g[r + k][c] = "#";
    return parseLevel(g.map((r) => r.join("")));
  };

  const run = (ramp: boolean) => {
    const lv = build(ramp);
    const p = newPlayer(lv);
    const i = input({ x: 1 });
    for (let k = 0; k < 20; k++) step(p, i, lv); // settle onto the run-up
    const y0 = p.y;
    p.vx = BASE_SPEED;
    let apex = p.y;
    let air = 0;
    let left = false;
    for (let k = 0; k < 1200; k++) {
      step(p, i, lv);
      if (!p.grounded) {
        air++;
        left = true;
      } else if (left) break; // back on the floor: this is where we compare
      apex = Math.min(apex, p.y);
    }
    assert(left && p.grounded, `ramp=${ramp}: never left and landed again`);
    return { speed: Math.abs(p.vx), air, rise: (y0 - apex) / TILE };
  };

  const withRamp = run(true);
  const flat = run(false);

  assert(withRamp.rise > 8, `the ramp did not throw the player: rose ${withRamp.rise.toFixed(1)} tiles`);
  assert(flat.rise < 1, `the flat control should not rise: ${flat.rise.toFixed(1)} tiles`);
  assert(withRamp.air > flat.air, `the ramp bought no airtime: ${withRamp.air} vs ${flat.air} steps`);
  assert(
    withRamp.speed > flat.speed + 50,
    `the ramp gave no momentum: landed at ${withRamp.speed.toFixed(0)} vs ${flat.speed.toFixed(0)} without it`,
  );
  console.log(
    `ramps give momentum            +${withRamp.rise.toFixed(1)} tiles up, ` +
      `${withRamp.air - flat.air} more steps airborne, ` +
      `${withRamp.speed.toFixed(0)} vs ${flat.speed.toFixed(0)} px/s at the bottom`,
  );
}

// One-way platforms: rise straight through, land on top, never blocked sideways.
{
  const lv = parseLevel([
    "            ",
    "            ",
    "            ",
    "            ",
    "============",
    "            ",
    "            ",
    "            ",
    "@           ",
    "            ",
    "############",
  ]);
  const p = newPlayer(lv);
  const i = input({ jump: true });
  for (let k = 0; k < 60; k++) step(p, i, lv);
  const floorY = p.y;
  assert(floorY === 10 * TILE - 6, `did not rest on the floor: ${floorY}`);

  i.jumpDown = true;
  step(p, i, lv);
  i.jumpDown = false;
  let minY = p.y;
  for (let k = 0; k < 400 && !p.grounded; k++) {
    step(p, i, lv);
    minY = Math.min(minY, p.y);
  }
  const surface = 4 * TILE;
  assert(minY + 6 < surface, `never rose through the one-way platform: bottom ${minY + 6} vs ${surface}`);
  assert(p.y === surface - 6, `did not land on the platform: ${p.y} vs ${surface - 6}`);

  // Sideways movement through a one-way tile is never blocked.
  const q = newPlayer(lv);
  q.y = surface - 2; // straddling the platform row
  q.x = 8;
  const before = q.x;
  const side = input({ x: 1 });
  for (let k = 0; k < 60; k++) step(q, side, lv);
  assert(q.x > before + 8, `one-way tile blocked sideways movement: ${before} -> ${q.x}`);
  console.log(`one-way platforms              rise through, land on top, no sideways block`);
}

// Breakable platforms: the cruise gets caught, mountain speed punches straight through.
{
  const W = 400;
  const LEDGE = [
    "@" + " ".repeat(W - 1),
    ...Array(3).fill(" ".repeat(W)),
    "=".repeat(W),
    ...Array(5).fill(" ".repeat(W)),
    "#".repeat(W),
  ];
  const drop = (vx: number) => {
    const lv = parseLevel(LEDGE);
    const p = newPlayer(lv);
    const i = input({ x: 1 });
    for (let k = 0; k < 600 && !p.grounded; k++) {
      p.vx = vx; // pinned, so the fall boost cannot carry it over the threshold
      step(p, i, lv);
    }
    assert(p.grounded, `never landed at vx ${vx}`);
    return { y: p.y, broke: lv.broken.filter((n) => n >= 0).length };
  };

  const ledge = 4 * TILE - BODY;
  const floor = 10 * TILE - BODY;
  const slow = drop(BASE_SPEED);
  const fast = drop(K.breakAt + 100);

  assert(slow.y === ledge, `the cruise should be caught by the platform: ${slow.y} vs ${ledge}`);
  assert(slow.broke === 0, `the cruise broke ${slow.broke} tiles it should not have`);
  assert(fast.y === floor, `did not punch through at speed: stopped at ${fast.y} vs ${floor}`);
  assert(fast.broke > 0, "punched through without removing a tile");

  // A respawn has to put the mountain back, or the level quietly erodes across runs.
  const lv = parseLevel(LEDGE);
  const p = newPlayer(lv);
  const i = input({ x: 1 });
  for (let k = 0; k < 600 && !p.grounded; k++) {
    p.vx = K.breakAt + 100;
    step(p, i, lv);
  }
  const gone = lv.tiles.filter((t) => t === 2).length;
  respawn(p, lv);
  assert(lv.tiles.filter((t) => t === 2).length > gone, "respawn did not restore the broken platform");
  console.log(
    `breakable platforms            caught at ${BASE_SPEED}, ${fast.broke} tiles punched out at ${K.breakAt + 100}, restored on respawn`,
  );
}

// Resting: a landed body stays landed. Everything downstream - friction, coyote time,
// the jump gate - reads p.grounded, so a flickering ground contact breaks all of them.
{
  const lv = parseLevel(FLAT);
  const p = newPlayer(lv);
  const i = input();
  for (let k = 0; k < 60; k++) step(p, i, lv);
  const restY = p.y;
  for (let k = 0; k < 240; k++) {
    step(p, i, lv);
    assert(p.grounded, `lost ground contact at rest on step ${k}`);
    assert(p.vy === 0, `vy drifted at rest: ${p.vy}`);
    assert(p.y === restY, `y drifted at rest: ${p.y} != ${restY}`);
  }
  console.log(`resting on a floor             stable at y=${restY}, grounded for 240 steps`);
}

// The air jump is one per airtime, and only the ground gives it back.
{
  const lv = parseLevel(FLAT);
  const p = newPlayer(lv);
  const i = input({ jump: true });
  for (let k = 0; k < 30; k++) step(p, i, lv);
  const press = () => {
    i.jumpDown = true;
    step(p, i, lv);
    i.jumpDown = false;
  };
  // Read into locals: node's assert narrows p.airJumps, and press() mutates behind TS's back.
  press();
  const afterGround = p.airJumps;
  press();
  const afterAir = p.airJumps;
  const vyBefore = p.vy;
  press();
  const vyAfter = p.vy;
  while (!p.grounded) step(p, i, lv);
  step(p, i, lv);
  const afterLanding = p.airJumps;

  assert(afterGround === 1, "ground jump must not consume the air jump");
  assert(afterAir === 0, "air jump not consumed");
  assert(vyAfter > vyBefore, "a third jump fired with no air jumps left");
  assert(afterLanding === 1, "landing must refresh the air jump");
  console.log(`air jump                       1 per airtime, refreshed on landing`);
}

// Terminal velocity scales with horizontal speed, so a descent can be followed instead
// of glided over. Standing still it is the float; at speed it is a fall line.
{
  const drop = ["@" + " ".repeat(9), ...Array(50).fill(" ".repeat(10)), "#".repeat(10)];
  const measure = (vx: number) => {
    const lv = parseLevel(drop);
    const p = newPlayer(lv);
    const i = input();
    let peak = 0;
    let peakVx = 0;
    for (let k = 0; k < 4000 && !p.grounded; k++) {
      p.vx = vx; // pinned, so the fall boost does not move the target
      step(p, i, lv);
      peak = Math.max(peak, p.vy);
      peakVx = Math.max(peakVx, Math.abs(p.vx));
    }
    assert(p.grounded, `never landed at vx ${vx}`);
    const expect = Math.max(K.fallCap, peakVx * K.fallTrack);
    assert(peak <= expect + 2, `fall exceeded its cap at vx ${vx}: ${peak.toFixed(0)} > ${expect.toFixed(0)}`);
    return peak;
  };
  const slow = measure(0);
  const fast = measure(BASE_SPEED);
  assert(slow <= K.fallCap + 2, `standing-still fall is not the float: ${slow.toFixed(0)}`);
  assert(fast > slow * 3, `fall does not track speed: ${fast.toFixed(0)} vs ${slow.toFixed(0)}`);
  // A 45 degree descent needs vy >= vx to stay on the surface rather than drift over it.
  assert(fast >= BASE_SPEED * 0.99, `cannot track a 45 degree line at cruise: ${fast.toFixed(0)}`);
  console.log(
    `terminal velocity              ${slow.toFixed(0)} px/s at rest, ${fast.toFixed(0)} px/s at cruise - tracks 45 deg`,
  );
}

// Tunnelling: a sustained dive is the fastest thing in the game and must still stop.
{
  const lv = parseLevel(["@   ", ...Array(58).fill("    "), "####"]);
  const p = newPlayer(lv);
  const i = input({ down: true });
  let peak = 0;
  for (let k = 0; k < 4000 && !p.grounded; k++) {
    step(p, i, lv);
    peak = Math.max(peak, p.vy);
  }
  assert(p.grounded, "dive fell through the floor");
  assert(p.deaths === 0, "dive tunnelled and died");
  console.log(`dive terminal velocity         ${peak.toFixed(0)} px/s, stopped on the floor`);
}

// The real mountain, end to end. Synthetic ramps have clean run-ins; the level has
// seams between segment types, and a body can wedge on one of those without any of the
// tests above noticing - the descent just quietly stops halfway down.
{
  const lv = parseLevel(TEST_LEVEL);
  const p = newPlayer(lv);
  const i = input({ x: 1 });
  const finish = lv.w - 60;
  let steps = 0;
  let grounded = 0;
  for (; steps < 4000 && p.x / TILE < finish; steps++) {
    step(p, i, lv);
    if (p.grounded) grounded++;
  }
  assert(
    p.x / TILE >= finish,
    `descent jammed at tile x=${(p.x / TILE).toFixed(0)} of ${lv.w} after ${steps} steps (vx ${p.vx.toFixed(0)})`,
  );
  assert(p.deaths === 0, `holding right killed the player ${p.deaths} time(s)`);
  console.log(
    `full descent, holding right     ${(p.y / TILE - lv.spawn.y / TILE).toFixed(0)} tiles down in ` +
      `${(steps / 120).toFixed(1)}s, ${((100 * grounded) / steps).toFixed(0)}% grounded, no deaths`,
  );
}

console.log("\nsim ok");
