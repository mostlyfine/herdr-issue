import { mock } from "bun:test";
import * as fs from "fs";

// Shared state the tests drive and inspect.
export const H = {
  reset(home) {
    Object.assign(H, {
      home, spaces: [], agents: [], props: null, shared: {}, focused: null,
      runs: [], notes: [], overlays: [], closed: [], execs: [],
      exec: () => ({ code: 0, stdout: "", stderr: "" }),
      watchers: [], waiting: [], commands: [], els: {}, texts: [],
    });
  },
  command(c) {
    const w = H.waiting.shift();
    if (w) w(c); else H.commands.push(c);
  },
};
H.reset("/nonexistent");

const theme = new Proxy({}, { get: (_t, k) => (typeof k === "string" ? `c:${k}` : undefined) });

mock.module("herdr", () => ({
  appHome: () => H.home,
  home: () => H.home,
  props: () => H.props,
  theme: () => theme,
  spaces: () => H.spaces,
  agents: () => H.agents,
  shared: (k) => H.shared[k],
  focused: () => H.focused,
  run: (name, args) => { H.runs.push([name, args]); return null; },
  notify: (n) => { H.notes.push(n); },
  openOverlay: (o) => { H.overlays.push(o); },
  closeOverlay: (id) => { H.closed.push(id); },
  exec: async (cmd, args, opts) => { H.execs.push([cmd, args, opts]); return H.exec(cmd, args, opts); },
  watchFolder: () => new Promise((r) => H.watchers.push(r)),
  nextCommand: () => (H.commands.length ? Promise.resolve(H.commands.shift()) : new Promise((r) => H.waiting.push(r))),
  readTextFile: async (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null),
  writeTextFile: async (p, text, expected) => {
    const cur = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
    if (expected === null ? cur !== null : cur !== expected) throw new Error(`changed on disk: ${p}`);
    fs.writeFileSync(p, text);
  },
}));

// A UI element: every builder method returns itself; handlers are kept by element id.
function el() {
  const rec = { id: null, on: {}, texts: [] };
  const self = new Proxy(rec, {
    get(_t, k) {
      if (k === "then") return undefined;
      if (k === "rec") return rec;
      if (k === "id") return (id) => { rec.id = id; H.els[id] = rec; return self; };
      if (k === "when") return (c, f) => (c ? f(self) : self);
      if (k === "hover") return (f) => { f(self); return self; };
      if (k === "child") return (c) => { if (typeof c === "string") { rec.texts.push(c); H.texts.push(c); } return self; };
      if (k === "on_mouse_down" || k === "on_mouse_up") return (b, f) => { rec.on[`${k}:${b}`] = f; return self; };
      if (typeof k === "string" && k.startsWith("on_")) return (f) => { rec.on[k] = f; return self; };
      return () => self;
    },
  });
  return self;
}

export class State {
  static new(o) { const s = new State(); s.v = o.value ?? ""; return s; }
  value() { return this.v; }
  set_value(v) { this.v = v; }
  focus() { this.focused = true; }
}

mock.module("gpui-kit", () => ({ View: class {}, div: el }));
mock.module("gpui-base", () => ({
  v_flex: el, h_flex: el,
  InputState: State, EditorState: State,
  Input: { new: el }, Editor: { new: el },
  TextView: { markdown: (_id, text) => { H.texts.push(text); return el(); } },
}));

export function makeCx() {
  const cx = {
    notified: 0, stopped: 0, focused: 0, tasks: [],
    notify() { cx.notified++; },
    stop_propagation() { cx.stopped++; },
    spawn(f) { const p = f(cx); cx.tasks.push(p); return p; },
    focus_handle: () => ({ focus() { cx.focused++; } }),
    timer: { every(_ms, f) { f(cx); } },
  };
  return cx;
}

export const flush = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

export function tempHome() {
  return fs.mkdtempSync(`${process.env.TMPDIR ?? "/tmp"}/issues-test-`);
}
