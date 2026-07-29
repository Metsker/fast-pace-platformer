// Pure sim. No Pixi imports - this file must stay runnable under plain node.
//
// Sonic 2's model, not a velocity platformer: the grounded state is a single scalar
// `gsp` along a surface angle, and vx/vy are derived from it. See SONIC2.md §1.
// Constants are the SPG's, converted at 1 Genesis 16px block = 1 of our 8px tiles,
// so our px = Genesis px / 2 and per-second = per-frame x 60.

export const TILE = 8;
export const STEP = 1 / 120;

const DEG = Math.PI / 180;

export const K = {
  // Ground. Deceleration is 11x acceleration - you stop instantly and start never.
  accel: 84.375,
  decel: 900,
  friction: 84.375,
  topSpeed: 180,

  // Air. Acceleration is 2x the ground's, which is the only place Sonic is twitchy.
  airAccel: 168.75,
  gravity: 393.75,
  jumpForce: 195,
  jumpCut: 120, // releasing jump clamps a rise to this

  // Rolling. Half the friction, and the slope factor asymmetry is the whole reward:
  // downhill pays 4x what uphill costs, so committing to a ball converts height fast.
  rollFriction: 42.1875,
  rollDecel: 225,
  rollMin: 15, // below this you stand back up
  rollCap: 480, // caps vx only, exactly as the SPG has it

  slopeRun: 225,
  slopeRollUp: 140.625,
  slopeRollDown: 562.5,

  // Above 46 degrees and under this speed you detach and slide back down. This is what
  // stops you inching up a wall, and it is why nothing needs a wall-jump.
  slipSpeed: 75,
  slipAngle: 46 * DEG,
  ctrlLock: 0.5,

  spinDrag: 8, // spinRev -= floor(spinRev*8)/256 per frame
  spinBase: 240, // release = 240 + floor(spinRev)/2 * 30
  spinStep: 30,

  invuln: 64 / 60,
  hurtVX: 60,
  hurtVY: -120,
  ringGravity: 168.75,
  ringBounce: -0.75,
  ringLife: 256 / 60,
  ringRegrab: 64 / 60,
  ringScatterMax: 32,
  ringScatterSpeed: 120, // 4 px/f
} as const;

// Body radii, halved from the SPG's 9x19 standing and 7x14 rolling.
export const R = { w: 4.5, h: 9.5, rollW: 3.5, rollH: 7, push: 5 } as const;
const ROLL_DROP = R.h - R.rollH; // center sinks by this so the feet stay put

export const EMPTY = 0;
export const SOLID = 1;
export const ONEWAY = 2;
export const SPIKE = 3;
export const SLOPE0 = 4; // tile values SLOPE0..SLOPE0+9 index SLOPE_H / SLOPE_ANGLE

// Surface height in px below the tile top at each of the 9 pixel *edges* x = 0..8,
// linearly interpolated between them - so a ramp is an exact line and consecutive
// tiles join with no seam. 8 means "no surface here", i.e. the tile is empty.
export const SLOPE_CHARS = "uncCdDAaBb";
export const SLOPE_H: number[][] = [
  [8, 7, 6, 5, 4, 3, 2, 1, 0], // u  45 up
  [0, 1, 2, 3, 4, 5, 6, 7, 8], // n  45 down
  [8, 7.5, 7, 6.5, 6, 5.5, 5, 4.5, 4], // c  26.6 up, left half
  [4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5, 0], // C  26.6 up, right half
  [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4], // d  26.6 down, left half
  [4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8], // D  26.6 down, right half
  [8, 8, 8, 8, 8, 6, 4, 2, 0], // A  63.4 up, upper
  [8, 6, 4, 2, 0, 0, 0, 0, 0], // a  63.4 up, lower
  [0, 2, 4, 6, 8, 8, 8, 8, 8], // B  63.4 down, upper
  [0, 0, 0, 0, 0, 2, 4, 6, 8], // b  63.4 down, lower
];

