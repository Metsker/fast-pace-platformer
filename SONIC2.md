# Sonic 2, researched

Source: the Sonic Physics Guide (info.sonicretro.org/SPG:*), which is derived from
disassembly, not from feel. Level design from the SRB2 design thesis, the Guiding
Elements essay, and the Sonic Retro zone pages.

Everything here is converted into **our** units. The mapping is fixed by one choice:

> **1 Genesis 16px tile = 1 of our 8px tiles.**

So our px = Genesis px / 2, and per-second = per-frame x 60. Distances halve,
speeds x30, accelerations x1800. Tiles per second are identical in both, which is
the number that actually matters.

## 1. The whole engine in four rules

Sonic is not a velocity platformer. It is a **scalar `groundSpeed` along a surface
angle**, and everything falls out of that.

```
// grounded
groundSpeed -= slopeFactor * sin(groundAngle)     // gravity along the surface
groundSpeed += accel / friction / decel from input
vx = groundSpeed * cos(groundAngle)
vy = groundSpeed * -sin(groundAngle)

// landing: vx,vy collapse back into one scalar
flat  (339..23 deg):  groundSpeed = vx
slope (316..45 deg):  groundSpeed = vy * 0.5 * -sign(sin(angle))
steep (anything else): groundSpeed = vy * -sign(sin(angle))
```

That third line is the whole game. A steep landing converts *fall speed into run
speed*. A flat landing throws away everything vertical. Height is currency and the
exchange rate is the angle you land at.

Jumping is the inverse and it too respects the angle:

```
vx -= jumpForce * sin(groundAngle)
vy -= jumpForce * cos(groundAngle)
```

Jump off a slope and you leave perpendicular to it, carrying your run speed sideways.

## 2. Constants

| Constant | Genesis | Ours |
|---|---|---|
| top speed (running) | 6 px/f | **180 px/s** (22.5 tiles/s) |
| acceleration | 0.046875 px/f² | **84.4 px/s²** |
| friction (no input) | 0.046875 px/f² | **84.4 px/s²** |
| deceleration (braking) | 0.5 px/f² | **900 px/s²** |
| air acceleration | 0.09375 px/f² | **168.8 px/s²** (2x ground) |
| gravity | 0.21875 px/f² | **393.8 px/s²** |
| jump force | 6.5 px/f | **195 px/s** |
| variable-jump clamp on release | 4 px/f | **120 px/s** |
| roll friction | 0.0234375 px/f² | **42.2 px/s²** (half of running) |
| roll deceleration | 0.125 px/f² | **225 px/s²** |
| **slope factor, running** | 0.125 px/f² | **225 px/s²** |
| **slope factor, rolling uphill** | 0.078125 px/f² | **140.6 px/s²** |
| **slope factor, rolling downhill** | 0.3125 px/f² | **562.5 px/s²** |
| X speed cap while rolling | 16 px/f | **480 px/s** (60 tiles/s) |
| slip threshold | 2.5 px/f | **75 px/s** |
| control lock after a slip | 30 f | **0.5 s** |
| spindash release | 8..12 px/f | **240..360 px/s** |
| spring, yellow / red | 10 / 16 px/f | **300 / 480 px/s** |
| body, standing | 19 x 39 px | **9.5 x 19.5 px** (1.2 x 2.4 tiles) |
| body, rolling | 15 x 29 px | **7.5 x 14.5 px** |
| view | 320 x 224 px | **160 x 112 px** (20 x 14 tiles) |

No terminal velocity in Sonic 1/2 (Sonic CD added one at 16 px/f). Air drag is a
tiny oddity: `vx -= floor(vx/0.125)/256` per frame, applied **only** while
`-4 < vy < 0` - a ~3%/frame horizontal bleed in the last moments of a rise. It
exists to stop jump-chaining from compounding speed forever.

### What those numbers mean when you multiply them out

| Derived | Value |
|---|---|
| time to reach top speed from a stop | **2.13 s** |
| coast distance from top speed (running friction) | 192 px = **24 tiles** |
| coast distance from top speed (rolling friction) | 384 px = **48 tiles** |
| braking distance from top speed | 18 px = **2.25 tiles** |
| jump apex, held | 48.3 px = **6.0 tiles** |
| jump apex, released immediately | 18.3 px = **2.3 tiles** |
| jump airtime, held | ~1.0 s |

