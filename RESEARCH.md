# How fast games build and keep speed

Research for the design round. Organized by *mechanism*, with games as evidence.
Pairs with TECH.md, which says what is cheap and what is expensive.

## 0. Calibration: how fast is fast?

Speed only means something relative to how much screen it eats. TECH.md fixes the
viewport at 384x216 world px. Comparable games:

| Game | Screen | Top speed | Screens/sec |
|---|---|---|---|
| Celeste | 320x180 | 90 px/s run | 0.28 |
| Celeste | 320x180 | 240 px/s dash | 0.75 |
| Sonic (Genesis) | 320x224 | 360 px/s running | 1.1 |
| Sonic (Genesis) | 320x224 | 960 px/s rolling cap | 3.0 |
| Super Metroid shinespark | 256x224 | ~1000 px/s | ~4 |
| **This game's free ceiling** | **384x216** | **960 px/s** (TECH.md §4) | **2.5** |

Two things fall out of this. Celeste is *not* a fast game by the numbers - it is a
precise one, and its speed is felt in dash impulses, not in traversal. And the
tech ceiling we already have without substepping is Sonic-rolling fast. There is
no engineering reason to be slower than Sonic.

## 1. Three families of speed

Nearly every fast game picks one of these as its primary source. The choice
determines the level design, the camera, and the failure state.

### A. Earned from terrain - speed lives in the world

**Sonic the Hedgehog (1991).** The entire engine is one line applied per frame:
`gsp -= slopeFactor * sin(angle)`. Downhill adds speed, uphill removes it.
Running has a modest top speed (6 px/frame); the real speed comes from geometry.
Rolling switches the slope factor to be asymmetric - 0.078125 uphill vs 0.3125
downhill - so rolling converts height into speed far better than running does,
at the cost of not being able to accelerate or steer. You commit.

**Tribes: skiing.** Hold a button, ground friction goes to zero, terrain does the
rest. The masterstroke is that friction is *opt-out*: speed is a reward for
reading the landscape. This is Sonic rolling in 3D and it produced a genre.

**N++.** A real physics body. Slopes, launchpads and bounce blocks conserve and
inject momentum; drag is very light; you cannot stop in mid-air. The whole game
is about not braking.

**Umihara Kawase / Bionic Commando.** Grapple as a pendulum: height converts to
speed and back. Speed is stored as potential energy.

*Cost:* slope collision. TECH.md §8 flags this as the single most expensive item
on the list, and it is right - slopes mean per-tile surface angles, a ground
sensor that follows the surface, and a whole rotation mode for the character.

### B. Granted as a resource - speed lives in an economy

**Sonic Rush / Colors / Generations / Frontiers "boost formula".** Rings become
boost fuel; boost is a button. Simple, legible, and it is why modern Sonic plays
nothing like Genesis Sonic - the terrain stopped mattering.

**Super Metroid / Metroid Dread speed booster + shinespark.** Run in a straight
line for N tiles, enter a booster state, then *store* it by crouching. Release it
later as a directional rocket. Speed becomes a chargeable, bankable item, and the
level design becomes puzzles about where you can find a runway.

**Celeste.** The dash is a fixed-length, fixed-speed, 8-direction impulse that
refills on ground contact or on a crystal. It *overwrites* velocity rather than
adding to it - which is why Celeste feels precise rather than fast.

**Dustforce.** The best version of this family. The fast verbs are gated by a
resource that refills by *playing well* (cleaning dust), not by waiting on a
cooldown. Speed and style are the same meter.

**Neon White.** Movement abilities are cards you discard. Momentum as inventory.

*Cost:* cheap. A number, a spend, a refill rule.

### C. A tier state - speed lives in a state machine

**Pizza Tower.** Run for a while and you hit Mach 1, then Mach 2 (you charge
through walls), then Mach 3 (you are a rocket). Each tier changes the animation,
the sound and the music. Losing contact with the floor or hitting something drops
you a tier. Everything - walls, enemies, slopes - becomes destructible at high
mach, so the world visibly stops resisting you.

This is the most *legible* of the three families. The player always knows what
tier they are in, what it costs them to lose it, and what it buys them.

**Titanfall 2 / Quake bunnyhopping** sit between A and C - every traversal verb
(wall-run, slide, jump) is written to conserve rather than reset speed, and the
mastery ceiling comes from an asymmetry in the clamp (Quake's air acceleration
clamps the *projection* of velocity, not the magnitude, so turning mid-air adds
speed - an accident that became a genre).

*Cost:* cheap. A tier integer, thresholds, and per-tier rules.

## 2. How speed is lost - the more important half

A momentum game is defined by what takes speed away. Options, roughly in order of
harshness:

- **Friction only.** Sonic on flat ground. You coast a long way. Forgiving.
- **Tier demotion.** Pizza Tower. A mistake costs one tier, not everything.
- **Hard reset on wall contact.** The default in naive engines and the single
  biggest cause of a fast game feeling bad. Sonic *does* zero horizontal speed on
  a wall, but the levels are built so you rarely hit one head-on.
- **Death.** Super Meat Boy. Viable only because restart is under a second - the
  game preserves the *player's* flow instead of the character's.

The rule most fast games converge on: **never take away speed for something the
player could not see coming.** Which pushes hard on the camera (§5).

## 3. Standing-start recovery