// Stored, not derived. Deriving from H[0] and H[8] is right for the 45 and 26.6 pieces
// and wrong for the 63.4 ones, whose arrays are half empty - the endpoints describe a
// 45 degree line the tile does not actually draw.
export const SLOPE_ANGLE = [45, -45, 26.565, 26.565, -26.565, -26.565, 63.435, 63.435, -63.435, -63.435].map(
  (d) => d * DEG,
);

export type Ring = { x: number; y: number; vx: number; vy: number; life: number };

export type Level = {
  w: number;
  h: number;
  tiles: Uint8Array;
  rows: string[];
  spawn: { x: number; y: number };
  rings: { x: number; y: number; taken: boolean }[];
  checkpoints: { x: number; y: number; hit: boolean }[];
  goal: { x: number; y: number } | null;
};

export type Player = {
  x: number; // center
  y: number; // center
  px: number;
  py: number;
  vx: number;
  vy: number;
  gsp: number; // the real state while grounded; vx/vy are derived from it
  angle: number; // radians, the direction the floor points. 0 is flat.
  grounded: boolean;
  rolling: boolean;
  jumped: boolean; // this rise came from the jump button, so the height cut applies
  rollJump: boolean; // jumped out of a roll - no air control, Sonic 1/2 rules
  spinning: boolean;
  spinRev: number;
  ctrlLock: number;
  facing: 1 | -1;
  rings: number;
  invuln: number;
  regrab: number;
  groundY: number; // last grounded center Y, for the camera
  respawnX: number;
  respawnY: number;
  deaths: number;
  time: number;
  done: boolean;
};

export type Input = { x: -1 | 0 | 1; down: boolean; jump: boolean; jumpDown: boolean };

export function parseLevel(rows: string[]): Level {
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
  const tiles = new Uint8Array(w * h);
  const lv: Level = { w, h, tiles, rows, spawn: { x: TILE, y: TILE }, rings: [], checkpoints: [], goal: null };
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const cx = x * TILE + TILE / 2;
      const cy = y * TILE + TILE / 2;
      if (ch === "@") lv.spawn = { x: cx, y: y * TILE + TILE - R.h };
      else if (ch === "o") lv.rings.push({ x: cx, y: cy, taken: false });
      else if (ch === "P") lv.checkpoints.push({ x: cx, y: cy, hit: false });
      else if (ch === "G") lv.goal = { x: cx, y: cy };
      else if (ch === "#") tiles[y * w + x] = SOLID;
      else if (ch === "=") tiles[y * w + x] = ONEWAY;
      else if (ch === "^") tiles[y * w + x] = SPIKE;
      else if (SLOPE_CHARS.includes(ch)) tiles[y * w + x] = SLOPE0 + SLOPE_CHARS.indexOf(ch);
    }
  });
  return lv;
}

export function newPlayer(lv: Level): Player {
  return {
    x: lv.spawn.x,
    y: lv.spawn.y,
    px: lv.spawn.x,
    py: lv.spawn.y,
    vx: 0,
    vy: 0,
    gsp: 0,
    angle: 0,
    grounded: false,
    rolling: false,
    jumped: false,
    rollJump: false,
    spinning: false,
    spinRev: 0,
    ctrlLock: 0,
    facing: 1,
    rings: 0,
    invuln: 0,
    regrab: 0,
    groundY: lv.spawn.y,
    respawnX: lv.spawn.x,
    respawnY: lv.spawn.y,
    deaths: 0,
    time: 0,
    done: false,
  };
}

const tileAt = (lv: Level, tx: number, ty: number): number => {
  if (tx < 0 || tx >= lv.w) return SOLID; // walls at the sides
  if (ty < 0 || ty >= lv.h) return EMPTY; // open sky above, open void below
  return lv.tiles[ty * lv.w + tx];
};

