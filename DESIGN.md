# Design

Decisions from the design round, kept current with what is actually built. Pairs
with TECH.md (what is cheap) and RESEARCH.md (what other games did).

## The pitch

A ball comes down a very high mountain. Running holds a constant high cruise;
everything faster than that is given by the drop.

## 1. Speed is a cruise plus what the mountain gives

Running takes you to **700 px/s and stops there**. That is the whole of what the
legs do, and it arrives in 0.22s, so the cruise reads as a constant rather than
something earned.

Above the cruise, three rules and nothing else:

| Situation | Effect |
|---|---|
| Airborne and descending | **+450 px/s²** - the drop is the accelerator |
| Grounded and descending | held - a slope keeps what it earned |
| Grounded, level or climbing | **-600 px/s²** - shelves and lips reclaim it |

Ceiling 1000 px/s. Tiers survive only as readout thresholds at 800 and 910;
they are derived from current speed every step and cap nothing.

The boost is now *smaller* than the bleed. That asymmetry is what makes a shelf
mean something: at the old 600/600 the ceiling arrived 3 seconds in and the run
was pinned there for the remaining nine.

The middle row is the one that matters. Bleeding whenever grounded would mean the
mountain drains the speed it just handed you, since the level is *mostly* downhill
slope. Keying the bleed to "not losing height" covers slopes and falls with one
condition and no tile lookup.

## 2. The timer is the engine, the dive is the fuel

*Not built.* See git history if this comes back - the descent model has taken over
the role it was going to play.

## 3. The verb set

- **run** - hold a direction. Takes you to the cruise, never past it.
- **ramp** - not a verb at all, but it belongs here: hitting a lip throws you, and
  harder the faster you arrive (§4b). The only "input" is choosing to keep speed.
- **jump** - variable height, asymmetric gravity, coyote time, input buffer
- **air jump** - one per airtime, refreshed on landing only
- **wall-jump** - preserves horizontal speed, kicks away from the wall
- **dive** - hold down while airborne. Gravity triples, the hang ends early.

There is no dash. It was the standing-start recovery verb, and with the cruise
arriving in a third of a second there is nothing left for it to recover.

### Terminal velocity scales with speed

This is the least obvious number in the build and the descent does not work
without it. The float caps falling at 150 px/s when you are slow - but at cruise
a 150 px/s fall traces a **12° line**, and the shallowest ramp on the sheet is
26.6°. The ground drops away faster than you can fall, so you glide over the
entire mountain without touching it. Measured: 100% airborne, seventeen screens,
never landed once.

So terminal velocity is `max(150, |vx| × 1.0)` - the float when slow, a 45° fall
line at speed. Lower the multiplier and you drift over descents; raise it and
jumps get short and heavy.

## 4. Slopes collide

Ten slope tile types, three gradients in both directions. Each is a per-tile
height function of local x (§7), so collision is a table lookup with no neighbour
queries.

**The surface is a line, not the drawn staircase.** The table stores height at the
nine pixel *edges* x = 0..8 and interpolates between them, so a ramp is exact and
consecutive tiles join with no seam - every tile's x=8 equals its neighbour's x=0.
Storing the eight filled-column heights the glyphs rasterise to instead makes the
player snap to whole pixels: a 26.6 grade at cruise should drop 2.92 px per step
and lands on 3,3,4,2,3, a half-pixel wobble at 120Hz that reads as jitter. The
collision surface is the line the art approximates, within half a pixel of it.

Three behaviours fall out of one `slopeNear` query:

- **climbing** - surface above the feet, push up
- **landing** - surface at the feet, attach
- **descending** - surface just below, snap down within `|dx| × 2 + 2` px

That reach is exactly what the steepest gradient could have dropped over the move,
so a descent is followed rather than launched off, while a real cliff still drops
you.

Four things this got wrong, all the same mistake - the surface query and the AABB
disagreeing about where the body is:

1. **The rock under a ramp is solid**, so the tile beneath the ramp's next step
   reads as a wall and stops the climb dead. The lift has to happen *before* the
   wall test, not after.