If losing speed means a long boring runway to rebuild it, players stop taking
risks. Every good momentum game has an answer:

- **Spin dash** (Sonic 2) - crouch, charge, release at up to 2x running top speed.
- **Drop dash** (Sonic Mania) - hold jump on the way down, land already rolling.
  Removes the standing start entirely.
- **Slide-hop / crouch-slide** (Titanfall, Apex) - convert a landing into speed.
- **Hyper/super dash** (Celeste) - dash then jump within a few frames to convert
  the dash into preserved horizontal speed. Not a designed feature; became the
  whole speedrun metagame.
- **Wall jump chains** (Super Meat Boy, Mega Man X) - a wall is a resource, not a
  stop.

## 4. The forgiveness toolkit

These do not add speed; they stop you losing it to a two-frame mistake. Standard,
cheap, and non-negotiable in a fast game:

| Trick | Typical value | What it fixes |
|---|---|---|
| Coyote time | 0.1s (Celeste: 6 frames) | jumping just after leaving a ledge |
| Jump buffer | 0.08-0.1s | pressing jump just before landing |
| Corner correction | 1-4 px nudge | clipping a corner on the way up |
| Asymmetric gravity | fall ~2x rise | snappy arc, less float |
| Variable jump height | release cuts upward velocity | one button, two jumps |
| Apex hang time | reduced gravity near v=0 | control at the top of the arc |
| Input buffering on all verbs | ~5 frames | dash/attack queued during animation |

Celeste ships all of these and they are most of why it feels good.

## 5. The camera is a speed mechanic

At 2.5 screens/sec the player crosses the viewport in 0.4s. If the camera is
centered on the character, the reaction budget is 0.2s - roughly human reaction
time, i.e. unfair.

- **Velocity look-ahead.** Offset the camera toward the direction of travel,
  scaled by speed. Sonic CD/Mania do this; Celeste does a small static version.
- **Asymmetric lag.** Snap forward fast, drift back slowly.
- **Zoom out at speed.** Pizza Tower and most modern racers. TECH.md fixes SCALE
  to an integer at resize, so a *continuous* zoom is off the table - but nothing
  stops the camera look-ahead from doing the same job.
- **Vertical deadzone with ground lock.** Vertical camera follows the last
  grounded Y, not the current Y, so jumps do not shake the frame.

## 6. Legibility - the player must feel the speed

In an 8x8 glyph world, all of this is tint and sprite count, which TECH.md §7
says is free:

- **Afterimage trail** - N ghost glyphs at decreasing alpha along the path.
- **Speed lines / dust** - horizontal particle streaks, denser with speed.
- **Palette shift** - tint the character up the 24-color ramp per tier. Pizza
  Tower's whole mach system is readable purely from color and pose.
- **Music layering** - add a layer per tier. Cheapest strong feedback there is.
- **Screen shake / impact freeze** - a few frames of hitstop on a big landing.

## 7. Level design as the speed system

The mechanic is half of it; the geometry is the other half.

- **Sonic's multi-path levels.** The high route is the fast route, and you get
  there *by* being fast. Failure drops you to the slow route rather than killing
  you. Speed is self-reinforcing but not required.
- **Canabalt.** Auto-run removes the decide-to-go-fast choice entirely; the game
  is only about not losing speed. Crashing through a window slows you - the
  punishment is denominated in the resource the game is about.
- **Pizza Tower's escape sequence.** The level ends with a timed reverse run
  through geometry you already know. Knowledge becomes speed.
- **Rayman Legends' music levels / Ori's escapes.** A chase forces the pace, so
  the player does not have to choose it.
- **Trackmania / Super Meat Boy restart.** Instant restart is a momentum system
  at the session level. If restarting is slower than a second, players stop
  experimenting.

## 8. What actually fits *this* build

Filtered through TECH.md:

| Mechanism | Fit |
|---|---|
| Tier/mach speed states | **Free.** An integer and thresholds. |
| Boost as a resource | **Free.** A number. |
| Afterimages, speed lines, tint ramps | **Free.** §7 says do not budget sprites. |
| Coyote/buffer/corner-correct | **Free.** A few counters in the sim. |
| Velocity look-ahead camera | **Free.** §6 is already a lerp; bias it. |
| Wall jumps, dashes, ground pound | **Cheap.** Axis-separated AABB gives them. |
| Destructible tiles at high speed | **Cheap-ish.** §5 warns the tile layer stops being static. |
| Grapple / pendulum | **Moderate.** A raycast plus a constraint solver. |
| **Walkable slopes** | **Expensive.** The one real cost. Art is free (§8), collision is not. |
| Speeds above 120 tiles/s | **Expensive.** Becomes a raycast, loses its body. |

## 9. The decision tree the design round has to walk

1. Which speed family - earned from terrain, granted as a resource, or a tier
   state? *Everything else hangs off this.*
2. What takes speed away, and how much?
3. What is the standing-start recovery verb?
4. Is the character 1x1 or 1x2 glyphs? (TECH.md Q1)
5. Single screen, scrolling stage, or screen-flipped rooms? (TECH.md Q3)
6. Slopes walkable or decorative? (TECH.md Q5) - *decided by 1, not independent*
7. Destructible or moving terrain? (TECH.md Q4)
8. What is the fail state and how fast is restart?
9. What is the goal - time, survival, collection, combat?