// Surface Y of whatever is in this tile at this world x, or null if nothing is.
// One function for every tile type: a full solid's surface is simply its top edge,
// which makes "inside terrain" the same test everywhere - see solidAt.
function surfaceOf(lv: Level, tx: number, ty: number, worldX: number): number | null {
  const t = tileAt(lv, tx, ty);
  if (t === EMPTY) return null;
  if (t < SLOPE0) return ty * TILE; // SOLID, ONEWAY and SPIKE are all flat-topped
  const H = SLOPE_H[t - SLOPE0];
  const fx = Math.min(TILE, Math.max(0, worldX - tx * TILE));
  const i = Math.min(TILE - 1, Math.floor(fx));
  const h = H[i] + (H[i + 1] - H[i]) * (fx - i);
  return h >= TILE ? null : ty * TILE + h;
}

const angleOf = (lv: Level, tx: number, ty: number): number => {
  const t = tileAt(lv, tx, ty);
  return t >= SLOPE0 ? SLOPE_ANGLE[t - SLOPE0] : 0;
};

// Is this point inside terrain? Below a tile's surface means inside its rock.
// One-ways are never solid to this test - they only ever catch a descending foot.
export function solidAt(lv: Level, x: number, y: number): boolean {
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  if (tileAt(lv, tx, ty) === ONEWAY) return false;
  const s = surfaceOf(lv, tx, ty, x);
  return s !== null && y >= s;
}

export type Ground = { y: number; angle: number; oneWay: boolean };

// The highest surface under a sensor, searched from `up` px above the foot to `down`
// below it. Highest wins - that is the one you are standing on.
function groundAt(lv: Level, sx: number, footY: number, up: number, down: number): Ground | null {
  let best: Ground | null = null;
  const tx = Math.floor(sx / TILE);
  for (let ty = Math.floor((footY - up) / TILE); ty <= Math.floor((footY + down) / TILE); ty++) {
    const s = surfaceOf(lv, tx, ty, sx);
    if (s === null || s < footY - up || s > footY + down) continue;
    // Every solid tile reports its top edge as a surface, including ones buried under
    // more rock. Without this a body that drifts against a wall stands on the roof of a
    // tile that is *inside* the wall, gets shoved out by the push sensor, falls, drifts
    // back in, and loops there forever. A surface with rock directly over it is not one.
    if (solidAt(lv, sx, s - 1)) continue;
    if (best === null || s < best.y) best = { y: s, angle: angleOf(lv, tx, ty), oneWay: tileAt(lv, tx, ty) === ONEWAY };
  }
  return best;
}

// Both foot sensors; the higher surface wins. The body is 9px wide on 8px tiles, so
// its leading edge reaches into the next column while its center is still in this one -
// sampling the center alone stalls a climb after a tile and a half.
function feet(lv: Level, p: Player, up: number, down: number): Ground | null {
  const wr = p.rolling ? R.rollW : R.w;
  const hr = p.rolling ? R.rollH : R.h;
  const a = groundAt(lv, p.x - wr, p.y + hr, up, down);
  const b = groundAt(lv, p.x + wr, p.y + hr, up, down);
  if (!a) return b;
  if (!b) return a;
  return a.y <= b.y ? a : b;
}

export function hurt(p: Player, lv: Level, scattered: Ring[]): void {
  if (p.invuln > 0 || p.done) return;
  if (p.rings === 0) return kill(p, lv);
  const n = Math.min(p.rings, K.ringScatterMax);
  // Two concentric rings of up to 16, the second slower, exactly as the SPG has it.
  for (let i = 0; i < n; i++) {
    const a = 101.25 * DEG + Math.floor(i / 2) * 22.5 * DEG;
    const s = K.ringScatterSpeed * (i < 16 ? 1 : 0.5);
    scattered.push({ x: p.x, y: p.y, vx: Math.cos(a) * s * (i % 2 ? -1 : 1), vy: -Math.sin(a) * s, life: K.ringLife });
  }
  p.rings = 0;
  p.invuln = K.invuln;
  p.regrab = K.ringRegrab;
  p.grounded = false;
  p.rolling = false;
  p.gsp = 0;
  p.vx = p.facing * -K.hurtVX;
  p.vy = K.hurtVY;
}

