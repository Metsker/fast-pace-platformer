// Paint chars into the level's own row strings. There is no editor document and no
// undo stack: the rows ARE the format, parseLevel is already the only reader, and the
// history lives in git. Editing is a string splice plus a re-parse.

import { TILE } from "./sim.ts";
import { ACT_1 } from "./levels.ts";
import { getToken, list, load, save, setToken } from "./store.ts";

// The generated act, bundled. It keeps the list from ever being empty and keeps the game
// startable when GitHub is unreachable or rate-limited - without it a failed fetch means
// no level at all, and there is nothing to render.
const BUILTIN = "act-1";

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
  menu: false,
  name: "act-1",
  sha: undefined as string | undefined,
  brush: "#",
  dirty: false,
  camX: 0,
  camY: 0,
};

// A level has one spawn and one goal, but the grid holds as many chars as you paint and
// parseLevel keeps the last in scan order. So a second `@` painted above the first loses
// to it silently - the paint lands in the rows, changes nothing, and reads as a marker
// that will not draw. Painting one clears the others.
const SINGLETON = "@G";

function clearOthers(rows: string[], ch: string, keepX: number, keepY: number): void {
  for (let y = 0; y < rows.length; y++) {
    for (let i = rows[y].indexOf(ch); i >= 0; i = rows[y].indexOf(ch, i + 1)) {
      if (y === keepY && i === keepX) continue;
      rows[y] = rows[y].slice(0, i) + " " + rows[y].slice(i + 1); // same length, i stays valid
    }
  }
}

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
  painted: (tx: number, ty: number, ch: string, was: string) => void;
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

  function show(name: string, rows: string[], sha?: string): void {
    ed.name = name;
    ed.sha = sha;
    opts.setLevel(rows);
    pick.value = name;
    history.replaceState(null, "", `?lvl=${encodeURIComponent(name)}`);
  }

  async function open(name: string): Promise<void> {
    try {
      say(`loading ${name}...`);
      const f = await load(name);
      show(name, f.rows, f.sha);
      say(`${name} - ${f.rows.length} rows`);
    } catch (e) {
      if (name !== BUILTIN) return say(String((e as Error).message), true);
      // A copy: the editor splices rows in place, and ACT_1 is a module constant that
      // every later fallback would inherit the edits of.
      show(name, [...ACT_1], undefined);
      say(`${name} - built in, not fetched`);
    }
  }

  async function refresh(): Promise<string[]> {
    let names: string[] = [];
    try {
      names = await list();
    } catch (e) {
      say(String((e as Error).message), true);
    }
    if (!names.includes(BUILTIN)) names = [BUILTIN, ...names];

    pick.replaceChildren(...names.map((n) => new Option(n, n, false, n === ed.name)));
    $("menu-list").replaceChildren(
      ...names.map((n) => {
        const b = document.createElement("button");
        b.textContent = n;
        b.onclick = () => {
          open(n);
          showMenu(false);
        };
        return b;
      }),
    );
    return names;
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
    if (SINGLETON.includes(ch)) clearOthers(rows, ch, tx, ty);
    opts.painted(tx, ty, ch, row[tx]);
  };

  // Left paints and right erases; the middle button is the pan drag and must not paint.
  const PAINTING = 1 | 2;

  opts.canvas.addEventListener("pointerdown", (e) => {
    if (!ed.on || !(e.buttons & PAINTING)) return;
    opts.canvas.setPointerCapture(e.pointerId);
    paint(e);
  });
  opts.canvas.addEventListener("pointermove", (e) => {
    if (ed.on && e.buttons & PAINTING) paint(e);
  });
  opts.canvas.addEventListener("contextmenu", (e) => ed.on && e.preventDefault());

  // A level has to be up before the first frame, so the list is fetched first and the
  // menu is laid over a level that is already loaded rather than over nothing.
  relist = refresh;
  const param = new URLSearchParams(location.search).get("lvl");
  const names = await refresh();
  ed.name = param ?? names[0] ?? ed.name;
  await open(ed.name);
  // A shared link names its level and goes straight in. Arriving without one is how you
  // get the list.
  if (!param) showMenu(true);
}

// Re-listed on every open, so a level a teammate added shows up without a reload.
let relist = async (): Promise<unknown> => undefined;

export function showMenu(on: boolean): void {
  ed.menu = on;
  document.getElementById("menu")!.classList.toggle("on", on);
  if (on) relist();
}
