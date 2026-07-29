import { Application, Text } from "pixi.js";
import { loadGlyphs } from "./gfx/glyphs.ts";
import { PALETTE } from "./tilemap.ts";
import { K, STEP, TILE, kill, newPlayer, parseLevel, step, type Input, type Ring } from "./sim.ts";
import { ACT_1 } from "./levels.ts";
import { buildView, syncView } from "./render.ts";

// 20 x 14 tiles, the Genesis framing at 1 block per tile. Not 16:9 - pillarboxed, and
// deliberately so: the reaction budget at the 480 px/s roll cap is what the level
// design is built around, and a wider view hands it away for free.
const VIEW_W = 160;
const VIEW_H = 112;

const level = parseLevel(ACT_1);
const player = newPlayer(level);
const scattered: Ring[] = [];
const input: Input = { x: 0, down: false, jump: false, jumpDown: false };

const app = new Application();
await app.init({ background: PALETTE[2], antialias: false });
document.getElementById("stage")!.appendChild(app.canvas);

const glyphs = await loadGlyphs("./dungeon-mode.png");
const view = buildView(level, glyphs);
app.stage.addChild(view.root);

const hud = new Text({
  text: "",
  style: { fill: PALETTE[23], fontFamily: "monospace", fontSize: 13, lineHeight: 16 },
});
hud.position.set(6, 4);
app.stage.addChild(hud);

const LEFT = ["ArrowLeft", "KeyA"];
const RIGHT = ["ArrowRight", "KeyD"];
const DOWN = ["ArrowDown", "KeyS"];
const JUMP = ["Space", "KeyZ", "ArrowUp", "KeyW"];

const held = new Set<string>();
addEventListener("keydown", (e) => {
  if (e.repeat) return;
  held.add(e.code);
  if (JUMP.includes(e.code)) input.jumpDown = true;
  if (e.code === "KeyR") kill(player, level);
  e.preventDefault();
});
addEventListener("keyup", (e) => held.delete(e.code));

const any = (codes: string[]) => codes.some((c) => held.has(c));

let acc = 0;
app.ticker.add((t) => {
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

  syncView(view, player, level, scattered, acc / STEP, t.deltaMS / 1000, VIEW_W, VIEW_H);

  const gsp = Math.abs(player.grounded ? player.gsp : player.vx);
  const mode = player.spinning
    ? `SPINDASH ${player.spinRev.toFixed(1)}`
    : player.rolling
      ? player.grounded
        ? "rolling"
        : "ball"
      : player.grounded
        ? "running"
        : "air";
  const mins = Math.floor(player.time / 60);
  hud.text =
    `RINGS ${String(player.rings).padStart(3)}    TIME ${mins}:${String(Math.floor(player.time % 60)).padStart(2, "0")}` +
    `\n${gsp.toFixed(0).padStart(3)} px/s  ${(gsp / TILE).toFixed(1)} tiles/s   ${mode}` +
    (gsp > K.topSpeed ? `   +${(gsp - K.topSpeed).toFixed(0)} over running` : "") +
    (player.done ? "\nACT CLEAR" : "\narrows move  ·  down+space spindash  ·  down roll  ·  space jump  ·  r restart");
});

function resize() {
  const s = Math.max(1, Math.floor(Math.min(innerWidth / VIEW_W, innerHeight / VIEW_H)));
  app.renderer.resize(VIEW_W * s, VIEW_H * s);
  view.root.scale.set(s);
}
addEventListener("resize", resize);
resize();

// Exposed so Playwright can inspect the live scene graph and sim state.
Object.assign(window, { app, sim: { player, level, view, scattered } });