export function kill(p: Player, lv: Level): void {
  p.deaths++;
  p.x = p.px = p.respawnX;
  p.y = p.py = p.respawnY;
  p.vx = p.vy = p.gsp = p.angle = 0;
  p.grounded = p.rolling = p.jumped = p.rollJump = p.spinning = false;
  p.spinRev = p.ctrlLock = p.invuln = p.regrab = 0;
  p.rings = 0;
  p.groundY = p.y;
  for (const r of lv.rings) r.taken = false;
}

// Ball form covers both rolling and jumping - in Sonic they are the same smaller body,
// which is why a jump clears gaps a run cannot. The center sinks so the feet stay put.
function ball(p: Player, on: boolean): void {
  if (p.rolling === on) return;
  p.rolling = on;
  p.y += on ? ROLL_DROP : -ROLL_DROP;
}

function land(p: Player, g: Ground, down: boolean): void {
  p.grounded = true;
  p.angle = g.angle;
  p.jumped = false;
  p.rollJump = false;

  // A new ground speed is calculated from vx and vy on impact - this is the line that
  // makes height into currency, and the exchange rate is the angle you land at.
  const a = Math.abs(g.angle);
  const dir = -Math.sign(Math.sin(g.angle));
  if (Math.abs(p.vx) > Math.abs(p.vy) || a <= 23 * DEG) p.gsp = p.vx;
  else if (a <= 45 * DEG) p.gsp = p.vy * 0.5 * dir;
  else p.gsp = p.vy * dir;

  p.vy = 0;
  ball(p, down && Math.abs(p.gsp) >= K.rollMin);
  p.y = g.y - (p.rolling ? R.rollH : R.h);
}

// One substep of motion. X first, then Y, then re-attach - axis-separated resolution is
// what keeps ledges and walls from snagging, and the slope lift has to happen *before*
// the wall test or the rock under a ramp's next step reads as a wall and stops the climb.
function advance(p: Player, lv: Level, dx: number, dy: number, down: boolean): void {
  const hr = () => (p.rolling ? R.rollH : R.h);
  const wr = () => (p.rolling ? R.rollW : R.w);

  if (dx !== 0) {
    const fromY = p.y;
    p.x += dx;
    if (p.grounded) {
      const g = feet(lv, p, Math.abs(dx) * 2 + 2, 0);
      if (g) {
        p.y = g.y - hr();
        p.angle = g.angle;
      }
    }
    const dir = Math.sign(dx);
    const sx = p.x + dir * R.push;
    // Grounded push sensors sit slightly below center so a shallow ramp ahead reads as
    // floor rather than as a wall.
    if (solidAt(lv, sx, p.y + (p.grounded ? 2 : 0))) {
      p.y = fromY;
      p.x = dir > 0 ? Math.floor(sx / TILE) * TILE - R.push : Math.floor(sx / TILE) * TILE + TILE + R.push;
      p.gsp = 0;
      p.vx = 0;
    }
  }

  const footBefore = p.y + hr();
  if (dy !== 0) {
    p.y += dy;
    if (dy < 0) {
      const head = p.y - hr();
      if (solidAt(lv, p.x - wr(), head) || solidAt(lv, p.x + wr(), head)) {
        p.y = Math.floor(head / TILE) * TILE + TILE + hr();
        p.vy = 0;
      }
    }
  }

  if (p.grounded) {
    // A flat 7px reach, not one scaled by speed: past that you detach, which is exactly
    // how a steep drop throws you instead of dragging you down its face.
    const g = feet(lv, p, TILE, 7);
    if (g) {
      p.y = g.y - hr();
      p.angle = g.angle;
      p.vy = 0;
    } else {
      p.grounded = false;
      p.angle = 0;
    }
  } else if (p.vy > 0) {
    // Strictly greater: a body with no vertical speed is not landing on anything. At
    // vy == 0 it would re-attach to the surface it just detached from, on the same step,
    // which is what made a slip freeze instead of slide.
    //
    // Search only the span the foot swept, so we can never snap up onto a surface we
    // never crossed. A one-way has to have been under the foot before the move.
    const g = feet(lv, p, Math.max(2, Math.abs(dy)), 2);
    if (g && (!g.oneWay || footBefore <= g.y + 0.5)) land(p, g, down);
  }
}

