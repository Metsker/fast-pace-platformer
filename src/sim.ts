// Pure sim. No Pixi imports - this file must stay runnable under plain node.
// World px, floats, fixed 1/120s steps. See DESIGN.md §9 for where the numbers came from.

export const TILE = 8;
export const STEP = 1 / 120;

// Body is smaller than the cell it lives in. An exact 8x8 body needs pixel-perfect
// alignment to clear a 1-tile gap, which at 1600 px/s never happens.
export const BODY = 6;

export const TOP_SPEED = 1000;
export const BASE_SPEED = 700; // the cruise. Running gets you here and no further.

// Tiers are thresholds the readout and the feedback hang off, not caps. With running
// pinned at BASE_SPEED, the tier now reads as "how much the mountain has given you".
// Tier 2 is exactly K.breakAt, so the red tint means "platforms will not hold you".
export const TIER_AT = [0, 800, 900];
export const tierOf = (speed: number) => (speed >= TIER_AT[2] ? 2 : speed >= TIER_AT[1] ? 1 : 0);

export const K = {
  accGround: 2400, // snaps you to BASE_SPEED - speed should feel constant, not earned
  accAir: 1920, // steering authority, not a speed source
  airBase: 240, // in the air you can build up to this and no further, so a standstill jump still moves
  friction: 480, // ground only. air friction is 0, always - that is the "never brake" rule
  overBleed: 600, // above BASE_SPEED, level and rising ground give it back
  fallBoost: 450, // descending in the air adds speed. the drop is the accelerator.
  gravRise: 1100,
  gravFall: 1900,
  fallCap: 150, // the float, when you are slow. leaving the ground means hanging.
  // ...but terminal velocity also scales with how fast you are moving, or a descent
  // cannot be followed: at 900 px/s a 150 px/s fall tracks a 9.5 degree line, and the
  // shallowest ramp on the sheet is 26.6, so you glide over the whole mountain.
  // 1.0 tracks a 45 degree fall line exactly. Lower it and you drift over descents.
  fallTrack: 1.0,
  diveGrav: 7200,
  jumpV: 340, // apex ~6.4 tiles, ~12.8 across both hops
  jumpCut: 0.4,
  airJumps: 1, // refreshed on ground contact only
  coyote: 0.1,
  buffer: 0.08,
  wallJumpV: 240,
  // Punch through a one-way platform instead of landing on it. Set above the 700
  // cruise on purpose: running never breaks anything, only speed the mountain gave you.
  breakAt: 900,
  // How much of a ramp's climb rate carries into the air. A 45 degree ramp is rising at
  // exactly your horizontal speed, so 1.0 is the physical answer and far too much air -
  // this is the knob for how much of the mountain is spent flying.
  launchGain: 0.7,
  // And a ceiling on it, or a 63 degree ramp at top speed fires you off the mountain.
  // Set so it only bites at the very top, otherwise every launch is the same height and
  // arriving faster buys nothing.
  launchCap: 700,
  // How fast the remembered climb rate fades on level ground, px/s². Big enough that
  // you cannot carry a ramp's throw across a shelf to the next ledge.
  climbFade: 6000,
};

const EMPTY = 0;
const SOLID = 1;
const ONEWAY = 2;
const DECOR = 3; // drawn, never collides
export const SLOPE0 = 4; // tile values SLOPE0..SLOPE0+9 index SLOPE_H