Three things worth staring at:

1. **Acceleration is glacial.** Two full seconds to reach a top speed that is only
   180 px/s. Sonic is *slow* under his own power. Deceleration is 11x acceleration,
   so you can stop instantly but never start quickly.
2. **The rolling cap is 2.7x the running cap.** Running tops out at 22.5 tiles/s;
   rolling reaches 60. Two thirds of the game's speed range is unreachable on foot.
3. **You cannot run up anything.** At 26.6 deg the slope term is 100.6 px/s²,
   already above the 84.4 px/s² you accelerate at. Every real slope is net negative
   under power. Uphill is paid for out of momentum, always.

### Slopes decide everything

`slopeFactor * sin(angle)`, in px/s²:

| Angle | Running | Rolling uphill | Rolling downhill |
|---|---|---|---|
| 26.6° | 100.6 | 62.9 | 251.9 |
| 45° | 159.1 | 99.4 | 397.7 |
| 63.4° | 201.2 | 125.7 | 503.1 |

Rolling downhill at 26.6° gains **252 px/s²** - three times what running gains on
the flat. And rolling uphill costs *less* than running uphill. The asymmetry is
deliberate and it is the entire reward structure: commit to a ball, lose steering
and acceleration, and the mountain pays you triple.

Rolling is enterable only above 15 px/s, and a rolling jump **removes air control
entirely** in Sonic 1/2. Committing means committing.

### Slipping

Above 46° with `groundSpeed < 75 px/s`, you detach from the floor, `groundSpeed`
goes to 0, and directional input is locked for 0.5 s. This is what stops you from
inching up a wall or standing on a ceiling. It is also the punishment for arriving
at a loop too slowly, and it is *not* a death - you just slide back down.

## 3. Collision: the part that is expensive

Sonic uses **sensors**, not an AABB. Up to 5 active at once - two floor (A, B),
two push/wall (C, D), two ceiling (E, F) - each a downward-ish ray into the tile
whose height array it lands in. Each 16px tile stores a 16-entry height array plus
an angle byte.

Then the four modes: **Floor / Right Wall / Ceiling / Left Wall**, selected by
`groundAngle` in 90° quadrants. The sensor set rotates with the mode; in Right Wall
mode "down" means "toward the wall". **This is what makes loops work**, and it is
the only way loops work. There is no cheaper trick - a loop is a surface whose angle
passes through all 360°, and any engine that resolves collision on fixed world axes
cannot represent it.

We currently have: axis-separated AABB, per-tile height table interpolated at pixel
edges, one gradient family, floor mode only. That is roughly half of Floor mode. The
other three modes plus rotating sensors plus per-tile angles is the real cost of
"Sonic 2 clone", and it is much larger than the slope work already done.

## 4. Rings are the health system, and that is the design

- A hit scatters up to 32 rings (more than 32 is capped - carrying 100 is no safer
  than carrying 32). 64 frames of invulnerability before you can re-collect.
- With 0 rings, a hit kills.
- 100 rings = extra life.

This is the single most important design decision in the game and it is not a
physics one. It means **speed is safe to attempt.** Punishment for a bad line is
denominated in the collectible, is partly recoverable if you react fast, and never
resets your run. The only hard fails are pits and drowning.

Rings are also the level's breadcrumbs - a ring arc *is* the drawn trajectory of the
jump the designer intends. They are simultaneously the health bar, the score, the
extra-life economy, the Special Stage gate, and the signage.

## 5. Level design

### The two-tier structure

Every classic act runs two roughly parallel routes: an **upper, fast** one and a
**lower, slow** one, weaving and reconnecting. Skill and level memory put you high;
a mistake drops you down. The lower route has more badniks and more hidden rewards
(monitors, 1-ups); the upper route has fewer obstacles and a better time.

The critical property: **failure demotes, it does not kill.** Losing the line costs
you the fast route, not the run. That is what lets the designer put risk in the
middle of a 60-tiles/s section.

### Geometry is biased downhill