function groundStep(p: Player, i: Input, xin: number): void {
  if (p.spinning) {
    // Charging bleeds away, so mashing faster is genuinely better than mashing longer.
    p.spinRev -= (Math.floor(p.spinRev * K.spinDrag) / 256) * (STEP * 60);
    if (p.spinRev < 0) p.spinRev = 0;
    if (i.jumpDown) p.spinRev = Math.min(8, p.spinRev + 2);
    if (!i.down) {
      p.gsp = p.facing * (K.spinBase + (Math.floor(p.spinRev) / 2) * K.spinStep);
      p.spinning = false;
      ball(p, true);
    }
    return;
  }

  if (i.jumpDown) {
    if (i.down && Math.abs(p.gsp) < K.rollMin) {
      ball(p, false);
      p.spinning = true;
      p.spinRev = 2;
      return;
    }
    // Jumping is the inverse of the ground projection and respects the angle, so leaving
    // a ramp carries the climb into the air with no special case for it.
    p.vx = p.gsp * Math.cos(p.angle) - K.jumpForce * Math.sin(p.angle);
    p.vy = p.gsp * -Math.sin(p.angle) - K.jumpForce * Math.cos(p.angle);
    p.grounded = false;
    p.jumped = true;
    p.rollJump = p.rolling;
    ball(p, true);
    return;
  }

  if (i.down && Math.abs(p.gsp) >= K.rollMin) ball(p, true);
  if (p.rolling && Math.abs(p.gsp) < K.rollMin) ball(p, false);

  // Pseudo-gravity along the surface. Rolling downhill pays 4x what rolling uphill
  // costs, and that asymmetry is the entire reason to give up steering.
  const s = Math.sin(p.angle);
  const f = !p.rolling ? K.slopeRun : Math.sign(p.gsp) === Math.sign(s) ? K.slopeRollUp : K.slopeRollDown;
  p.gsp -= f * s * STEP;

  const acc = p.rolling ? 0 : K.accel;
  const dec = p.rolling ? K.rollDecel : K.decel;
  const fri = p.rolling ? K.rollFriction : K.friction;
  if (xin && p.gsp !== 0 && Math.sign(xin) !== Math.sign(p.gsp)) {
    p.gsp -= Math.sign(p.gsp) * dec * STEP;
  } else if (xin && Math.abs(p.gsp) < K.topSpeed) {
    p.gsp += xin * acc * STEP;
    if (Math.abs(p.gsp) > K.topSpeed) p.gsp = Math.sign(p.gsp) * K.topSpeed;
  }
  // Rolling keeps bleeding to friction even under input; running only coasts when idle.
  if (!xin || p.rolling) {
    const d = fri * STEP;
    p.gsp = Math.abs(p.gsp) <= d ? 0 : p.gsp - Math.sign(p.gsp) * d;
  }

  // Too slow on something too steep and you lose the floor and the controls both. This
  // is what stops you walking up a wall, and why the verb set needs no wall-jump.
  //
  // Not while a lock is already running, or it re-arms every step: the slope hands you
  // a little downhill speed, the check zeroes it again, and you stand on a 63 degree
  // face forever. The lock has to be allowed to elapse for gravity to do its work.
  if (p.ctrlLock <= 0 && Math.abs(p.angle) >= K.slipAngle && Math.abs(p.gsp) < K.slipSpeed) {
    p.grounded = false;
    p.gsp = 0;
    p.ctrlLock = K.ctrlLock;
  }

  p.vx = p.gsp * Math.cos(p.angle);
  p.vy = p.gsp * -Math.sin(p.angle);
}

