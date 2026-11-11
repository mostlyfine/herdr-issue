import { describe, test, expect, beforeEach } from "bun:test";
import { H, makeCx, flush, tempHome } from "./fakes.js";
import * as store from "../mods/issues/store.js";
import Issues from "../mods/issues/main.js";

const BODY = "## Description\nDo it\n\n## Acceptance criteria\n- [x] a\n- [ ] b\n\n## Log\n";

function mount(props = null) {
  H.props = props;
  const cx = makeCx();
  const v = new Issues();
  v.init(null, cx);
  const render = () => { H.els = {}; H.texts = []; v.render(cx); return H.els; };
  return { v, cx, render };
}

const on = (els, id, ev) => els[id].on[ev];

async function seed() {
  await store.create({ title: "A", repository: "/src/a", body: BODY });
  await store.create({ title: "", repository: "", body: "" });
  await store.create({ title: "C", repository: "/src/c", body: BODY });
  await store.update(3, (m, b) => ({ meta: { ...m, status: "review", space: "work", branch: "issue/3", model: "opus", workspace: "w" }, body: b }));
}

// Runs fail at `git rev-parse`, so a started run shows up as a notification.
beforeEach(() => {
  H.reset(tempHome());
  H.exec = () => ({ code: 128, stdout: "", stderr: "" });
});

describe("Board", () => {
  test("renders columns and cards, hides expired, colors by space", async () => {
    await seed();
    await store.create({ title: "Old", repository: "", body: "" });
    await store.update(4, (m, b) => ({ meta: { ...m, status: "done", done_at: "2000-01-01 00:00" }, body: b }));
    H.spaces = [{ id: "s1", name: "work", status: "working", tabs: [] }];
    H.shared["space.colors"] = { s1: "ansi5" };
    const { render } = mount();
    await flush();
    const els = render();
    expect(Object.keys(els).filter((k) => k.startsWith("card-"))).toEqual(["card-1", "card-2", "card-3"]);
    expect(H.texts).toContain("(untitled)");
    expect(H.texts).toContain("☑ 1/2");
    expect(H.texts).toContain("w · c · opus · issue/3");
    expect(H.texts).not.toContain("Old");
  });

  test("space color: hex, theme name and default", async () => {
    await seed();
    H.spaces = [{ id: "s1", name: "work", tabs: [] }];
    const { render } = mount();
    await flush();
    for (const c of [{ s1: "#123456" }, { s1: "ansi9" }, undefined]) {
      H.shared["space.colors"] = c;
      expect(() => render()).not.toThrow();
    }
  });

  test("reloads when the folder changes and shows load errors", async () => {
    const { v, cx, render } = mount();
    await flush();
    expect(v.view.items).toEqual([]);
    await store.create({ title: "New", repository: "", body: "" });
    H.watchers.shift()();
    await flush();
    expect(v.view.items.map((i) => i.meta.title)).toEqual(["New"]);
    H.home = "/dev/null/nope";
    await v.view.reload(cx);
    render();
    expect(H.texts.some((t) => t.includes("nope") || t.includes("ENOTDIR"))).toBe(true);
  });

  test("keys", async () => {
    await seed();
    const { v, cx, render } = mount();
    await flush();
    const key = (k) => on(render(), "issues-board", "on_key_down")({ key: k }, cx);
    key("j"); expect(v.view.sel).toBe(1);
    key("down"); expect(v.view.sel).toBe(2);
    key("j"); key("j"); expect(v.view.sel).toBe(3);
    key("k"); expect(v.view.sel).toBe(2);
    key("up"); key("up"); expect(v.view.sel).toBe(1);
    key("e"); key("enter");
    expect(H.overlays.map((o) => o.props)).toEqual([{ view: "edit", id: 1 }, { view: "edit", id: 1 }]);
    key("n"); expect(H.overlays[2].props).toEqual({ view: "edit", id: undefined });
    key("d"); expect(H.overlays[3]).toMatchObject({ props: { view: "menu", id: 1, confirm: true }, height: 110 });
    key("]"); await flush();
    expect((await store.get(1)).meta.status).toBe("doing");
    await v.view.reload(cx);
    key("["); await flush();
    expect((await store.get(1)).meta.status).toBe("todo");
    await v.view.reload(cx);
    key("["); await flush();
    expect((await store.get(1)).meta.status).toBe("todo");
    key("r"); await flush();
    expect(H.notes[0].title).toBe("Cannot run issue #1");
    const stopped = cx.stopped;
    key("x"); expect(cx.stopped).toBe(stopped);
  });

  test("keys without a selection do nothing", async () => {
    const { cx, render } = mount();
    await flush();
    for (const k of ["e", "d", "r", "[", "]"]) on(render(), "issues-board", "on_key_down")({ key: k }, cx);
    expect(H.overlays).toEqual([]);
  });

  test("drag to another column changes status; release on own column opens the preview", async () => {
    await seed();
    const { v, cx, render } = mount();
    await flush();
    let els = render();
    on(els, "card-1", "on_mouse_down:left")();
    on(els, "col-todo", "on_mouse_move")({}, cx);
    on(els, "col-review", "on_mouse_move")({}, cx);
    on(els, "col-review", "on_mouse_move")({}, cx);
    els = render();
    on(els, "col-review", "on_mouse_up:left")({}, cx);
    await flush();
    expect((await store.get(1)).meta.status).toBe("review");
    expect(v.view.sel).toBe(1);

    els = render();
    on(els, "card-2", "on_mouse_down:left")();
    on(els, "col-todo", "on_mouse_up:left")({}, cx);
    expect(H.overlays.at(-1).props).toEqual({ view: "view", id: 2 });

    on(els, "col-todo", "on_mouse_up:left")({}, cx);
    on(els, "col-todo", "on_mouse_move")({}, cx);
    expect(v.view.over).toBeNull();
  });

  test("releasing outside a column cancels the drag", async () => {
    await seed();
    const { v, cx, render } = mount();
    await flush();
    const els = render();
    on(els, "issues-board", "on_mouse_up:left")({}, cx);
    on(els, "card-1", "on_mouse_down:left")();
    on(els, "issues-board", "on_mouse_up:left")({}, cx);
    expect(v.view.pressed).toBeNull();
  });

  test("right click opens the menu, taller when an agent runs", async () => {
    await seed();
    H.spaces = [{ id: "s1", name: "work", tabs: [] }];
    H.agents = [{ space: "s1", pane: "p" }];
    const { cx, render } = mount();
    await flush();
    const els = render();
    on(els, "card-1", "on_mouse_down:right")({}, cx);
    on(els, "card-3", "on_mouse_down:right")({}, cx);
    expect(H.overlays.map((o) => o.height)).toEqual([250, 282]);
  });

  test("cards with a running agent get a pane button that focuses it without starting a drag", async () => {
    await seed();
    H.spaces = [{ id: "s1", name: "work", tabs: [] }];
    H.agents = [{ space: "s1", pane: "p" }];
    const { v, cx, render } = mount();
    await flush();
    const els = render();
    expect(els["pane-1"]).toBeUndefined();
    on(els, "pane-3", "on_mouse_down:left")({}, cx);
    expect(H.runs).toContainEqual(["pane.focus", { pane: "p" }]);
    expect(v.view.pressed).toBeUndefined();
    expect(cx.stopped).toBeGreaterThan(0);
  });

  test("+ opens the new issue dialog", () => {
    const { render } = mount();
    on(render(), "issues-add", "on_click")();
    expect(H.overlays[0].props).toEqual({ view: "edit", id: undefined });
  });

  test("commands: focus and run-<id>", async () => {
    await seed();
    const { cx } = mount();
    await flush();
    const before = cx.focused;
    H.command("focus");
    await flush();
    expect(cx.focused).toBe(before + 1);
    H.command("run-1");
    await flush();
    expect(H.notes[0].title).toBe("Cannot run issue #1");
    H.command("other");
    await flush();
  });
});

