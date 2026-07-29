# Design

A rough Sonic 2 clone. Decisions from the design round, kept current with what is
actually built. Pairs with SONIC2.md (what Sonic 2 actually does, researched),
TECH.md (what is cheap) and RESEARCH.md (what other fast games did).

The previous game - a descent down a mountain at a 700 px/s cruise - is at commit
`84c81dd`. Nothing of its movement model survives.

## 0. The one decision everything hangs off

**1 glyph = 1 Genesis 16px collision block.**

Every constant in §3 is denominated in it. It fixes the character at 1x2 glyphs
(TECH.md Q1, answered), the view at 20x14 glyphs, one ASCII character per collision
block, and the top speed at 180 px/s. Change it and every number below moves.

The alternative - 1 glyph = 1 Genesis 8px hardware pattern - keeps the SPG constants
unconverted and draws curves twice as smoothly, but makes the character 2x5 glyphs and
puts the rolling cap at exactly the 960 px/s no-substep ceiling of TECH.md §4.

## 1. Speed is a scalar along a surface angle

Sonic is not a velocity platformer, and this is the whole of it:

```
gsp -= slopeFactor * sin(angle)          // pseudo-gravity along the floor
vx  =  gsp * cos(angle)
vy  =  gsp * -sin(angle)
```

While grounded there is one number, `gsp`, and `vx`/`vy` are derived from it. On landing
they collapse back into one, and the exchange rate is the angle you land at:

| Landing angle | New ground speed |
|---|---|
| flat, within 23 deg | `vx` - everything vertical is thrown away |
| slope, within 45 deg | `vy * 0.5 * -sign(sin(angle))` |
| steep, past 45 deg | `vy * -sign(sin(angle))` - the full fall becomes run speed |

That table is why height is currency. It is also why the ramp launch needed no feature:
jumping subtracts `jumpForce` along the *surface normal*, so leaving an up-ramp carries
the climb into the air by construction. The old build's §4b - `climb`, `climbFade`,
`launchGain`, `launchCap`, and the fading-peak hack that made it work - is all deleted,
and nothing was lost.

## 2. Running is slow; rolling is the game

Three numbers that read wrong until you play them:

1. **2.13 seconds to reach top speed**, and top speed is only 180 px/s. Deceleration is
   11x acceleration, so you stop instantly and start never.
2. **The rolling cap is 2.7x the running cap.** 480 px/s against 180. Two thirds of the
   speed range does not exist on foot.
3. **You cannot run up anything.** At 26.6 degrees the slope term is 100.6 px/s2 against
   your 84.4 px/s2 of acceleration. Every real gradient is net negative under power, so
   uphill is paid out of momentum, always.

The slope factor asymmetry is the reward for committing:

| Angle | Running | Rolling uphill | Rolling downhill |
|---|---|---|---|
| 26.6 | 100.6 | 62.9 | **251.9** |
| 45 | 159.1 | 99.4 | **397.7** |
| 63.4 | 201.2 | 125.7 | **503.1** |

Rolling downhill at the shallowest grade pays three times what running pays on the flat,
and rolling uphill costs *less* than running uphill. In exchange you lose steering,
acceleration, and - after a rolling jump - air control entirely.

## 3. Numbers

All converted from the SPG at 1 block = 1 tile, so our px = Genesis px / 2 and
per-second = per-frame x 60. `npm run check` asserts every one of them.

| Thing | Value |
|---|---|
| **top speed, running** | **180 px/s** (22.5 tiles/s), reached in 2.13s |
| **cap while rolling** | **480 px/s** (60 tiles/s), on `vx` only |
| acceleration / friction | 84.375 px/s2 |
| deceleration (braking) | 900 px/s2 |
| air acceleration | 168.75 px/s2 |
| gravity | 393.75 px/s2, no terminal velocity |
| jump force / release clamp | 195 / 120 px/s |
| roll friction / deceleration | 42.19 / 225 px/s2 |
| slope factor: run / roll up / roll down | 225 / 140.6 / 562.5 px/s2 |
| slip: angle, speed, control lock | 46 deg, 75 px/s, 0.5 s |
| spindash release | 240..360 px/s |
| body, standing / rolling | 9 x 19 / 7 x 15 px |
| view | 160 x 112 px, integer scale |
| camera scroll cap, slow / fast | 180 / 480 px/s |