function airStep(p: Player, i: Input): void {
  if (p.jumped && !i.jump && p.vy < -K.jumpCut) p.vy = -K.jumpCut;

  // A jump made out of a roll has no steering at all in Sonic 1/2. Committing commits.
  if (!p.rollJump && i.x) {
    const faster = Math.sign(i.x) === Math.sign(p.vx) && Math.abs(p.vx) >= K.topSpeed;
    if (!faster) p.vx += i.x * K.airAccel * STEP;
    if (Math.sign(p.vx) === Math.sign(i.x) && Math.abs(p.vx) > K.topSpeed) {
      p.vx = Math.sign(p.vx) * K.topSpeed;
    }
  }

  p.vy += K.gravity * STEP;
  // Air drag, and only in the last of a rise. It exists so chaining jumps cannot
  // compound horizontal speed forever.
  if (p.vy > -K.jumpCut && p.vy < 0) p.vx -= p.vx * 0.03125 * (STEP * 60);
}

const near = (p: Player, x: number, y: number) => Math.abs(x - p.x) < 8 && Math.abs(y - p.y) < 12;

export function step(p: Player, i: Input, lv: Level, scattered: Ring[]): void {
  p.px = p.x;
  p.py = p.y;
  if (p.done) return;
  p.time += STEP;
  if (p.invuln > 0) p.invuln -= STEP;
  if (p.regrab > 0) p.regrab -= STEP;
  if (i.x) p.facing = i.x;

  // Friction still reacts to input during a control lock; only steering is taken away.
  const xin = p.ctrlLock > 0 ? 0 : i.x;
  if (p.ctrlLock > 0) p.ctrlLock -= STEP;

  if (p.grounded) groundStep(p, i, xin);
  else airStep(p, i);

  if (p.rolling && Math.abs(p.vx) > K.rollCap) p.vx = Math.sign(p.vx) * K.rollCap;

  const dx = p.vx * STEP;
  const dy = p.vy * STEP;
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (TILE - 1)));
  for (let s = 0; s < n; s++) advance(p, lv, dx / n, dy / n, i.down);

  if (p.grounded) p.groundY = p.y;

  const hr = p.rolling ? R.rollH : R.h;
  const wr = p.rolling ? R.rollW : R.w;
  for (const sx of [p.x - wr, p.x + wr]) {
    for (const sy of [p.y - hr, p.y, p.y + hr]) {
      if (tileAt(lv, Math.floor(sx / TILE), Math.floor(sy / TILE)) === SPIKE) hurt(p, lv, scattered);
    }
  }

  for (const r of lv.rings) if (!r.taken && near(p, r.x, r.y)) ((r.taken = true), p.rings++);

  for (let k = scattered.length - 1; k >= 0; k--) {
    const r = scattered[k];
    r.life -= STEP;
    r.vy += K.ringGravity * STEP;
    r.x += r.vx * STEP;
    r.y += r.vy * STEP;
    if (r.vy > 0 && solidAt(lv, r.x, r.y + 4)) {
      r.y = Math.floor((r.y + 4) / TILE) * TILE - 4;
      r.vy *= K.ringBounce;
    }
    if (p.regrab <= 0 && near(p, r.x, r.y)) {
      p.rings++;
      r.life = 0;
    }
    if (r.life <= 0) scattered.splice(k, 1);
  }

  for (const c of lv.checkpoints) {
    if (c.hit || !near(p, c.x, c.y)) continue;
    c.hit = true;
    p.respawnX = c.x;
    p.respawnY = c.y;
  }
  if (lv.goal && near(p, lv.goal.x, lv.goal.y)) p.done = true;

  if (p.y - R.h > lv.h * TILE) kill(p, lv);
}
