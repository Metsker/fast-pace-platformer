import { Container, Sprite } from "pixi.js";
import type { GlyphSet } from "./gfx/glyphs.ts";
import { PALETTE } from "./tilemap.ts";
import { K, ONEWAY, R, SLOPE0, SOLID, SPIKE, TILE, type Level, type Player, type Ring } from "./sim.ts";
import { follow, newCam, type Cam } from "./camera.ts";

// Indexed by tile value - SLOPE0, so this must stay in sim.ts SLOPE_CHARS order.
const SLOPE_GLYPH = ["🭊", "🬿", "🭈", "🭆", "🭑", "🬽", "🭋", "🭅", "🭀", "🭐"];

export type View = {
  root: Container;
  world: Container;
  tiles: Container;
  // Indexed by ty * lv.w + tx, so the editor can replace one cell's sprite. Rebuilding
  // the whole act instead measured 31ms - a 32fps drag, which is not a drag.
  tileSprites: (Sprite | undefined)[];
  glyphs: GlyphSet;
  head: Sprite;
  body: Sprite;
  ball: Sprite;
  rings: Sprite[];
  scatter: Sprite[];
  cam: Cam;
};

function tileSprite(glyphs: GlyphSet, t: number): Sprite | undefined {
  const glyph =
    t === SOLID ? "▓" : t === ONEWAY ? "▒" : t === SPIKE ? "‸" : SLOPE_GLYPH[t - SLOPE0];
  if (!glyph) return undefined;
  const s = new Sprite(glyphs[glyph]);
  // Slopes are ground and take the ground tint - terrain has to read as one surface.
  s.tint = t === ONEWAY ? PALETTE[22] : t === SPIKE ? PALETTE[15] : PALETTE[11];
  return s;
}

// Repaint one cell from lv.tiles. Only valid while lv.w is unchanged, which is why the
// editor still re-parses when a paint lands past the level's own edge.
export function setTile(v: View, lv: Level, tx: number, ty: number): void {
  const i = ty * lv.w + tx;
  v.tileSprites[i]?.destroy(); // destroy() unparents, so the container stays clean
  const s = tileSprite(v.glyphs, lv.tiles[i]);
  v.tileSprites[i] = s;
  if (s) {
    s.position.set(tx * TILE, ty * TILE);
    v.tiles.addChild(s);
  }
}

export function buildView(lv: Level, glyphs: GlyphSet): View {
  const root = new Container();
  const world = new Container();
  root.addChild(world);

  // Every glyph shares one atlas, so the whole level is essentially one draw call and
  // the sprite count does not matter.
  const tiles = new Container();
  const tileSprites: (Sprite | undefined)[] = new Array(lv.w * lv.h);
  for (let ty = 0; ty < lv.h; ty++) {
    for (let tx = 0; tx < lv.w; tx++) {
      const i = ty * lv.w + tx;
      const s = tileSprite(glyphs, lv.tiles[i]);
      if (!s) continue;
      s.position.set(tx * TILE, ty * TILE);
      tileSprites[i] = s;
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

  return { root, world, tiles, tileSprites, glyphs, head, body, ball, rings, scatter, cam: newCam() };
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

  follow(v.cam, p, x, y, lv, viewW, viewH, dt);

  // The camera stays a float; roundPixels on the sprites keeps edges crisp without
  // juddering the whole world against the pixel grid.
  v.world.position.set(-v.cam.x, -v.cam.y);
}