The camera caps are not free parameters: 180 is the running top speed and 480 is the
rolling cap, so the camera cannot fall behind by construction. They are written as
`K.topSpeed` and `K.rollCap` in `render.ts` to keep that visible.

## 4. The verb set

**run, jump (variable height), roll, spindash.** Nothing else.

No air jump, no wall-jump, no dive, no dash, no breakable platforms. Every one of them
hands you speed or height the terrain did not give you, which is the thing this clone
exists to stop doing. Wall-jump in particular contradicts the slip rule (§5), whose
entire job is to stop you climbing walls.

Ball form covers rolling *and* jumping - in Sonic they are the same smaller body, which
is why a jump clears gaps a run cannot. Entering it sinks the center 2.5px so the feet
stay put.

## 5. Collision: floor mode only, angles to 63 degrees

Per-tile angles are not optional - the slope factor, the landing conversion and the
angled jump all need `sin(angle)`. What *is* deferred is letting `angle` past 90 degrees:
the four rotating sensor modes, the two collision planes with path swappers, and
therefore loops and corkscrews. See SONIC2.md §3 for what that costs.

Angles are **stored**, not derived. Deriving from the height array's endpoints is right
for the 45 and 26.6 pieces and wrong for the 63.4 ones, whose arrays are half empty - the
endpoints describe a 45 degree line the tile does not draw.

Three bugs, all found by the act run rather than by any synthetic slope:

1. **A buried tile is not a surface.** Every solid tile reports its top edge as standable,
   including ones under more rock. A body that drifted against a wall stood on the roof of
   a tile *inside* the wall, got shoved out by the push sensor, fell, drifted back in, and
   looped there forever. One line: reject a surface with rock directly over it. This is
   the root-cause fix - it applies to every sensor caller, not just the wall case.
2. **A slip re-armed every step.** Detaching sets `gsp` to 0, so the slope hands back a
   little speed and the check zeroes it again: the player stood on a 63 degree face
   forever with the lock stuck at 0.50s. The lock has to be allowed to elapse.
3. **A body with `vy == 0` re-landed on the surface it just left**, on the same step. That
   is what made (2) unrecoverable. The airborne landing test needs `vy > 0`, strictly.

And one authoring bug worth the same weight, because the format invites it: **a slope pair
at row r carries the surface from `(r+1)*8` to `r*8`**, so a climb starts one row above
where a matching descent ended. Off by one and the chunk seam is an 8px step that the push
sensor reads as a wall.

## 6. Rings are the health system, and that is the design

- Rings scatter on a hit, up to 32. 64 frames before you can re-collect.
- 0 rings and a hit kills. Pits kill. Nothing else does.
- Damage sources: spikes (a tile value) and pits. **Badniks are deferred** with loops.

This is why speed is safe to attempt: the punishment is denominated in the collectible,
is partly recoverable if you scramble, and never resets the run. Rings are also the
level's signage - a ring arc is the drawn trajectory of the jump the designer intends.

Deferring badniks has one real cost: the low route is currently only *slower*, not more
dangerous, so spike and pit placement has to carry the whole risk difference alone.

## 7. The level is a chunk grid

Sonic 2's own format. A library of 16x16-glyph chunks and a grid saying where each goes.
15 x 3 chunks = 240 x 48 tiles: 12 screens across, 3.4 down.

```
_____yTt___yTt_     band 0   rows  0-15   sky, upper shelf on its bottom rows
SlNMJLK+NMJLqlZ     band 1   rows 16-31   the lower route, surface at row 22
XXXXXXXXXXXXVXX     band 2   rows 32-47   rock, or void under a pit
```

The whole two-tier structure lives in how the bands stack, which is what makes 12 screens
of deliberate level fit in about 25 authored chunks instead of 37,500 characters.

### The gate

The shelf sits 3 rows above the launch ramp's lip. Clearing that needs **24px of rise over
56px of travel** off a 45 degree ramp, where `vy = -gsp * sin(45)`:

| Arriving at | Rise over 56px | Takes the shelf |
|---|---|---|
| 180 (running flat out) | 17.7 px | no |
| 240 (a spindash) | 34.6 px | yes |
| 300 (rolled down the grade before it) | 42.3 px | yes |