describe("Edit", () => {
  test("new issue: template, empty title error, save with focused cwd", async () => {
    H.focused = { cwd: "/src/x" };
    const { v, cx, render } = mount({ view: "edit", overlay: "o1" });
    expect(v.view.body.value()).toContain("## Acceptance criteria");
    let els = render();
    expect(H.texts).toContain("New issue");
    await on(els, "issues-save", "on_click")({}, cx);
    els = render();
    expect(H.texts).toContain("Enter a title");
    v.view.title.set_value(" T ");
    await on(els, "issues-save", "on_click")({}, cx);
    const i = await store.get(1);
    expect(i.meta).toMatchObject({ title: "T", repository: "/src/x" });
    expect(H.closed).toEqual(["o1"]);
  });

  test("new issue without a focused pane gets an empty repository", async () => {
    const { v, cx, render } = mount({ view: "edit" });
    v.view.title.set_value("T");
    await on(render(), "issues-save", "on_click")({}, cx);
    expect((await store.get(1)).meta.repository).toBe("");
  });

  test("existing issue: loads, saves, reports conflicts", async () => {
    await seed();
    const { v, cx, render } = mount({ view: "edit", id: 1, overlay: "o2" });
    await flush();
    expect(v.view.title.value()).toBe("A");
    expect(render() && H.texts).toContain("Edit issue #1");
    v.view.title.set_value("A2");
    v.view.body.set_value("new body\n");
    await on(render(), "issues-save", "on_click")({}, cx);
    expect((await store.get(1)).meta.title).toBe("A2");
    v.view.title.set_value("A3");
    await on(render(), "issues-save", "on_click")({}, cx);
    render();
    expect(H.texts.some((t) => t.startsWith("changed on disk"))).toBe(true);
  });

  test("missing issue leaves the form empty; untitled loads as empty", async () => {
    await seed();
    const a = mount({ view: "edit", id: 9 });
    await flush();
    expect(a.v.view.issue).toBeNull();
    const b = mount({ view: "edit", id: 2 });
    await flush();
    expect(b.v.view.title.value()).toBe("");
  });

  test("escape and cancel close; other keys don't", () => {
    const { cx, render } = mount({ view: "edit", overlay: "o3" });
    const els = render();
    on(els, "issues-edit", "on_key_down")({ key: "a" }, cx);
    on(els, "issues-edit", "on_key_down")({ key: "escape" }, cx);
    on(els, "issues-cancel", "on_click")();
    expect(H.closed).toEqual(["o3", "o3"]);
  });
});

