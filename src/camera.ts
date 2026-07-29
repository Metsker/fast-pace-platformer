// Sonic 2's camera, plus the one thing Mania added.
//
// Pure - no Pixi - so the harness can run it. It lives outside render.ts because it
// produced a user-visible bug that nothing could catch: a respawn teleports the body but
// left the camera where it was, and the scroll caps below then walked it back across the
// level at 180 px/s. Measured 611px over 3.35 seconds of the world sliding past before
// you could see where you had respawned, on every single death.
//
// The caps are not free parameters: 180 px/s is exactly the running top speed and 480 is
// exactly the rolling cap, so the camera cannot fall behind by construction. They are
// read from K rather than written as numbers to keep that visible.

import { K, type Level, type Player } from "./sim.ts";

const DEAD_X = 4; // half of a 16 Genesis px horizontal window
const AIR_Y = 8; // the player roams this far vertically before the camera follows
const SLOW_AT = 240; // below this, grounded, the camera uses the slow cap
const LEAD_GAIN = 0.1;
const LEAD_MAX = 40; // a quarter of the view - at the roll cap this is the whole budget
const LEAD_RATE = 3; // how fast the look-ahead itself slews, per second

export type Cam = { x: number; y: number; lead: number; warps: number };

export const newCam = (): Cam => ({ x: 0, y: 0, lead: 0, warps: -1 });

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

// `x` and `y` are the render-interpolated position, not the raw sim one - everything the
// camera reads has to be in the same timebase or it steps in whole sim ticks.
export function follow(c: Cam, p: Player, x: number, y: number, lv: Level, viewW: number, viewH: number, dt: number): void {
  // A teleport is a cut, not a scroll. Any smoothing here is the camera pretending the
  // body travelled a distance it did not.
  if (p.warps !== c.warps) {
    c.warps = p.warps;
    c.lead = 0;
    c.x = x - viewW / 2;
    c.y = y - viewH / 2;
  } else {
    // Look-ahead, the one deviation from Sonic 2. It slews rather than snapping, or
    // turning around whips the whole world across the screen.
    const want = clamp(p.vx * LEAD_GAIN, -LEAD_MAX, LEAD_MAX);
    c.lead += (want - c.lead) * (1 - Math.pow(0.5, dt * LEAD_RATE));

    const fast = !p.grounded || Math.abs(p.gsp) >= SLOW_AT;
    const cap = (fast ? K.rollCap : K.topSpeed) * dt;

    const dx = x - viewW / 2 + c.lead - c.x;
    if (Math.abs(dx) > DEAD_X) c.x += Math.sign(dx) * Math.min(Math.abs(dx) - DEAD_X, cap);

    // Grounded, the player is pinned to the centre line; airborne they roam a window, so
    // a hop does not shake the frame but a real fall is followed.
    const slack = p.grounded ? 0 : AIR_Y;
    const dy = y - viewH / 2 - c.y;
    if (Math.abs(dy) > slack) c.y += Math.sign(dy) * Math.min(Math.abs(dy) - slack, cap);
  }

  c.x = clamp(c.x, 0, Math.max(0, lv.w * 8 - viewW));
  c.y = clamp(c.y, 0, Math.max(0, lv.h * 8 - viewH));
}
