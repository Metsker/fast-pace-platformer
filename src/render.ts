import { Container, Sprite } from "pixi.js";
import type { GlyphSet } from "./gfx/glyphs.ts";
import { PALETTE } from "./tilemap.ts";
import { BODY, SLOPE0, STEP, TILE, type Level, type Player } from "./sim.ts";

const TRAIL_N = 6;
const TRAIL_GAP = 4; // sim steps between ghosts

// white -> amber -> red. Tier is meant to be readable from color alone (DESIGN.md §1).
const TIER_TINT = [PALETTE[23], PALETTE[16], PALETTE[15]];

const CAM_GAIN = 0.35;
const CAM_GAIN_Y = 0.1;
// Look-ahead ceilings as a fraction of the view, so changing the zoom keeps the feel.
const CAM_LEAD_X = 0.4;
const CAM_LEAD_Y = 0.45;

// The six filled ramp types the sheet ships: three gradients, two directions each.
// Verified by cropping the cells, not by trusting the glyph names - TECH.md §8 warns
// that `╱ ╲` are 26.6 degrees and half a cell tall, and that `▛ ▜ ▙ ▟` are dither.
// Indexed by tile value - SLOPE0, so this must stay in the same order as
// sim.ts SLOPE_CHARS / SLOPE_H: "uncCdDAaBb".
const SLOPE_GLYPH = ["🭊", "🬿", "🭈", "🭆", "🭑", "🬽", "🭋", "🭅", "🭀", "🭐"];

// Non-colliding scenery. Nothing uses this yet; it is what the slope gallery was.
const DECOR_GLYPH: Record<string, string> = {};

export type View = {
  root: Container; // holds the integer world scale
  world: Container; // holds the camera offset, in world px
  player: Sprite;
  trail: Sprite[];
  hist: number[]; // flat [x, y, ...], most recent first
  deaths: number; // last seen, so a respawn can drop the history instead of streaking
  camX: number;
  camY: number;
  fallRate: number; // smoothed height loss, px/s
  tileSprite: Map<number, Sprite>; // tile index -> sprite, for knocking platforms out
  hidden: Sprite[]; // what is currently smashed, so a respawn can put it back
};

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export function buildView(lv: Level, glyphs: GlyphSet): View {
  const root = new Container();
  const world = new Container();
  root.addChild(world);

  // Built once, never re-flushed. Breaking a platform hides one sprite by index rather
  // than rebuilding anything, which is why tileSprite exists.
  const tileSprite = new Map<number, Sprite>();
  // Solid and one-way are the same hatch family at different densities - ▓ is 75% of
  // the cell, ▒ is 50% - so "lighter" reads as "less solid". Cool blue for one-way
  // keeps them clear of the player's warm white/amber/red ramp.
  const tiles = new Container();
  for (let ty = 0; ty < lv.h; ty++) {
    for (let tx = 0; tx < lv.w; tx++) {
      const t = lv.tiles[ty * lv.w + tx];
      if (!t) continue;
      // Slopes are ground, so they take the ground tint - the terrain has to read as
      // one surface. Decor stays green to mean "this does not collide".
      const glyph =
        t === 1 ? "▓" : t === 2 ? "▒" : t >= SLOPE0 ? SLOPE_GLYPH[t - SLOPE0] : DECOR_GLYPH[lv.rows[ty][tx]];
      if (!glyph) continue;
      const s = new Sprite(glyphs[glyph]);
      s.position.set(tx * TILE, ty * TILE);
      s.tint = t === 2 ? PALETTE[22] : t === 3 ? PALETTE[21] : PALETTE[11];
      if (t === 2) tileSprite.set(ty * lv.w + tx, s); // only one-ways ever break
      tiles.addChild(s);
    }
  }
  world.addChild(tiles);

  const trail: Sprite[] = [];
  for (let n = 0; n < TRAIL_N; n++) {
    const s = new Sprite(glyphs["◉"]);
    s.roundPixels = true;
    s.alpha = 0;
    trail.push(s);
    world.addChild(s);
  }

  const player = new Sprite(glyphs["◉"]);
  player.roundPixels = true;
  world.addChild(player);

  return { root, world, player, trail, hist: [], deaths: 0, camX: 0, camY: 0, fallRate: 0, tileSprite, hidden: [] };
}

