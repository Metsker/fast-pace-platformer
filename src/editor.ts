// Paint chars into the level's own row strings. There is no editor document and no
// undo stack: the rows ARE the format, parseLevel is already the only reader, and the
// history lives in git. Editing is a string splice plus a re-parse.

import { TILE } from "./sim.ts";
import { getToken, list, load, save, setToken } from "./store.ts";

// Label per paintable char. The slope pieces are `SLOPE_CHARS` in sim.ts, and they are
// exposed raw rather than as a smart ramp tool - a climb has to start one row above a
// matching descent, and painting the halves by eye is what makes that visible.
const BRUSHES: [string, string][] = [
  [" ", "air"],
  ["#", "solid"],
  ["=", "shelf"],
  ["^", "spike"],
  ["o", "ring"],
  ["P", "post"],
  ["G", "goal"],
  ["@", "spawn"],
  ["c", "26up⌐"],
  ["C", "26up¬"],
  ["d", "26dn⌐"],
  ["D", "26dn¬"],
  ["u", "45up"],
  ["n", "45dn"],
  ["A", "63up"],
  ["B", "63dn"],
];

export const ed = {
  on: false,
  name: "act-1",
  sha: undefined as string | undefined,
  brush: "#",
  dirty: false,
  camX: 0,
  camY: 0,
};

const NEW_W = 200;
const NEW_H = 40;
const FLOOR = 30;

function blank(): string[] {
  const rows = Array.from({ length: NEW_H }, () => "");
  rows[FLOOR - 1] = "   @" + " ".repeat(NEW_W - 10) + "G";
  rows[FLOOR] = "#".repeat(NEW_W);
  for (let y = FLOOR + 1; y < NEW_H; y++) rows[y] = "#".repeat(NEW_W);
  return rows;
}

export async function initEditor(opts: {
  canvas: HTMLCanvasElement;
  scale: () => number;
  rows: () => string[];
  setLevel: (rows: string[]) => void;
}): Promise<void> {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const pick = $<HTMLSelectElement>("pick");
  const token = $<HTMLInputElement>("token");
  const status = $("status");

  const say = (msg: string, err = false) => {
    status.textContent = msg;
    status.style.color = err ? "#ff5777" : "#ffb915";
  };

  for (const [ch, label] of BRUSHES) {
    const b = document.createElement("button");
    b.textContent = label;
    b.classList.toggle("on", ch === ed.brush);
    b.onclick = () => {
      ed.brush = ch;
      for (const o of Array.from($("pal").children)) o.classList.toggle("on", o === b);
    };
    $("pal").appendChild(b);
  }

  token.value = getToken();
  token.oninput = () => setToken(token.value.trim());

  // --- level i/o ---------------------------------------------------------------

  async function open(name: string): Promise<void> {
    try {
      say(`loading ${name}...`);
      const f = await load(name);
      ed.name = name;
      ed.sha = f.sha;
      opts.setLevel(f.rows);
      pick.value = name;
      history.replaceState(null, "", `?lvl=${encodeURIComponent(name)}`);
      say(`${name} - ${f.rows.length} rows`);
    } catch (e) {
      say(String((e as Error).message), true);
    }
  }

  async function refresh(): Promise<void> {
    try {
      const names = await list();
      pick.replaceChildren(
        ...names.map((n) => new Option(n, n, false, n === ed.name)),
      );
    } catch (e) {
      say(String((e as Error).message), true);
    }
  }

  pick.onchange = () => open(pick.value);

  $("reload").onclick = () => {
    refresh();
    open(ed.name);
  };

  $("save").onclick = async () => {
    if (!getToken()) return say("paste a github token to save", true);
    try {
      say(`saving ${ed.name}...`);
      ed.sha = await save(ed.name, opts.rows(), ed.sha);
      say(`saved ${ed.name}`);
    } catch (e) {
      // A 409/422 here is the stale-sha case: someone else saved while you were editing.
      say(String((e as Error).message), true);
    }
  };

  $("new").onclick = async () => {
    const name = prompt("level name (a-z, 0-9, dash)")?.trim().toLowerCase();
    if (!name) return;
    // The name lands in an API path, so it is validated rather than escaped.
    if (!/^[a-z0-9-]{1,40}$/.test(name)) return say("name must be a-z 0-9 dash", true);
    ed.name = name;
    ed.sha = undefined; // no sha means "create" - GitHub 422s if it already exists
    opts.setLevel(blank());
    history.replaceState(null, "", `?lvl=${encodeURIComponent(name)}`);
    say(`${name} - unsaved`);
    await refresh();
    pick.value = name;
  };

  // --- painting ----------------------------------------------------------------

  const paint = (e: PointerEvent) => {
    const s = opts.scale();
    const tx = Math.floor((e.offsetX / s + ed.camX) / TILE);
    const ty = Math.floor((e.offsetY / s + ed.camY) / TILE);
    const rows = opts.rows();
    if (ty < 0 || ty >= rows.length || tx < 0) return;
    // Right button erases, so you never have to go back to the palette to fix a stroke.
    const ch = e.buttons & 2 ? " " : ed.brush;
    const row = rows[ty].padEnd(tx + 1, " ");
    if (row[tx] === ch) return;
    rows[ty] = row.slice(0, tx) + ch + row.slice(tx + 1);
    ed.dirty = true;
  };

  opts.canvas.addEventListener("pointerdown", (e) => {
    if (!ed.on) return;
    opts.canvas.setPointerCapture(e.pointerId);
    paint(e);
  });
  opts.canvas.addEventListener("pointermove", (e) => {
    if (ed.on && e.buttons) paint(e);
  });
  opts.canvas.addEventListener("contextmenu", (e) => ed.on && e.preventDefault());

  // The level in the URL is what a shared link carries, so a teammate's level is a link.
  ed.name = new URLSearchParams(location.search).get("lvl") ?? ed.name;
  await open(ed.name);
  refresh();
}