// Surface height in px from the tile top, at each of the 9 pixel *edges* x = 0..8.
// Between them the surface is linear, so a ramp is an exact line and consecutive tiles
// join with no seam: every tile's x=8 equals its neighbour's x=0 (DESIGN.md §7).
//
// Edges, not the 8 filled-column heights the glyphs rasterise to. Those are the drawn
// staircase, and standing on them quantises a descent to whole pixels - a 26.6 grade at
// cruise should drop 2.92 px per step and instead drops 3,3,4,2,3, which reads as
// jitter. The collision surface is the line the art approximates, within half a pixel.
//
// 8 means the surface is at the tile's bottom edge, i.e. in the tile below this one.
export const SLOPE_CHARS = "uncCdDAaBb";
export const SLOPE_H: number[][] = [
  [8, 7, 6, 5, 4, 3, 2, 1, 0], // u  45 up
  [0, 1, 2, 3, 4, 5, 6, 7, 8], // n  45 down
  [8, 7.5, 7, 6.5, 6, 5.5, 5, 4.5, 4], // c  26.6 up, left half
  [4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5, 0], // C  26.6 up, right half
  [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4], // d  26.6 down, left half
  [4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8], // D  26.6 down, right half
  [8, 8, 8, 8, 8, 6, 4, 2, 0], // A  63.4 up, upper - empty until x=4
  [8, 6, 4, 2, 0, 0, 0, 0, 0], // a  63.4 up, lower - done by x=4
  [0, 2, 4, 6, 8, 8, 8, 8, 8], // B  63.4 down, upper
  [0, 0, 0, 0, 0, 2, 4, 6, 8], // b  63.4 down, lower
];

export type Level = {
  w: number;
  h: number;
  tiles: Uint8Array;
  intact: Uint8Array; // pristine copy, so a respawn puts broken platforms back
  broken: number[]; // tile indices smashed since the renderer last looked; -1 = all back
  rows: string[]; // kept so the renderer can pick a glyph per decor char
  spawn: { x: number; y: number };
};

export type Player = {
  x: number;
  y: number;
  px: number; // previous position, for the render lerp
  py: number;
  vx: number;
  vy: number;
  grounded: boolean;
  descending: boolean; // lost height last step, on a slope or in the air
  climb: number; // px/s of height *gained* last step while grounded - the ramp launch
  jumped: boolean; // this rise came from the jump button, so the height cut applies
  wall: -1 | 0 | 1;
  coyote: number;
  buffer: number;
  airJumps: number;
  diving: boolean;
  tier: number;
  facing: 1 | -1;
  groundY: number; // last grounded Y, for the camera
  deaths: number;
};

export type Input = {
  x: -1 | 0 | 1;
  down: boolean;
  jump: boolean;
  jumpDown: boolean;
};

// '#' solid, '=' one-way (passable from below), '@' spawn, space empty.
// Anything else is decor: drawn by the renderer, invisible to collision.
export function parseLevel(rows: string[]): Level {
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
  const tiles = new Uint8Array(w * h);
  const spawn = { x: TILE, y: TILE };
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === "@") {
        spawn.x = x * TILE + (TILE - BODY) / 2;
        spawn.y = y * TILE;
      } else if (ch === "#") tiles[y * w + x] = SOLID;
      else if (ch === "=") tiles[y * w + x] = ONEWAY;
      else if (SLOPE_CHARS.includes(ch)) tiles[y * w + x] = SLOPE0 + SLOPE_CHARS.indexOf(ch);
      else if (ch !== " ") tiles[y * w + x] = DECOR;
    }
  });
  return { w, h, tiles, intact: tiles.slice(), broken: [], rows, spawn };
}

export function newPlayer(lv: Level): Player {
  return {
    x: lv.spawn.x,
    y: lv.spawn.y,
    px: lv.spawn.x,
    py: lv.spawn.y,
    vx: 0,
    vy: 0,
    grounded: false,
    descending: false,
    climb: 0,
    jumped: false,
    wall: 0,
    coyote: 0,
    buffer: 0,
    airJumps: K.airJumps,
    diving: false,
    tier: 0,
    facing: 1,
    groundY: lv.spawn.y,
    deaths: 0,
  };
}

// Out of bounds: walls at the sides, open sky above, open void below.
// Falling out of the bottom is the only way to die (DESIGN.md §5).
function tileAt(lv: Level, tx: number, ty: number): number {
  if (tx < 0 || tx >= lv.w) return SOLID;
  if (ty < 0 || ty >= lv.h) return EMPTY;
  return lv.tiles[ty * lv.w + tx];
}