export function pushTrail(v: View, p: Player): void {
  // A respawn teleports to the summit; keeping the history would draw a ghost line all
  // the way back down the mountain until the buffer refilled.
  if (p.deaths !== v.deaths) {
    v.deaths = p.deaths;
    v.hist.length = 0;
  }
  v.hist.unshift(p.x, p.y);
  // +2 samples: the oldest ghost interpolates between TRAIL_N * TRAIL_GAP and the
  // sample behind it, so the buffer has to hold that one too.
  v.hist.length = Math.min(v.hist.length, (TRAIL_N * TRAIL_GAP + 2) * 2);
}

export function syncView(
  v: View,
  p: Player,
  alpha: number,
  dt: number,
  lv: Level,
  viewW: number,
  viewH: number,
): void {
  // Platforms the sim knocked out since the last frame. -1 means a respawn put the
  // mountain back.
  for (const idx of lv.broken) {
    if (idx < 0) {
      for (const s of v.hidden) s.visible = true;
      v.hidden.length = 0;
      continue;
    }
    const s = v.tileSprite.get(idx);
    if (!s || !s.visible) continue;
    s.visible = false;
    v.hidden.push(s);
  }
  lv.broken.length = 0;

  const x = p.px + (p.x - p.px) * alpha;
  const y = p.py + (p.y - p.py) * alpha;

  // The sprite is 8x8 over a 6x6 body, so it overhangs by a pixel on each side.
  v.player.position.set(x - (TILE - BODY) / 2, y - (TILE - BODY) / 2);
  v.player.tint = TIER_TINT[p.tier];

  // Ghosts interpolate on the same alpha as the player. Reading raw history instead pins
  // them to sim-step boundaries while the player and the camera both move in render
  // time, so at a dead-constant 700 px/s the gap to the last ghost still swung 135-191px.
  // Same lerp, one sample older: hist[i] is the newer of the pair, hist[j] the older.
  for (let n = 0; n < v.trail.length; n++) {
    const i = (n + 1) * TRAIL_GAP * 2;
    const j = i + 2;
    const s = v.trail[n];
    if (j + 1 >= v.hist.length) {
      s.alpha = 0;
      continue;
    }
    const gx = v.hist[j] + (v.hist[i] - v.hist[j]) * alpha;
    const gy = v.hist[j + 1] + (v.hist[i + 1] - v.hist[j + 1]) * alpha;
    s.position.set(gx - (TILE - BODY) / 2, gy - (TILE - BODY) / 2);
    s.tint = TIER_TINT[p.tier];
    s.alpha = 0.5 * (1 - n / v.trail.length);
  }

  // Look-ahead scaled by velocity: at 960 px/s a centered camera leaves 0.2s of
  // reaction time, which is roughly nothing. Snap forward fast, drift back slow.
  const leadX = viewW * CAM_LEAD_X;
  const targetX = x + BODY / 2 - viewW / 2 + clamp(p.vx * CAM_GAIN, -leadX, leadX);

  // Look-ahead comes from height loss, not p.vy: on a slope the attachment zeroes vy
  // every step, so vy says "not falling" at 600 px/s downhill. Smoothed, because the
  // raw per-step delta is a staircase - the slope table is integer px per column, so
  // one step drops 3px and the next 5 - and syncView samples only the last sim step.
  v.fallRate += (Math.max(0, (p.y - p.py) / STEP) - v.fallRate) * (1 - Math.pow(1 - 0.12, dt * 60));
  const fall = clamp(v.fallRate * CAM_GAIN_Y, 0, viewH * CAM_LEAD_Y);

  // Anchor to the last ground so hops do not shake the frame, but follow the player
  // down the moment they are below it. groundY is a raw sim value while y is
  // interpolated, so it is shifted into the same timebase - otherwise the anchor wins
  // every grounded frame and the camera steps in whole sim ticks, 8px at a time.
  const anchorY = Math.max(p.groundY - (p.y - y), y);
  const targetY = anchorY + BODY / 2 - viewH / 2 + fall;

  const forward = Math.sign(targetX - v.camX) === Math.sign(p.vx || 1);
  v.camX += (targetX - v.camX) * (1 - Math.pow(1 - (forward ? 0.2 : 0.06), dt * 60));
  v.camY += (targetY - v.camY) * (1 - Math.pow(1 - 0.2, dt * 60));

  const worldW = lv.w * TILE;
  const worldH = lv.h * TILE;
  v.camX = clamp(v.camX, 0, Math.max(0, worldW - viewW));
  v.camY = worldH > viewH ? clamp(v.camY, 0, worldH - viewH) : (worldH - viewH) / 2;

  // Camera stays a float. roundPixels on the sprites keeps edges crisp without
  // juddering the whole world against the pixel grid (TECH.md §6).
  v.world.position.set(-v.camX, -v.camY);
}
