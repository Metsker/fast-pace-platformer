import { Application, Text } from "pixi.js";
import { loadGlyphs } from "./gfx/glyphs.ts";
import { PALETTE } from "./tilemap.ts";
import {
  K,
  STEP,
  TILE,
  charToTile,
  newPlayer,
  parseLevel,
  restart,
  step,
  type Input,
  type Level,
  type Player,
  type Ring,
} from "./sim.ts";
import { buildView, setTile, syncView, type View } from "./render.ts";
import { ed, initEditor, showMenu } from "./editor.ts";

// 20 x 14 tiles, the Genesis framing at 1 block per tile. Not 16:9 - pillarboxed, and
// deliberately so: the reaction budget at the 480 px/s roll cap is what the level
// design is built around, and a wider view hands it away for free.
const VIEW_W = 160;
const VIEW_H = 112;

const scattered: Ring[] = [];
const input: Input = { x: 0, down: false, jump: false, jumpDown: false };

const app = new Application();
await app.init({ background: PALETTE[2], antialias: false });
document.getElementById("stage")!.appendChild(app.canvas);

const glyphs = await loadGlyphs("./dungeon-mode.png");

const hud = new Text({
  text: "",
  style: { fill: PALETTE[23], fontFamily: "monospace", fontSize: 13, lineHeight: 16 },
});
hud.position.set(6, 4);
app.stage.addChild(hud);

let level: Level;
let player: Player;
let view: View;

// The whole cost of an edit: re-parse the rows, rebuild the view. 6.7k sprites for act 1,
// so this is cheap enough to do on a dirty flag once per frame rather than diffing tiles.
function setLevel(rows: string[]): void {
  view?.root.destroy({ children: true });
  level = parseLevel(rows);
  player = newPlayer(level);
  scattered.length = 0;
  view = buildView(level, glyphs);
  view.root.scale.set(zoom);
  view.spawn.visible = ed.on; // authoring metadata, not something a player should see
  app.stage.addChildAt(view.root, 0); // behind the hud
}

// `fit` is the integer scale that fits the 160x112 frame to the window. `zoom` is what
// the world is actually drawn at, and it only leaves `fit` in edit mode - the framing is
// a design constraint during play, not a preference.
let fit = 1;
let zoom = 1;
const viewW = () => (VIEW_W * fit) / zoom;
const viewH = () => (VIEW_H * fit) / zoom;

function resize() {
  fit = Math.max(1, Math.floor(Math.min(innerWidth / VIEW_W, innerHeight / VIEW_H)));
  app.renderer.resize(VIEW_W * fit, VIEW_H * fit);
  zoom = ed.on ? clamp(zoom, 1, fit * 2) : fit;
  view.root.scale.set(zoom);
}

// Markers are not tiles - they live in the parsed arrays - and a paint past the level's
// own edge changes its width, which invalidates every tile index. Both cost a re-parse.
// Terrain within bounds does not, and terrain within bounds is what a drag paints.
const MARKERS = "@oPG";

await initEditor({
  canvas: app.canvas,
  scale: () => zoom,
  rows: () => level.rows,
  setLevel,
  painted: (tx, ty, ch, was) => {
    if (MARKERS.includes(ch) || MARKERS.includes(was) || tx >= level.w || ty >= level.h) {
      ed.dirty = true;
      return;
    }
    level.tiles[ty * level.w + tx] = charToTile(ch);
    setTile(view, level, tx, ty);
  },
});

addEventListener("resize", resize);
resize();

const LEFT = ["ArrowLeft", "KeyA"];
const RIGHT = ["ArrowRight", "KeyD"];
const UP = ["ArrowUp", "KeyW"];
const DOWN = ["ArrowDown", "KeyS"];
const JUMP = ["Space", "KeyZ", "ArrowUp", "KeyW"];

const PAN = 480; // px/s, the roll cap - fast enough to cross the act without waiting

const held = new Set<string>();
addEventListener("keydown", (e) => {
  // The editor panel's own fields keep their keystrokes, and a button that still has
  // focus after a click must not eat space as a jump.
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (e.target instanceof HTMLButtonElement) e.target.blur();
  if (e.repeat) return;
  held.add(e.code);
  if (JUMP.includes(e.code)) input.jumpDown = true;
  if (e.code === "KeyR") restart(player, level, scattered);
  if (e.code === "Escape") showMenu(!ed.menu);
  if (e.code === "KeyE") {
    showMenu(false); // editing is a way out of the list, not something behind it
    toggleEdit();
  }
  e.preventDefault();
});
addEventListener("keyup", (e) => held.delete(e.code));