2. **The body is 6px wide on 8px tiles**, so its leading edge reaches into the
   next column while its centre is still in this one. Sampling the centre alone
   stalls a climb after 1.5 tiles. Sample the whole footprint; highest wins.
3. **That footprint has to be the exact span `hits()` tests**, `[x, x+BODY)`, not
   `x+BODY-1`. A pixel short and the lift clears a column the AABB then collides
   with. Invisible while y was integral, fatal the moment it went fractional.
4. **The attach must never sink the body into rock.** Where a shelf meets a
   downslope the ramp's surface is a fraction of a pixel below the shelf; dropping
   onto it wedges the body against the shelf tile it just left and the run stops
   halfway down the mountain. Test the destination before committing to it.

(3) and (4) were both latent the whole time, held off only by y happening to be a
whole number. Making the surface continuous is what exposed them.

## 5. Falling out of the world is the only death

No hazards, no contact damage, no health, no checkpoints. This iteration has no
holes at all - the crust is continuous - so nothing kills you.

## 6. Difficulty

Open, for this iteration. With no holes there is no fail state, so the mountain is
currently a feel test rather than a challenge.

## 7. Structure

- **Topology:** a descent. 1622 x 718 tiles - 20 screens wide, 16 tall.
- **Level format:** a *profile*, not a map. A list of segments (`d26`, `d45`,
  `d63`, `cliff`, `flat`, `u45`) walked left to right, tracking the ground row as
  it drops. The profile is the level; everything else is bookkeeping.
- **Crust:** 2 rows of rock under the surface, filled down to each neighbour's
  depth as well as its own - which is what makes a cliff read as a face rather
  than a floating lip. Deeper is invisible and not free.

### Tile types

`#` solid, `=` one-way, the ten slope chars, anything else decor (drawn, never
collides). One-way platforms are passable from below, never block sideways, and
break at speed (§4a).

### 4a. Platforms break at speed

Below **900 px/s** a one-way ledge catches you. At or above it the ledge gives way
and you punch straight through, leaving a hole exactly as wide as your body - the
rest of the ledge stays up, so the gap is a record of the line you took.

900 sits above the 700 cruise on purpose: **running never breaks anything, only
speed the mountain gave you does.** It is also exactly the tier-2 threshold, so the
red tint on the player is a live readout of "platforms will not hold you".

The interesting part is not the break, it is what it takes away. A ledge is flat,
so landing on one bleeds speed (§1). Too fast and you can no longer use it that
way - the brakes stop working precisely when you most need them. That falls out of
the two rules meeting; nothing enforces it.

Terrain never breaks. Only `=` tiles do, and a respawn puts them all back - the
level would otherwise erode across runs and stop being the same test.

### 4b. Ramps throw you

Leaving an up-ramp carries the climb into the air instead of dropping it. Without
this a ramp is dead terrain: attachment pins `vy` to 0 on every grounded step, so
the climb rate exists **only in the position delta**, and you reach the lip and
walk off it with nothing.

`vy = -min(climb × 0.7, 700)` on the grounded-to-airborne transition.

- **The gain is the air knob.** A 45° ramp rises at exactly your horizontal speed,
  so 1.0 is the physical answer and far too much flying. 0.7 keeps arcs
  proportionate to the ramp that made them.
- **The cap must not bite at normal speed.** At 600 it bound at every speed above
  600 - which is all of them - so every launch was the same height and arriving
  faster bought nothing. That is the opposite of a momentum feature.
- **The height is the point, not the hop.** The fall boost pays per second of
  descent (§1), so a launch is speed banked as altitude and returned with interest.

Two things that had to be fixed for it to work at all:

1. **The variable-jump-height cut ate it.** Releasing jump clamps a rise to
   `-jumpV × jumpCut` = -136 px/s. A ramp launch is not something you hold a button
   for, so the cut now applies only to actual jumps (`p.jumped`).