Running as hard as you can is not enough, and that is the point: **the upper route is
bought with rolling speed, not with holding right.** Failing it drops you back on the
lower route 14 tiles past the lip - the punishment for missing the fast line is the slow
line, never a death.

Each shelf skips a hazard: the first skips a spike patch, the second skips a pit. The fast
line is also the safe one, and you only get it by arriving fast.

### Markers, and why checkpoints sit on both routes

A marker cell means "a body stands here", which is **feet on the cell's bottom edge** -
not the cell's centre. Deriving that in two places put checkpoints 5.5px underground: a
respawn there falls through the world, dies, and respawns into the same rock. One
`standY` now serves the spawn and every checkpoint, and the harness asserts that every
point the game can put a body back at is a point a body can stand at.

Two placement bugs of the same shape came out with it, and both are the format inviting
it: anything sitting *on* a platform has to fit on that platform. The short shelf spans
10 tiles, and its star post and two of its six rings were authored at fixed offsets that
put them past its end, hanging in the air.

Checkpoints go on **both** routes. A single one on the ground is one the fast line never
touches: the shelf ends above it and drops you past it through the air, 66px over its
head.

## 8. Camera

Sonic 2's structure - an 8px horizontal deadzone, the player pinned to the center line
when grounded and roaming a 16px window when airborne, and the co-designed scroll caps -
plus the one thing Mania added: **velocity look-ahead**, capped at 40px, a quarter of the
view. Without it the reaction budget at the rolling cap is 0.17s against a human reaction
time of about 0.20s, which is exactly the Chemical Plant complaint.

The look-ahead slews rather than snapping, or turning around whips the world across the
screen.

## 9. Measured

`npm run check` reproduces all of it. Every ground-truth row is within 5% of the SPG,
most within 1%; the residual is 120Hz discretisation.

| Derived | Measured | SPG |
|---|---|---|
| time to top speed | 2.13 s | 2.13 |
| coast distance, running | 191.3 px | 192 |
| coast distance, rolling | 380.5 px | 384 |
| braking distance | 17.3 px | 18 |
| jump apex, held | 49.1 px | 48.3 |
| jump apex, released at once | 19.4 px | 19.9 |
| roll gain on 26.6 down | 209.37 px/s2 | 209.37 |
| roll cost on 26.6 up | -105.08 px/s2 | -105.08 |

A full run of act 1 by a bot that holds right, rolls into every descent and jumps when the
floor ahead stops: **goal reached in 14.2s, 80% grounded, 39% rolling, top ground speed
300 px/s, 26 rings, no deaths, and it takes the upper shelf.**

That bot is deliberately stupid - it never spindashes and never brakes. 39% rolling from
terrain alone is the number to watch: it says the grades are doing their job.

An earlier version of it read 27.1s, and the difference was entirely the bot. Its
floor-ahead probe used `solidAt`, which reports one-way platforms as non-solid - correct,
because they must never block a wall or a ceiling, and wrong for "is there floor here".
So it read every shelf as a hole and jumped on every step, bouncing the length of the
upper route without once landing on it. **A test fixture that models the world differently
from the player measures a game nobody plays.**

## 10. Open

1. **The two tiers cannot both be on screen.** They are 8 rows apart on a 14-row view. On
   the shelf the lower route is just off the bottom edge. Authentic - Sonic's own view has
   the same limit - but it means the routes have to reconnect *visibly* to read as a
   choice, and right now they mostly reconnect off-screen.
2. **No badniks**, so the low route is slower but not more dangerous (§6).
3. **No loops.** Emerald Hill without its icon (SONIC2.md §3 for the cost).
4. **The bot never spindashes**, so the standing-start recovery verb is unexercised by the
   check. The only thing proving it works is a browser input test.
5. **One act, no boss, no act 2, no zone structure.** The chunk grid is built to extend;
   nothing else is.
6. **The deceleration quirk is not implemented** - the SPG sets `gsp` to +/-0.5 px/f on a
   sign flip during braking. Without it, holding forward into a 45 degree slope you cannot
   climb makes the player creep up it at about 5 px/s instead of settling. Harmless in this
   act because nothing asks you to; it will matter the moment something does.