Because rolling downhill pays 4x rolling uphill, acts are drawn as net descents with
local rises. The rises are where the speed gets spent - a run of down-26.6 into an
up-45 turns horizontal speed into height and hands you the upper route.

### The Sonic 2 caveat: it over-corrected

Sonic 1 was criticized for too much platforming; Sonic 2 went the other way and is
the *worst* classic game to copy uncritically:

- Long **automated** sections - tubes, speed boosters (Chemical Plant introduced
  both), corkscrews - where the game plays itself. The design thesis' verdict:
  Sonic 2 "suffered from going too fast" and gave speed rather than making you earn
  it. Automated stretches are also *always the lowest-value path*; the shortcuts are
  gated behind interrupting the automation.
- **Badniks placed where speed gets you hit.** Emerald Hill Act 2 has a ledge that
  drops you straight into a Coconuts. Metropolis is the usual example. Blind damage
  at 60 tiles/s is the game's defining flaw.
- Chemical Plant literally **outran its own collision detection** in the original
  release. The developers' own explanation.

The lesson to steal: **the level should fight to slow you down and reward you with
speed for overcoming it** - not hand you speed and then punish you for having it.

### Guiding vs malicious elements

The vocabulary from the Guiding Elements essay: *guiding elements* (springs, slides,
loops, boosters, moving platforms) push you along a route; *malicious elements*
(spikes, crushers, trap badniks) hurt. The craft is that guiding elements
**occasionally lie** - a spring throws you into a spike patch. Occasionally. Enough
to keep you reading the screen, not enough to make the vocabulary untrustworthy.

### Structure and pacing

- Two acts per zone, boss at the end of Act 2. Roughly 2-4 minutes each for a normal
  player. 10-minute time limit - generous on purpose; the time bonus is trivial
  compared to the ring bonus, so the game does not actually push you to rush.
- Checkpoints (star posts) are frequent; Emerald Hill has enough that all 7 Special
  Stages can be reached in one zone.
- Act 1 teaches the zone's vocabulary, Act 2 complicates it and adds a hazard
  (Chemical Plant Act 2's rising Mega Mack).

## 6. What this costs us

The existing 825-line build already has: fixed 120Hz timestep with interpolation,
glyph atlas, tile renderer, camera with look-ahead, and interpolated slope collision
in floor mode.

| Needed | Cost |
|---|---|
| `groundSpeed` + angle model replacing vx/vy | **Rewrite of sim.ts.** The current model is vx/vy-first; Sonic's is scalar-first. Not a patch. |
| Per-tile angle + height array, more gradients | Moderate. The height-table machinery exists. |
| Rolling, spindash, slip, control lock | Cheap once `groundSpeed` exists. |
| **4-mode rotating sensors (loops)** | **Expensive. The single biggest item.** |
| Rings, badniks, hit/scatter/invuln, monitors | Moderate, and it is the first real object system - nothing like it exists yet. |
| Springs, boosters, tubes, moving platforms | Cheap each, but a long tail. |
| **Multi-path 2D level authoring** | **Expensive.** `levels.ts` is a 1D ground profile walked left to right. A two-tier act is not expressible in it at all. Hand-editing a 20x14-tile-viewport act as ASCII is thousands of characters per screen. |
| Camera at 160x112 instead of 640x360 | Cheap change, large consequence - see below. |
| Bosses, checkpoints, act structure, HUD, timer | Cheap each, long tail. |

### The view size question is not cosmetic

At 1 Genesis tile = 1 of our tiles, the authentic viewport is **160x112 world px =
20x14 tiles**, and the character is 1.2 x 2.4 tiles - **17% of the screen height**.
The current build uses 640x360 = 80x45 tiles, where a 2-tile character is 4% of the
screen height. That is four times as much world on screen in each axis.

Pick one:
- **Authentic 160x112.** Sonic's reaction budget, Sonic's readability, Sonic's
  level density. Requires drawing 16x the level detail per unit of playtime.
- **Keep 640x360 and scale all constants up 4x.** Then top speed is 720 px/s and the
  rolling cap 1920 px/s - which **blows the 960 px/s no-substep ceiling** from
  TECH.md §4 and forces substepping.
- **Something between**, and accept it will not feel like Sonic.

This decision comes before any of the physics work, because every constant above is
denominated in it.
