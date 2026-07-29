import { Application, Text } from "pixi.js";
import { loadGlyphs } from "./gfx/glyphs.ts";
import { PALETTE } from "./tilemap.ts";
import { BASE_SPEED, STEP, TOP_SPEED, newPlayer, parseLevel, respawn, step, type Input } from "./sim.ts";
import { TEST_LEVEL } from "./levels.ts";
import { buildView, pushTrail, syncView } from "./render.ts";

const VIEW_W = 640;
const VIEW_H = 360;

const level = parseLevel(TEST_LEVEL);
const player = newPlayer(level);
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
  if (e.code === "KeyR") respawn(player, level);
  e.preventDefault();
});
addEventListener("keyup", (e) => held.delete(e.code));

const any = (codes: string[]) => codes.some((c) => held.has(c));

let acc = 0;
app.ticker.add((t) => {
  input.x = (any(RIGHT) ? 1 : 0) - (any(LEFT) ? 1 : 0) as -1 | 0 | 1;
  input.down = any(DOWN);
  input.jump = any(JUMP);

  // Fixed timestep, clamped so a tab-switch does not spiral (TECH.md §3).
  acc += Math.min(t.deltaMS, 250) / 1000;
  while (acc >= STEP) {
    step(player, input, level);
    pushTrail(view, player);
    acc -= STEP;
    input.jumpDown = false;
  }

  syncView(view, player, acc / STEP, t.deltaMS / 1000, level, VIEW_W, VIEW_H);

  const speed = Math.abs(player.vx);
  const bar = "█".repeat(Math.round((speed / TOP_SPEED) * 24)).padEnd(24, "░");
  const descended = Math.max(0, (player.y - level.spawn.y) / 8);
  const state = player.diving ? "DIVE" : player.grounded ? "ground" : player.vy > 0 ? "FALLING +" : "rising";
  hud.text =
    `${speed.toFixed(0)} px/s   ${(speed / VIEW_W).toFixed(2)} screens/s   ` +
    (speed > BASE_SPEED ? `+${(speed - BASE_SPEED).toFixed(0)} over cruise` : "cruise") +
    `\n${bar}  ${state}   descended ${descended.toFixed(0)} of ${level.h} tiles\n` +
    `arrows move  ·  space jump / air jump  ·  down dive  ·  r respawn`;
});

function resize() {
  const s = Math.max(1, Math.floor(Math.min(innerWidth / VIEW_W, innerHeight / VIEW_H)));
  app.renderer.resize(VIEW_W * s, VIEW_H * s);
  view.root.scale.set(s);
}
addEventListener("resize", resize);
resize();

// Exposed so Playwright can inspect the live scene graph and sim state.
Object.assign(window, { app, sim: { player, level, view } });