// The body spans [x, x+BODY) in floats, so the last overlapped tile is ceil(edge)-1.
// The integer-grid `edge - 1` trick shrinks the body by a pixel here and lets a body
// resting exactly on a surface fall through it.
// Only SOLID counts: one-way tiles never block sideways movement or a ceiling.
function hits(lv: Level, x: number, y: number): boolean {
  const x0 = Math.floor(x / TILE);
  const x1 = Math.ceil((x + BODY) / TILE) - 1;
  const y0 = Math.floor(y / TILE);
  const y1 = Math.ceil((y + BODY) / TILE) - 1;
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) if (tileAt(lv, tx, ty) === SOLID) return true;
  }
  return false;
}

// A one-way tile catches a downward move only when the feet were above its surface
// beforehand - so you rise straight through it and land on top coming down.
function oneWaySurface(lv: Level, x: number, prevBottom: number, bottom: number): number | null {
  if (bottom <= prevBottom) return null;
  const x0 = Math.floor(x / TILE);
  const x1 = Math.ceil((x + BODY) / TILE) - 1;
  for (let ty = Math.floor(prevBottom / TILE); ty <= Math.floor(bottom / TILE); ty++) {
    const surface = ty * TILE;
    if (prevBottom > surface || bottom < surface) continue;
    for (let tx = x0; tx <= x1; tx++) if (tileAt(lv, tx, ty) === ONEWAY) return surface;
  }
  return null;
}

// Surface Y of a slope tile at a world x, or null if the tile is empty there.
function slopeSurfaceY(lv: Level, tx: number, ty: number, worldX: number): number | null {
  const idx = tileAt(lv, tx, ty) - SLOPE0;
  if (idx < 0 || idx >= SLOPE_H.length) return null;
  const fx = Math.min(TILE, Math.max(0, worldX - tx * TILE));
  const i = Math.min(TILE - 1, Math.floor(fx));
  const H = SLOPE_H[idx];
  const h = H[i] + (H[i + 1] - H[i]) * (fx - i);
  return h >= TILE ? null : ty * TILE + h;
}

// The slope surface near the feet, within `above` px over them and `below` px under.
// One function covers all three cases: climbing (surface above the feet), landing
// (surface at them), and staying attached down a descent (surface just below).
//
// Sampled across the body's whole footprint, not just its centre: the body is 6px wide
// on 8px tiles, so its leading edge reaches into the next column while its centre is
// still in this one. Sampling the centre alone lets that edge catch the rock under the
// ramp's next step. The highest surface wins - that is the one you are standing on.
//
// The right sample has to be the last point *inside* [x, x+BODY), because that is the
// span hits() tests. At x+BODY-1 it falls a pixel short, so the lift clears a column
// the AABB then collides with - which stops a climb dead as soon as x is fractional.
function slopeNear(lv: Level, x: number, bottom: number, above: number, below: number): number | null {
  let best: number | null = null;
  for (const sx of [x, x + BODY / 2, x + BODY - 1e-3]) {
    const tx = Math.floor(sx / TILE);
    for (let ty = Math.floor((bottom - above) / TILE); ty <= Math.floor((bottom + below) / TILE); ty++) {
      const s = slopeSurfaceY(lv, tx, ty, sx);
      if (s === null || s < bottom - above || s > bottom + below) continue;
      if (best === null || s < best) best = s;
    }
  }
  return best;
}

function moveX(p: Player, d: number, lv: Level): void {
  if (d === 0) return;
  const fromY = p.y;
  p.x += d;

  // Ride up the ramp before testing walls. The rock under a ramp is solid, so without
  // this the tile beneath the ramp's next step reads as a wall and stops the climb
  // dead. The lift allowance is exactly what the steepest gradient (2:1) could have
  // risen over this move, so it can never be used to mount a sheer ledge.
  const lift = slopeNear(lv, p.x, p.y + BODY, Math.abs(d) * 2 + 2, 0);
  if (lift !== null && lift - BODY < p.y) {
    p.y = lift - BODY;
    if (p.vy > 0) p.vy = 0;
    p.grounded = true;
  }

  if (!hits(lv, p.x, p.y)) return;
  p.y = fromY;
  p.x = d > 0 ? Math.floor((p.x + BODY) / TILE) * TILE - BODY : Math.floor(p.x / TILE) * TILE + TILE;
  p.vx = 0;
}

function land(p: Player, surface: number): void {
  p.y = surface - BODY;
  p.vy = 0;
  p.grounded = true;
  p.groundY = p.y;
}