2. **`climb` reads negative at the exact moment of takeoff.** The body is 6px on
   8px tiles, so its leading edge crests the lip first and sets `y`; as that edge
   leaves, the lower trailing surface takes over and the body *sinks* for a step or
   two. Measured -20 px/s on the takeoff step of a ramp climbed at 700. So `climb`
   holds a fading peak rather than the last step's delta.

### The slope set, verified

Cropped and read pixel by pixel rather than trusted by name, per TECH.md §8's own
instruction.

| Angle | Up | Down | Footprint |
|---|---|---|---|
| 63.4° | `🭋` over `🭅` | `🭀` over `🭐` | 1 cell across, 2 up |
| 45° | `🭊` | `🬿` | 1 cell, self-contained |
| 26.6° | `🭈` then `🭆` | `🭑` then `🬽` | 2 across, 1 up |

The glyphs are still the art; the collision table is the geometry they draw (§4).

Corrections to TECH.md §8: `🭋 🭀` are 63.4° and `🭊 🬿` are exactly 45° - different
gradients in the same sheet row, not one family. And `╱ ╲` are 26.6° *and* only
half a cell tall and unfilled: line art, not ground.

**Which gradient carries the level matters.** d26 is the only grade you stay
planted on at cruise. d45 tracks exactly, so you skim it. d63 needs twice the fall
speed and always throws you. The first profile was mostly d45/d63 and ran 71%
airborne; rebalancing onto d26 brought it to 51%.

## 8. Camera

**640 x 360 internal, integer-scaled to fit** - 20 screens of mountain across and
16 down. At 384x216 the cruise crossed the view in under half a second and there
was nothing to read; wider is the reaction budget.

1x1 character, 8x8 px. Look-ahead scaled by velocity, and its ceiling is a
*fraction of the view* (0.4 wide, 0.45 tall) rather than a pixel count, so
changing the zoom keeps the feel. Vertical
anchors to the last grounded Y so hops do not shake the frame, but follows the
player the moment they drop below it - on a mountain the fall is the thing to
watch.

**Vertical look-ahead cannot read `p.vy`.** Slope attachment zeroes `vy` every
step, so on a grade losing 600 px/s of height the velocity says "not falling" and
the camera has no idea anything is happening. It reads the true per-step height
loss `(y - py) / STEP` instead, which covers slopes and free fall with one number.
Downward only - a rising jump keeps the ground anchor. Smoothed, because that raw
delta is one sim step sampled per render frame, and two steps run per frame.

A plain lerp is not enough on its own either: an exponential follow lags by
`v × (1-r) / (r × 60)`, so the old 0.1 rate trailed a 900 px/s drop by 135px on a
216px screen - the player was most of the way to the bottom edge. Now 0.2 plus the
look-ahead, which keeps the player above centre for the whole descent.

**Everything the camera reads has to be in render time, not sim time.** `groundY`
is a raw sim value while `y` is interpolated, so `max(groundY, y)` picked the raw
one on every grounded frame and the camera stepped in whole sim ticks - 8px at a
time at speed. Shifting `groundY` by the interpolation lag fixes it and keeps the
hop anchor intact.

The trail had the same disease and it is worth writing down, because it hides on
one specific machine. Ghosts read raw sim history while the player interpolates, so
a ghost sat `4(k+1)` steps behind the newest *sample* while the player sat `1-α`
behind it. The gap between them was therefore `4(k+1) - 1 + α` - **a function of
the frame's interpolation phase**. Sweeping α across one step with the terrain held
still, the player-to-ghost distance swings **10.7 world px, 21 screen px at 2x**.

It is invisible at exactly 60Hz against a 120Hz sim, because then every frame
consumes exactly two steps and α never moves - measured range 0.028 to 0.076, a
0.28px wobble. At any other refresh rate, or with any vsync jitter, α sweeps the
full range and the trail visibly crawls against the ball. Ghosts now interpolate on
the same α, which makes the lag exactly `4(k+1)` regardless of phase.

Do not trust a locked 60Hz browser to reveal timing bugs of this shape.

## 9. Numbers