describe("Menu", () => {
  test("items run, edit, move; close after the action", async () => {
    await seed();
    const { v, cx, render } = mount({ view: "menu", id: 1, overlay: "m" });
    await flush();
    let els = render();
    expect(els["m-focus"]).toBeUndefined();
    on(els, "m-s-done", "on_click")({}, cx);
    els = render();
    expect(H.texts).toContain("Working…");
    await flush();
    expect((await store.get(1)).meta.status).toBe("done");
    expect(H.closed).toEqual(["m"]);
    v.view.busy = false;
    els = render();
    on(els, "m-edit", "on_click")({}, cx);
    on(els, "m-run", "on_click")({}, cx);
    await flush();
    expect(H.overlays[0].props).toEqual({ view: "edit", id: 1 });
    expect(H.notes[0].title).toBe("Cannot run issue #1");
  });

  test("Go to pane when an agent runs", async () => {
    await seed();
    H.spaces = [{ id: "s1", name: "work", tabs: [] }];
    H.agents = [{ space: "s1", pane: "p" }];
    const { render } = mount({ view: "menu", id: 3, overlay: "m" });
    await flush();
    on(render(), "m-focus", "on_click")();
    expect(H.runs).toContainEqual(["pane.focus", { pane: "p" }]);
    expect(H.closed).toEqual(["m"]);
  });

  test("delete asks first", async () => {
    await seed();
    const { cx, render } = mount({ view: "menu", id: 2, overlay: "m" });
    await flush();
    on(render(), "m-del", "on_click")({}, cx);
    let els = render();
    expect(H.texts).toContain("Delete issue #2?");
    on(els, "m-no", "on_click")();
    on(els, "m-yes", "on_click")({}, cx);
    await flush();
    expect(await store.get(2)).toBeNull();
    expect(H.closed).toEqual(["m", "m"]);
  });

  test("errors are notified; escape closes", async () => {
    const { cx, render } = mount({ view: "menu", id: 5, overlay: "m", confirm: true });
    await flush();
    const els = render();
    on(els, "m-yes", "on_click")({}, cx);
    await flush();
    expect(H.notes[0]).toMatchObject({ title: "issues", level: "error" });
    on(els, "issues-menu", "on_key_down")({ key: "q" }, cx);
    on(els, "issues-menu", "on_key_down")({ key: "escape" }, cx);
    expect(H.closed).toEqual(["m", "m"]);
  });
});

describe("Preview", () => {
  test("shows title and markdown body; close and edit", async () => {
    await seed();
    const { cx, render } = mount({ view: "view", id: 1, overlay: "p" });
    render();
    expect(H.texts).toContain("#1 ");
    await flush();
    const els = render();
    expect(H.texts).toContain("#1 A");
    expect(H.texts).toContain(BODY);
    on(els, "issues-view", "on_key_down")({ key: "a" }, cx);
    on(els, "issues-view", "on_key_down")({ key: "escape" }, cx);
    on(els, "issues-close", "on_click")();
    on(els, "issues-edit", "on_click")();
    expect(H.closed).toEqual(["p", "p", "p"]);
    expect(H.overlays[0].props).toEqual({ view: "edit", id: 1 });
  });

  test("run runs the issue, then closes", async () => {
    await seed();
    const { cx, render } = mount({ view: "view", id: 1, overlay: "p" });
    await flush();
    on(render(), "issues-run", "on_click")({}, cx);
    await flush();
    expect(H.notes[0].title).toBe("Cannot run issue #1");
    expect(H.closed).toEqual(["p"]);
  });
});
