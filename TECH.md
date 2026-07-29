# Technical foundation

Decisions made before the game design round. The purpose of this document is to
tell the design round what is cheap, what is expensive, and what is fixed.

Stack: PixiJS v8 + Vite + TypeScript, same as the neighboring `necromancer` project.

## 1. The core call: keep the glyphs, drop the grid

`necromancer` conflates two things. Only one of them ports to a platformer.

**Ported: the glyph atlas.** `src/gfx/glyphs.ts` (34 lines) loads the 8x8
dungeon-mode sheet, rewrites luminance into the alpha channel so `tint` works,
and returns `Record<char, Texture>`. It is renderer-agnostic - it only makes
textures. Comes with a 16x16 glyph sheet and a 24-color palette.

**Not ported: `Grid`.** It snaps every drawable to an integer cell and repaints
every cell every frame. Correct for a turn-based roguelike. Wrong here for one
reason: a jump arc quantized to 8px steps reads as a teleporting elevator, not a
jump. That is the clunkiness risk, and it comes from `put(x, y)` taking integers,
not from the glyphs themselves.

The fix is to split by **what moves**:

| Layer | Positions | Redraw |
|---|---|---|
| Level geometry | integer cells | built once per level, never re-flushed |
| Entities (player, enemies, shots, particles) | **float** world pixels | per frame |
| HUD | integer cells | on change |

Entities use the same textures as the tiles. Same art, free movement.

## 2. Units and the coordinate system

One set of units everywhere. No implicit conversions.

```
TILE   = 8       world px per tile, fixed by the font sheet
VIEW   = 384 x 216 world px  ->  48 x 27 tiles, exactly 16:9
SCALE  = integer, chosen at resize: floor(min(w/384, h/216)), min 1
```

384 and 216 are both divisible by 8, so the viewport is a whole number of tiles
in both axes. At `SCALE=5` that is 1920x1080; at 4x, 1536x864.

- Sim works in **world px, floats**. Velocity in world px per second.
- Rendering scales the whole world container by `SCALE`. Nothing else knows about it.
- `scaleMode: "nearest"` on the atlas, `image-rendering: pixelated` on the canvas.
- `roundPixels: true` on entity sprites: this snaps to *screen* pixels (1px at
  scale 1), not to cells (8px). Motion stays smooth, edges stay crisp.

**Design consequence:** the screen holds 48x27 glyphs. A one-glyph character is
1/48 of the screen width. A 1x2 glyph character (8x16) reads better as a
humanoid and is the recommended default - decide this in the design round.

## 3. Fixed timestep, interpolated render

A fast platformer lives or dies on consistent feel. Frame-rate-dependent physics
means the jump height changes on a 144Hz monitor.

```
STEP = 1/120 s      sim tick
accumulator += min(deltaMS, 250ms)   clamp, so a tab-switch does not spiral
while (accumulator >= STEP) { step(); accumulator -= STEP }
render(alpha = accumulator / STEP)   lerp entity sprites between prev and current
```

120Hz sim, not 60: it halves the per-step movement, which directly raises the
speed ceiling in §4, and it makes input latency one frame tighter.

Keep `step()` free of any Pixi import. It is pure `state -> state`. That makes it
testable headless with a plain `assert` script, the same way `necromancer` checks
its sim.

## 4. Collision, and the speed ceiling

Tile-based AABB against the level array. The simplest collision there is, and the
tile array already exists for rendering.

Per step, resolve **one axis at a time** - X first, then Y. Axis-separated
resolution is what makes wall-sliding and ledge behavior feel right; solving both
at once produces corner snags.

**Tunneling is the one real constraint.** A body moving more than `TILE` in a
single step can pass through a wall without ever overlapping it. Rule:

```
if (|dx| or |dy| > TILE) substep the move into ceil(max/TILE) pieces
```

At `STEP = 1/120` and `TILE = 8`, an entity crosses a tile per step at
**960 world px/s = 120 tiles/s**. Anything under that never substeps. That is
already very fast - a screen-width dash in 0.4s. Faster things (hitscan shots,
teleports) should be a raycast against the tile array, not a moving body.

**Design consequence:** speeds up to 120 tiles/s are free. Beyond that, say so
and it becomes a raycast instead.

## 5. Level format

Levels are ASCII, authored as a string array in a `.ts` file. Editable in a text
editor, diffable in git, no tooling.

```ts
const LEVEL = [
  "################",
  "#..............#",
  "#....@.....o...#",
  "#...####.......#",
  "################",
];
```

A legend maps each char to `{ glyph, solid, tint }` - so the authoring character
and the rendered glyph are decoupled, and `#` can render as `▓` or `▛` by
context. Entity spawns (`@`, `o`) are read out of the same string at load and
removed from the collision array.

Build the tile layer into a `Container` once at load. Do not rebuild per frame.

## 6. Camera

The camera is the world container's inverse position - one assignment, no camera class.

```
world.position.set(-camX * SCALE, -camY * SCALE)
```

