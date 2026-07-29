import { Container, Sprite } from "pixi.js";
import type { GlyphSet } from "./gfx/glyphs.ts";
import { PALETTE } from "./tilemap.ts";
import { K, ONEWAY, R, SLOPE0, SOLID, SPIKE, TILE, type Level, type Player, type Ring } from "./sim.ts";

// Sonic 2's camera, plus the one thing Mania added.
//
// The scroll caps are not arbitrary: 180 px/s is exactly the running top speed and
// 480 px/s is exactly the rolling cap, so the camera cannot fall behind by
// construction. That relationship is why they are written as K.* and not as numbers.
const DEAD_X = 4; // half of a 16 Genesis px horizontal window
const AIR_Y = 8; // the player roams this far vertically before the camera follows
const SLOW_AT = 240; // below this, grounded, the camera uses the slow cap
const LEAD_GAIN = 0.1;
const LEAD_MAX = 40; // a quarter of the view - at the roll cap this is the whole budget
const LEAD_RATE = 3; // how fast the look-ahead itself slews, per second

// Indexed by tile value - SLOPE0, so this must stay in sim.ts SLOPE_CHARS order.
const SLOPE_GLYPH = ["🭊", "🬿", "🭈", "🭆", "🭑", "🬽", "🭋", "🭅", "🭀", "🭐"];

export type View = {
  root: Container;
  world: Container;
  head: Sprite;
  body: Sprite;
  ball: Sprite;
  rings: Sprite[];
  scatter: Sprite[];
  camX: number;
  camY: number;
  lead: number;
};

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export function buildView(lv: Level, glyphs: GlyphSet): View {
  const root = new Container();
  const world = new Container();
  root.addChild(world);

  // Built once and never re-flushed. Every glyph shares one atlas, so the whole level
  // is essentially one draw call and the sprite count does not matter.
  const tiles = new Container();
  for (let ty = 0; ty < lv.h; ty++) {
    for (let tx = 0; tx < lv.w; tx++) {
      const t = lv.tiles[ty * lv.w + tx];
      if (!t) continue;
      const glyph =
        t === SOLID ? "▓" : t === ONEWAY ? "▒" : t === SPIKE ? "‸" : SLOPE_GLYPH[t - SLOPE0];
      if (!glyph) continue;
      const s = new Sprite(glyphs[glyph]);
      s.position.set(tx * TILE, ty * TILE);
      // Slopes are ground and take the ground tint - terrain has to read as one surface.
      s.tint = t === ONEWAY ? PALETTE[22] : t === SPIKE ? PALETTE[15] : PALETTE[11];
      tiles.addChild(s);
    }
  }
  world.addChild(tiles);

  const marks = new Container();
  for (const c of lv.checkpoints) {
    const s = new Sprite(glyphs["★"]);
    s.position.set(c.x - TILE / 2, c.y - TILE / 2);
    s.tint = PALETTE[16];
    marks.addChild(s);
  }
  if (lv.goal) {
    const s = new Sprite(glyphs["⌂"]);
    s.position.set(lv.goal.x - TILE / 2, lv.goal.y - TILE / 2);
    s.tint = PALETTE[21];
    marks.addChild(s);
  }
  world.addChild(marks);

  const ring = (): Sprite => {
    const s = new Sprite(glyphs["⊙"]);
    s.tint = PALETTE[17];
    s.roundPixels = true;
    world.addChild(s);
    return s;
  };
  const rings = lv.rings.map((r) => {
    const s = ring();
    s.position.set(r.x - TILE / 2, r.y - TILE / 2);
    return s;
  });
  // One pool, sized to the scatter cap - a hit can never produce more than this.
  const scatter = Array.from({ length: K.ringScatterMax }, () => {
    const s = ring();
    s.visible = false;
    return s;
  });

  const actor = (glyph: string): Sprite => {
    const s = new Sprite(glyphs[glyph]);
    s.roundPixels = true;
    s.tint = PALETTE[19];
    world.addChild(s);
    return s;
  };
  const head = actor("⚉");
  const body = actor("▲");
  const ball = actor("◉");

  return { root, world, head, body, ball, rings, scatter, camX: 0, camY: 0, lead: 0 };
}

export function syncView(
  v: View,
  p: Player,
  lv: Level,
  scattered: Ring[],
  alpha: number,
  dt: number,
  viewW: number,
  viewH: number,
): void {
  const x = p.px + (p.x - p.px) * alpha;
  const y = p.py + (p.y - p.py) * alpha;

  // Ball form is both rolling and jumping, and it is 5px shorter - so the two sprite
  // sets cannot share an anchor. Both hang off the feet, which is what does not move.
  const foot = y + (p.rolling ? R.rollH : R.h);
  const flash = p.invuln > 0 && Math.floor(p.invuln * 30) % 2 === 0;
  v.ball.visible = p.rolling && !flash;
  v.head.visible = v.body.visible = !p.rolling && !flash;
  if (p.rolling) {
    v.ball.position.set(x - TILE / 2, foot - TILE);
  } else {
    // Two glyphs cover 16 of the body's 19px. Anchor at the feet and let the missing
    // 3px come off the top, or the whole character floats above the ground it is on.
    v.head.position.set(x - TILE / 2, foot - TILE * 2);
    v.body.position.set(x - TILE / 2, foot - TILE);
  }

  for (let n = 0; n < v.rings.length; n++) v.rings[n].visible = !lv.rings[n].taken;
  for (let n = 0; n < v.scatter.length; n++) {
    const s = v.scatter[n];
    const r = scattered[n];
    s.visible = !!r;
    if (r) s.position.set(r.x - TILE / 2, r.y - TILE / 2);
  }

  // Look-ahead, the one deviation from Sonic 2. It slews rather than snapping, or
  // turning around whips the whole world across the screen.
  const want = clamp(p.vx * LEAD_GAIN, -LEAD_MAX, LEAD_MAX);
  v.lead += (want - v.lead) * (1 - Math.pow(0.5, dt * LEAD_RATE));

  const fast = !p.grounded || Math.abs(p.gsp) >= SLOW_AT;
  const cap = (fast ? K.rollCap : K.topSpeed) * dt;

  const dx = x - viewW / 2 + v.lead - v.camX;
  if (Math.abs(dx) > DEAD_X) v.camX += Math.sign(dx) * Math.min(Math.abs(dx) - DEAD_X, cap);

  // Grounded the player is pinned to the center line; airborne they roam a window, so
  // a hop does not shake the frame but a real fall is followed.
  const slack = p.grounded ? 0 : AIR_Y;
  const dy = y - viewH / 2 - v.camY;
  if (Math.abs(dy) > slack) v.camY += Math.sign(dy) * Math.min(Math.abs(dy) - slack, cap);

  v.camX = clamp(v.camX, 0, Math.max(0, lv.w * TILE - viewW));
  v.camY = clamp(v.camY, 0, Math.max(0, lv.h * TILE - viewH));

  // The camera stays a float; roundPixels on the sprites keeps edges crisp without
  // juddering the whole world against the pixel grid.
  v.world.position.set(-v.camX, -v.camY);
}
