import * as fs from "fs/promises";
import { appHome, readTextFile, writeTextFile } from "herdr";

export const STATUSES = ["todo", "doing", "waiting", "done"];
export const LABELS = { todo: "Todo", doing: "Doing", waiting: "Waiting", done: "Done" };
const KEYS = ["id", "title", "status", "workspace", "repository", "agent", "model", "branch", "worktree", "space", "tab", "created", "updated", "done_at"];

// Settings people fill in the file; written even when empty so they're there to edit.
const ALWAYS = ["workspace", "repository", "agent", "model", "worktree"];

// `repo` is the older name of `repository`.
export const repoOf = (meta) => meta.repository || meta.repo || "";
const LOG = "## Log";
const DONE = "## Acceptance criteria";

// The checkbox items under "## Acceptance criteria": [{ done, text }].
export function criteria(body) {
  const lines = body.split("\n");
  const at = lines.findIndex((l) => l.trim() === DONE);
  if (at < 0) return [];
  const out = [];
  for (const l of lines.slice(at + 1)) {
    if (l.startsWith("## ")) break;
    const m = /^\s*[-*] \[( |x|X)\]\s*(.*)$/.exec(l);
    if (m && m[2].trim()) out.push({ done: m[1] !== " ", text: m[2].trim() });
  }
  return out;
}

export const dir = () => `${appHome()}/data/issues`;
export const fileOf = (id) => `${dir()}/${id}.md`;

const pad = (n) => String(n).padStart(2, "0");
export function now() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function parse(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  const meta = {};
  if (!m) return { meta, body: text };
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: m[2] };
}

export function serialize(meta, body) {
  const keys = [...KEYS.filter((k) => k in meta || ALWAYS.includes(k)), ...Object.keys(meta).filter((k) => !KEYS.includes(k))];
  const head = keys.filter((k) => ALWAYS.includes(k) || (meta[k] !== undefined && meta[k] !== "")).map((k) => `${k}: ${String(meta[k] ?? "").replace(/\r?\n/g, " ")}`);
  return `---\n${head.join("\n")}\n---\n${body}`;
}

export function appendLog(body, text) {
  const entry = `- ${now()} ${text}`;
  const lines = body.replace(/\s+$/, "").split("\n");
  const at = lines.indexOf(LOG);
  if (at < 0) return `${lines.join("\n")}\n\n${LOG}\n${entry}\n`;
  let end = lines.findIndex((l, i) => i > at && l.startsWith("## "));
  if (end < 0) end = lines.length;
  while (end - 1 > at && lines[end - 1].trim() === "") end--;
  lines.splice(end, 0, entry);
  return `${lines.join("\n")}\n`;
}

export async function list() {
  await fs.mkdir(dir(), { recursive: true });
  const names = (await fs.readdir(dir())).filter((n) => /^\d+\.md$/.test(n));
  const out = [];
  for (const n of names) {
    const raw = await readTextFile(`${dir()}/${n}`);
    if (raw == null) continue;
    const { meta, body } = parse(raw);
    out.push({ id: Number(meta.id ?? n.replace(".md", "")), meta, body, raw, file: `${dir()}/${n}` });
  }
  return out.sort((a, b) => a.id - b.id);
}

export async function get(id) {
  return (await list()).find((i) => i.id === Number(id)) ?? null;
}

export async function create({ title, repository, body }) {
  const items = await list();
  const id = items.reduce((m, i) => Math.max(m, i.id), 0) + 1;
  const t = now();
  const meta = { id, title, status: "todo", repository, created: t, updated: t };
  await writeTextFile(fileOf(id), serialize(meta, body), null);
  return id;
}

// Rewrites an issue read by list()/get(); fails if the file changed since.
export async function save(issue, meta, body) {
  await writeTextFile(issue.file, serialize({ ...meta, updated: now() }, body), issue.raw);
}

export async function update(id, fn) {
  const issue = await get(id);
  if (!issue) throw new Error(`issue #${id} not found`);
  const next = fn({ ...issue.meta }, issue.body);
  await save(issue, next.meta, next.body);
}

export const setStatus = (id, status, note) =>
  update(id, (meta, body) => ({
    meta: { ...meta, status, done_at: status === "done" ? (meta.status === "done" && meta.done_at) || now() : undefined },
    body: appendLog(body, note ?? `status → ${status}`),
  }));

// Done issues leave the board a day after they were done (the file stays).
const DAY = 24 * 60 * 60 * 1000;
const time = (s) => (s ? new Date(s.replace(" ", "T")).getTime() : NaN);
export const expired = (issue) => issue.meta.status === "done" && Date.now() - time(issue.meta.done_at || issue.meta.updated) > DAY;

export const remove = (id) => fs.unlink(fileOf(id));