Follow with a deadzone rectangle plus a smoothed lerp, clamped to level bounds.
Camera position stays a float and is *not* rounded, or the whole world judders
against the pixel grid at low speeds; `roundPixels` on the sprites handles crispness.

## 7. Rendering cost

Every glyph shares one atlas `TextureSource`, so Pixi v8 batches the entire scene
into essentially one draw call. Sprite count is not the bottleneck - a full
48x27 screen of tiles is 1296 sprites, which is nothing.

Practical budgets, generous rather than tight:

| Thing | Budget |
|---|---|
| Visible tiles | 1296 (the whole screen) |
| Entities | low thousands before anything is measurable |
| Particles | use `ParticleContainer` past ~2000 |

**Design consequence:** do not design around a sprite budget. Bullet hell,
crumbling terrain, thick particle work are all affordable.

## 8. Assets

Copy `necromancer/dungeonmode/` wholesale, plus `scripts/gen-tilemap.mjs` which
derives `src/tilemap.ts` (the char->coordinate map, the sheet layout, the
palette) from the pack. Same pack, same terms as in `necromancer` - nothing new
is introduced.

Needed from the pack:
- `playscii/charsets/dungeon-mode.png` - the 128x128 sheet, 16x16 glyphs of 8px
- `playscii/charsets/dungeon-mode.char` - the char-to-cell mapping
- `rexpaint/data/palettes/dungeon-pal.txt` - 24 colors

Palette is 24 colors and tinting is per-sprite, so color is free. Use it for
readability: hazards, pickups, and enemies should be separable by hue alone.

### No mapping work is needed

`TILE_MAP` is generated from the pack's own `.char` file and is keyed by
**Unicode character**, not by index. Authoring is `put('▓')`, never `put(11, 2)`.

### But the names are approximate - verify before committing a glyph

The character keying the cell describes the author's *intent*; the pixels
sometimes say otherwise. Verified by cropping cells straight out of the sheet:

| Key | Actually drawn |
|---|---|
| `█ ░ ▒ ▓ ▄ ▐` | as named - solid, three hatch densities, half-blocks |
| `▛ ▜ ▙ ▟` | **not** quadrant blocks - diagonal hatch fills |
| `▔ ▁ ▏ ▕` | thin edges, but not always on the edge the name implies |
| `╱ ╲` | shallow slopes, not 45 degrees |

Rule: crop the cell and look at it before putting a glyph in a level legend.
One command, ~30 seconds:

```sh
magick dungeon-mode.png -crop 8x8+<x>+<y> +repage -filter point -resize 1600% out.png
```

### The sheet ships joinable slope pieces

The most useful discovery for a platformer. Sheet rows 8 and 9, columns 6-9
(`🭋 🭀 🭊 🬿` over `🭅 🭐 🭈 🭆`) are **not** standalone glyphs - they are corner
pieces that mate into 2-cell-tall ramps at two gradients, roughly 45 and 26
degrees. Placed adjacently they read as one continuous slope.

**Design consequence:** ramps are available as art for free. Whether they are
also *walkable* slopes is a separate and much larger cost - slope collision is a
real feature, not a tile lookup. Decide in the design round; if slopes are
decorative only, §4 stays as written.

## 9. Project layout

```
index.html          canvas host, pixelated rendering, dark background
scripts/gen-tilemap.mjs   copied from necromancer
src/tilemap.ts      GENERATED - TILE, TILE_MAP, SHEET, PALETTE
src/gfx/glyphs.ts   copied from necromancer, unchanged
src/main.ts         Application init, ticker, resize -> SCALE
src/sim/*.ts        pure, no Pixi imports, headless-testable
src/render/*.ts     sim state -> sprites
src/levels/*.ts     ASCII level strings + legend
```

Expose the `Application` on `window` in dev so Playwright can inspect the live
scene graph.

## 10. Deliberately skipped

| Skipped | Add when |
|---|---|
| CRT filter (`necromancer/src/gfx/crt.ts`) | the game is fun; it is a one-line filter at the end |
| `Surface` / `inset` abstraction | never - it exists to stub a grid renderer we are not using |
| Level editor | hand-editing ASCII stops being tolerable |
| Spritesheet packer, asset bundles | one atlas, loaded directly, needs neither |
| Entity component system | there are enough entity *kinds* that a switch hurts |
| Object pooling | allocation shows up in a profile |

## Open questions for the design round

1. Character size: 1x1 glyph (8x8) or 1x2 (8x16)? Affects platform spacing and
   how readable the character is.
2. Does anything need to exceed 120 tiles/s? If yes it becomes a raycast, which
   rules out it having a physical body.
3. Is the level a single screen, a scrolling stage, or screen-flipped rooms?
   Single-screen means the camera section is dead code and gets deleted.
4. Any destructible or moving terrain? Static tiles are built once; either of
   those makes the tile layer partially dynamic.
5. Are slopes walkable, or decoration? The art is free either way; walkable
   slopes are the single most expensive thing on this list.
