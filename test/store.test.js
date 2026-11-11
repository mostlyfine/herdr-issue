import { describe, test, expect, beforeEach } from "bun:test";
import * as fs from "fs";
import { H, tempHome } from "./fakes.js";
import * as store from "../mods/issues/store.js";

const BODY = "## Description\nDo it\n\n## Acceptance criteria\n- [ ] a\n- [x] b\n- [ ] \n\n## Log\n";

beforeEach(() => H.reset(tempHome()));

describe("parse / serialize", () => {
  test("round trip keeps known keys in order, always writes settings, keeps unknown keys", () => {
    const text = store.serialize({ title: "T", id: 3, extra: "x", branch: "" }, "body\n");
    expect(text).toBe("---\nid: 3\ntitle: T\nworkspace: \nrepository: \nmodel: \nworktree: \nextra: x\n---\nbody\n");
    const { meta, body } = store.parse(text);
    expect(meta).toEqual({ id: "3", title: "T", workspace: "", repository: "", model: "", worktree: "", extra: "x" });
    expect(body).toBe("body\n");
  });

  test("newlines in values are flattened", () => {
    expect(store.serialize({ title: "a\nb" }, "")).toContain("title: a b");
  });

  test("text without frontmatter is all body", () => {
    expect(store.parse("hello")).toEqual({ meta: {}, body: "hello" });
  });

  test("lines without a key are ignored", () => {
    expect(store.parse("---\nnokey\n: v\nk: a: b\n---\n").meta).toEqual({ k: "a: b" });
  });
});

test("repoOf prefers repository, falls back to repo", () => {
  expect(store.repoOf({ repository: "/a", repo: "/b" })).toBe("/a");
  expect(store.repoOf({ repo: "/b" })).toBe("/b");
  expect(store.repoOf({})).toBe("");
});

describe("criteria", () => {
  test("reads checkboxes under Acceptance criteria and skips empty ones", () => {
    expect(store.criteria(BODY)).toEqual([{ done: false, text: "a" }, { done: true, text: "b" }]);
  });
  test("no section → empty", () => {
    expect(store.criteria("## Description\n- [ ] a\n")).toEqual([]);
  });
});

describe("appendLog", () => {
  test("appends at the end of Log", () => {
    const out = store.appendLog(BODY + "- old\n\n", "new");
    expect(out).toMatch(/- old\n- \d{4}-\d\d-\d\d \d\d:\d\d new\n$/);
  });
  test("inserts before the next heading", () => {
    const out = store.appendLog("## Log\n- old\n\n## After\nx\n", "new");
    expect(out).toMatch(/## Log\n- old\n- .* new\n\n## After\nx\n$/);
  });
  test("adds the section when missing", () => {
    expect(store.appendLog("text\n", "new")).toMatch(/^text\n\n## Log\n- .* new\n$/);
  });
});

test("now is YYYY-MM-DD HH:MM", () => {
  expect(store.now()).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d$/);
});

describe("files", () => {
  test("create / list / get", async () => {
    expect(await store.list()).toEqual([]);
    const a = await store.create({ title: "A", repository: "/r", body: BODY });
    const b = await store.create({ title: "B", repository: "", body: "" });
    expect([a, b]).toEqual([1, 2]);
    fs.writeFileSync(`${store.dir()}/notes.txt`, "ignored");
    const all = await store.list();
    expect(all.map((i) => [i.id, i.meta.title, i.meta.status])).toEqual([[1, "A", "todo"], [2, "B", "todo"]]);
    expect((await store.get("2")).meta.title).toBe("B");
    expect(await store.get(9)).toBeNull();
    expect(store.fileOf(1)).toBe(`${H.home}/data/issues/1.md`);
  });

  test("id falls back to the file name", async () => {
    fs.mkdirSync(store.dir(), { recursive: true });
    fs.writeFileSync(`${store.dir()}/7.md`, "no frontmatter");
    expect((await store.list())[0].id).toBe(7);
  });

  test("save fails when the file changed since it was read", async () => {
    await store.create({ title: "A", repository: "", body: "" });
    const issue = await store.get(1);
    fs.appendFileSync(issue.file, "x");
    await expect(store.save(issue, issue.meta, "b")).rejects.toThrow("changed");
  });

  test("update of a missing issue throws", async () => {
    await expect(store.update(5, (m, b) => ({ meta: m, body: b }))).rejects.toThrow("issue #5 not found");
  });

  test("setStatus sets, keeps and clears done_at and logs", async () => {
    await store.create({ title: "A", repository: "", body: BODY });
    await store.setStatus(1, "done");
    let i = await store.get(1);
    expect(i.meta.status).toBe("done");
    expect(i.meta.done_at).toMatch(/^\d{4}/);
    expect(i.body).toContain("status → done");
    await store.update(1, (m, b) => ({ meta: { ...m, done_at: "2000-01-01 00:00" }, body: b }));
    await store.setStatus(1, "done", "again");
    i = await store.get(1);
    expect(i.meta.done_at).toBe("2000-01-01 00:00");
    expect(i.body).toContain("again");
    await store.setStatus(1, "review");
    expect((await store.get(1)).meta.done_at).toBeUndefined();
  });

  test("remove deletes the file", async () => {
    await store.create({ title: "A", repository: "", body: "" });
    await store.remove(1);
    expect(await store.list()).toEqual([]);
  });
});

test("expired: done for over a day, using done_at or updated", () => {
  const old = "2000-01-01 00:00";
  expect(store.expired({ meta: { status: "done", done_at: old } })).toBe(true);
  expect(store.expired({ meta: { status: "done", updated: old } })).toBe(true);
  expect(store.expired({ meta: { status: "done", done_at: store.now() } })).toBe(false);
  expect(store.expired({ meta: { status: "review", done_at: old } })).toBe(false);
  expect(store.expired({ meta: { status: "done" } })).toBe(false);
});