| Thing | Value |
|---|---|
| **cruise speed** | **700 px/s** (reached in 0.22s) |
| **ceiling** | **1000 px/s** |
| ground acceleration | 2400 px/s² |
| air acceleration | 1920 px/s², only below 240 px/s |
| **fall boost, airborne descending** | **450 px/s²** |
| **bleed, grounded and not descending** | **600 px/s²** |
| fall cap | max(150, speed × 1.0) |
| dive gravity | 7200 px/s², uncapped |
| gravity rise / fall | 1100 / 1900 px/s² |
| jump velocity | -340 px/s (apex 6.4 tiles) |
| air jumps | 1, refreshed on ground contact |
| coyote / buffer | 0.1s / 0.08s |
| **platform break threshold** | **900 px/s** (= tier 2) |
| **ramp launch** | **climb × 0.7, capped 700 px/s** |
| climb-memory fade | 6000 px/s² |
| tier thresholds | 800, 900 px/s |
| view | 640 x 360, integer scale |
| camera follow, x / y | 0.2 forward, 0.06 back / 0.2 |
| camera look-ahead, x / y | speed × 0.35 max 0.4 view / drop rate × 0.1 max 0.45 view |
| drop-rate smoothing | 0.12 (≈0.14s) |

## 10. Measured

`npm run check` reproduces all of this.

| Jump arc, tiles | 240 px/s | 800 | 1000 |
|---|---|---|---|
| air jump then float | 34.0 | 98.0 | 118.7 |
| pure float | 17.8 | 54.8 | 66.7 |
| dive at apex | 13.2 | 42.9 | 53.2 |
| dive immediately | 3.1 | 10.1 | 12.5 |

A full descent, holding right and nothing else: **671 tiles down in 14.3s, 45%
grounded, average 873 px/s, 4 launches, 4 platforms smashed, no deaths**, ending
in the basin. `check-sim` runs this on the real level, because the seams between
segment types are where a body wedges and no synthetic ramp reproduces them.

The four launches in that run, as `upward px/s (from horizontal px/s)`:
**446 (700), 462 (705), 455 (700), 598 (940)**. The last one is the whole point -
arriving faster throws you higher, which is what separates a momentum feature from
a fixed hop.

One ramp, measured against the same mountain with the lip flattened off: **+17.3
tiles of rise, 73 more steps airborne, and 914 px/s at the bottom against 828**.

Both mechanics moved the descent measurably:

| | before ledges break | + breakable | + ramps |
|---|---|---|---|
| tiles down | 675 | 693 | 671 |
| grounded | 48% | 62% | 45% |

Breaking *raised* grounded time, because a ledge used to catch the player and park
them on a shelf nine rows above the mountain. Ramps pulled it back down, which is
what a launch is for.

Camera, over that descent on a 360px-tall view: median screen Y **164**, worst
**189** - above centre throughout, so more of the drop is visible than the summit.

Slope smoothness, on a 26.6 grade at cruise: **2.92 px per step, 111 steps, spread
0.000 px**. On screen the only remaining motion is the camera's exponential settle
(curvature 0.303, against the camera's own 0.305) and it is monotone, not a wobble.

### Open

1. **Only 300 px/s of headroom left.** With the cruise at 700 and the ceiling at
   1000, one long drop clips the top - 32% of the descent now runs at the ceiling,
   up from a brief touch at 1200. Lowering the *peak* alone narrows the band the
   mountain plays in; widening it again means lowering the *cruise* too.
2. **49% grounded.**
3. **No fail state.** No holes this iteration, so nothing is at stake yet.
4. **Wall-jump is dead content.** Nothing in the level has a vertical face.
5. **Only 4 platforms break per run** out of 396 tiles of ledge, because the ledges
   sit nine rows up and a descent rarely touches them. The mechanic works; the
   level does not yet ask for it. Ledges placed *in* the fall line would.
6. **Four ramps, not eight.** One on every shoulder ran 28% grounded and stopped
   being a descent at all. Four keeps them as punctuation, but it also means the
   launch is a rare event - three of the four fire from the same 700 px/s cruise,
   so the speed-to-height relationship barely gets exercised.