// Knock out the one-way tiles directly under the body, and only those - the rest of the
// ledge stays up, so the hole is a record of the line you took through it.
function smash(lv: Level, x: number, ty: number): void {
  const x1 = Math.ceil((x + BODY) / TILE) - 1;
  for (let tx = Math.floor(x / TILE); tx <= x1; tx++) {
    const idx = ty * lv.w + tx;
    if (lv.tiles[idx] !== ONEWAY) continue;
    lv.tiles[idx] = EMPTY;
    lv.broken.push(idx);
  }
}

function moveY(p: Player, d: number, lv: Level): void {
  if (d === 0) return;
  const prevBottom = p.y + BODY;
  p.y += d;

  if (d > 0) {
    const surface = oneWaySurface(lv, p.x, prevBottom, p.y + BODY);
    // Fast enough and the platform gives way instead of catching you. The cost is not
    // the break - it is that you can no longer use the ledge as a shelf to bleed on.
    if (surface !== null) {
      if (Math.abs(p.vx) < K.breakAt) return land(p, surface);
      smash(lv, p.x, surface / TILE);
    }
  }

  if (!hits(lv, p.x, p.y)) return;
  if (d > 0) land(p, Math.floor((p.y + BODY) / TILE) * TILE);
  else {
    p.y = Math.floor(p.y / TILE) * TILE + TILE;
    p.vy = 0;
  }
}

export function respawn(p: Player, lv: Level): void {
  p.x = p.px = lv.spawn.x;
  p.y = p.py = lv.spawn.y;
  p.vx = p.vy = 0;
  p.climb = 0;
  p.jumped = false;
  p.tier = 0;
  p.airJumps = K.airJumps;
  p.groundY = lv.spawn.y;
  p.deaths++;
  lv.tiles.set(lv.intact);
  lv.broken.push(-1);
}

