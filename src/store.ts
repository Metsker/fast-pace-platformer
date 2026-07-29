// Levels are text files in this repo, and GitHub is the database. No server to run, no
// account beyond the one everyone already has, the history is the undo, and a save is a
// commit. Reads are unauthenticated - a public repo, so anyone can play. Only saving
// needs a token, and only the people who already have push access can get one.
//
// The API is used for reads rather than raw.githubusercontent because raw is CDN-cached
// for ~5 minutes, and a teammate's save that takes 5 minutes to appear is not shared.

const REPO = "Metsker/fast-pace-platformer";
const API = `https://api.github.com/repos/${REPO}/contents/levels`;
const TOKEN_KEY = "gh-token";

export const getToken = (): string => localStorage.getItem(TOKEN_KEY) ?? "";
export const setToken = (t: string): void => {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
};

async function req(url: string, init?: RequestInit): Promise<any> {
  const token = getToken();
  const r = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${body.message ?? r.statusText}`);
  return body;
}

export const list = async (): Promise<string[]> =>
  (await req(API))
    .filter((f: any) => f.name.endsWith(".txt"))
    .map((f: any) => f.name.slice(0, -4))
    .sort();

// The sha is the whole concurrency story: GitHub rejects a PUT carrying a stale one, so
// two people editing the same level get an error instead of one silently winning.
export async function load(name: string): Promise<{ rows: string[]; sha: string }> {
  const f = await req(`${API}/${encodeURIComponent(name)}.txt`);
  const text = atob(f.content); // level chars are all ASCII, so no UTF-8 decode needed
  return { rows: text.replace(/\n$/, "").split("\n"), sha: f.sha };
}

// `sha` is undefined for a level that does not exist yet - GitHub reads that as a create
// and 422s if the file is in fact already there, which is the collision we want.
export async function save(name: string, rows: string[], sha?: string): Promise<string> {
  const body = rows.map((r) => r.replace(/\s+$/, "")).join("\n") + "\n";
  const res = await req(`${API}/${encodeURIComponent(name)}.txt`, {
    method: "PUT",
    body: JSON.stringify({ message: `level: ${name}`, content: btoa(body), sha }),
  });
  return res.content.sha;
}