const any = (codes: string[]) => codes.some((c) => held.has(c));

function toggleEdit(): void {
  ed.on = !ed.on;
  document.getElementById("ed")!.classList.toggle("on", ed.on);
  hud.visible = !ed.on;
  view.spawn.visible = ed.on;
  if (ed.on) {
    ed.camX = view.cam.x;
    ed.camY = view.cam.y;
  } else {
    zoom = fit; // play always gets the designed framing back
    view.root.scale.set(zoom);
    // Play from where you were looking rather than from spawn. The loop between an edit
    // and the jump it changes is the only thing an editor is for.
    player.x = player.px = ed.camX + VIEW_W / 2;
    player.y = player.py = ed.camY + VIEW_H / 2;
    player.vx = player.vy = player.gsp = 0;
    player.grounded = false;
    player.warps++; // a teleport, so the camera cuts instead of scrolling across the act
  }
}

// The wheel pans, the same axes wasd covers: shift for horizontal, and ctrl (which is
// also what a trackpad pinch sends) to zoom about the cursor.
app.canvas.addEventListener(
  "wheel",
  (e) => {
    if (!ed.on) return;
    e.preventDefault();
    const k = e.deltaMode === 1 ? 16 : 1; // lines vs pixels
    const dy = e.deltaY * k;
    if (e.ctrlKey || e.metaKey) {
      const next = clamp(zoom + (dy < 0 ? 1 : -1), 1, fit * 2);
      if (next === zoom) return;
      // Pin the world point under the cursor, or a zoom walks the level out from under it.
      ed.camX += e.offsetX / zoom - e.offsetX / next;
      ed.camY += e.offsetY / zoom - e.offsetY / next;
      zoom = next;
      view.root.scale.set(zoom);
    } else if (e.shiftKey) {
      ed.camX += dy / zoom;
    } else {
      ed.camX += (e.deltaX * k) / zoom;
      ed.camY += dy / zoom;
    }
  },
  { passive: false },
);

let acc = 0;
app.ticker.add((t) => {
  const dt = t.deltaMS / 1000;

  if (ed.dirty) {
    ed.dirty = false;
    setLevel(level.rows);
  }

  if (ed.menu) return; // the world holds where it is behind the list

  if (ed.on) {
    const d = PAN * dt * (held.has("ShiftLeft") ? 3 : 1);
    // The right bound runs two screens past the level's own width, so painting off the
    // end is how you extend an act - the next parse grows the bound to match.
    ed.camX = clamp(ed.camX + ((any(RIGHT) ? 1 : 0) - (any(LEFT) ? 1 : 0)) * d, 0, Math.max(0, level.w * TILE - viewW()) + viewW() * 2);
    ed.camY = clamp(ed.camY + ((any(DOWN) ? 1 : 0) - (any(UP) ? 1 : 0)) * d, 0, Math.max(0, level.h * TILE - viewH()));
    view.cam.x = ed.camX;
    view.cam.y = ed.camY;
    view.world.position.set(-ed.camX, -ed.camY);
    return;
  }

  input.x = ((any(RIGHT) ? 1 : 0) - (any(LEFT) ? 1 : 0)) as -1 | 0 | 1;
  input.down = any(DOWN);
  input.jump = any(JUMP);

  // Fixed timestep, clamped so a tab-switch does not spiral.
  acc += Math.min(t.deltaMS, 250) / 1000;
  while (acc >= STEP) {
    step(player, input, level, scattered);
    acc -= STEP;
    input.jumpDown = false;
  }

  syncView(view, player, level, scattered, acc / STEP, dt, viewW(), viewH());

  const gsp = Math.abs(player.grounded ? player.gsp : player.vx);
  const mode = player.rolling
    ? player.grounded
      ? "rolling"
      : "ball"
    : player.grounded
      ? input.down
        ? "crouching"
        : "running"
      : "air";
  const mins = Math.floor(player.time / 60);
  hud.text =
    `RINGS ${String(player.rings).padStart(3)}    TIME ${mins}:${String(Math.floor(player.time % 60)).padStart(2, "0")}` +
    `\n${gsp.toFixed(0).padStart(3)} px/s  ${(gsp / TILE).toFixed(1)} tiles/s   ${mode}` +
    (gsp > K.topSpeed ? `   +${(gsp - K.topSpeed).toFixed(0)} over running` : "") +
    (player.done ? "\nACT CLEAR" : "\narrows move · down roll · space jump · r restart · e edit");
});

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Exposed so Playwright can inspect the live scene graph and sim state.
Object.assign(window, { app, ed, sim: { get player() { return player; }, get level() { return level; }, get view() { return view; }, scattered } });