export function step(p: Player, i: Input, lv: Level): void {
  p.px = p.x;
  p.py = p.y;

  p.coyote = p.grounded ? K.coyote : Math.max(0, p.coyote - STEP);
  p.buffer = i.jumpDown ? K.buffer : Math.max(0, p.buffer - STEP);
  if (i.x) p.facing = i.x;

  // Jump, wall-jump, air jump. All three feed one gate, in that priority.
  const wallJump = !p.grounded && p.wall !== 0;
  if (p.buffer > 0 && (p.coyote > 0 || wallJump || p.airJumps > 0)) {
    const fromGround = p.coyote > 0;
    const fromWall = !fromGround && wallJump;
    p.buffer = 0;
    p.coyote = 0;
    p.grounded = false;
    p.jumped = true;
    p.vy = -K.jumpV; // sets, never adds, so a late air jump is worth as much as an early one
    // Preserves horizontal speed, kicked away from the wall.
    if (fromWall) p.vx = -p.wall * Math.max(Math.abs(p.vx), K.wallJumpV);
    if (!fromGround && !fromWall) p.airJumps--;
  }

  p.diving = !p.grounded && i.down;

  // Horizontal. Running takes you to BASE_SPEED and stops - the cruise is meant to feel
  // constant. Everything above it is given by the mountain, not earned by the legs.
  const speed = Math.abs(p.vx);
  const ceiling = p.grounded ? BASE_SPEED : K.airBase;
  if (i.x) {
    const opposing = p.vx !== 0 && Math.sign(i.x) !== Math.sign(p.vx);
    const climbing = !opposing && speed < ceiling;
    if (opposing || climbing) p.vx += i.x * (p.grounded ? K.accGround : K.accAir) * STEP;
    // Land exactly on the ceiling rather than stepping past it, or the cruise ripples
    // against the bleed instead of holding a number.
    if (climbing && Math.abs(p.vx) > ceiling) p.vx = Math.sign(p.vx) * ceiling;
  } else if (p.grounded) {
    const d = K.friction * STEP;
    p.vx = speed <= d ? 0 : p.vx - Math.sign(p.vx) * d;
  }

  // Falling is the accelerator. A long float off a cliff pays more than a short dive,
  // because the boost is per second of descent - so height is the thing worth having.
  if (!p.grounded && p.vy > 0) p.vx += p.facing * K.fallBoost * STEP;
  // Level and rising ground give it back; losing height never does. That one condition
  // covers slopes and falls alike - a descent holds what it earned, and only flat land
  // or a climb reclaims it. Without it the mountain drains the speed it just handed you.
  if (p.grounded && !p.descending && Math.abs(p.vx) > BASE_SPEED) {
    p.vx -= Math.sign(p.vx) * K.overBleed * STEP;
  }

  if (Math.abs(p.vx) > TOP_SPEED) p.vx = Math.sign(p.vx) * TOP_SPEED;

  // Vertical. Three regimes: rising, floating, diving. The dive spends altitude to end
  // the hang early - which is what gets you back to the ground, where speed grows.
  if (p.diving) {
    p.vy += K.diveGrav * STEP;
  } else if (p.vy < 0) {
    p.vy += K.gravRise * STEP;
    // Variable jump height, and only for actual jumps - a ramp launch is not something
    // the player is holding a button for, and cutting it would clamp 600 px/s to 136.
    if (p.jumped && !i.jump) p.vy = Math.max(p.vy, -K.jumpV * K.jumpCut);
  } else {
    p.vy += K.gravFall * STEP;
    const cap = Math.max(K.fallCap, Math.abs(p.vx) * K.fallTrack);
    if (p.vy > cap) p.vy = cap;
  }

  // Substep so nothing crosses a whole tile in one move (TECH.md §4). A sustained
  // dive is the only thing that gets near it, but it gets there fast.
  const dx = p.vx * STEP;
  const dy = p.vy * STEP;
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (TILE - 1)));
  const wasGrounded = p.grounded;
  p.grounded = false;
  for (let s = 0; s < n; s++) {
    moveX(p, dx / n, lv);
    moveY(p, dy / n, lv);
    // Slope attachment. The reach below scales with how far this substep moved
    // horizontally, times the steepest gradient the sheet has (2:1) - so a descent
    // is followed instead of launched off, but a real cliff still drops you.
    if (p.vy >= 0) {
      const reach = wasGrounded || p.grounded ? Math.abs(dx / n) * 2 + 2 : 0;
      const surf = slopeNear(lv, p.x, p.y + BODY, TILE, reach);
      // Never sink the body into rock. Where a shelf meets a downslope the ramp's
      // surface is a fraction of a pixel below the shelf, and dropping onto it wedges
      // the body against the shelf tile it just left - the run stops dead.
      if (surf !== null && !hits(lv, p.x, surf - BODY)) {
        p.y = surf - BODY;
        p.vy = 0;
        p.grounded = true;
      }
    }
  }
  // Off the lip of a ramp, keep climbing. Attachment pins vy to 0 on every grounded
  // step, so the climb rate lives only in the position delta - without carrying it into
  // the air you walk off the top of a ramp with nothing and simply drop.
  //
  // The altitude is the real gift, not the height itself. The fall boost pays per second
  // of descent (§1), so a launch is speed banked as height and handed back with interest
  // on the way down. That is what makes a ramp a momentum feature rather than a bump.
  if (wasGrounded && !p.grounded && p.climb > 0) {
    p.vy = -Math.min(p.climb * K.launchGain, K.launchCap);
    p.jumped = false;
  }

  if (p.grounded) {
    p.groundY = p.y;
    p.airJumps = K.airJumps;
  }

  p.wall = hits(lv, p.x + 1, p.y) ? 1 : hits(lv, p.x - 1, p.y) ? -1 : 0;
  p.tier = tierOf(Math.abs(p.vx));
  p.descending = p.y > p.py + 0.01; // read by the next step's bleed

  // The recent peak climb, not just the last step's. Coming off a lip the body sinks for
  // a step or two - its leading edge leaves the ramp first, so the lower trailing surface
  // takes over - and that artifact reads as "not climbing" at exactly the moment of
  // takeoff, which is the one moment the launch needs the number.
  p.climb = p.grounded ? Math.max((p.py - p.y) / STEP, p.climb - K.climbFade * STEP) : 0;

  if (p.y > lv.h * TILE) respawn(p, lv);
}
