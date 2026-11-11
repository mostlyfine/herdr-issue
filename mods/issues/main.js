// One mod, three views: the board (in the right panel), and as overlays of itself
// props { view: "edit", id? } (add/edit dialog) and { view: "menu", id } (card menu).
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, EditorState, Editor, TextView } from "gpui-base";
import { props, theme, spaces, shared, openOverlay, closeOverlay, watchFolder, nextCommand, focused, notify } from "herdr";
import * as store from "./store.js";
import { runIssue, focusIssue, hasAgent } from "./runner.js";

// Same palette as the shipped spaces mod draws space avatars with.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const spaceColor = (t, space) => {
  const c = (shared("space.colors") ?? {})[space.id] ?? "ansi6";
  return c.startsWith("#") ? c : (MARK[c] ?? t[c]);
};

const FADE = { ms: 33, frames: 48, pulses: 2, min: 0.25 };

const NEW_BODY = "## Description\n\n\n## Acceptance criteria\n- [ ] \n\n## Log\n";

const openEdit = (id) => openOverlay({ mod: "issues", props: { view: "edit", id }, kind: "dialog", modal: true, width: 640, height: 520 });
const openView = (id) => openOverlay({ mod: "issues", props: { view: "view", id }, kind: "dialog", width: 640, height: 520 });
const openMenu = (id, agent, confirm = false) => openOverlay({ mod: "issues", props: { view: "menu", id, confirm }, kind: "popup", width: 200, height: confirm ? 110 : agent ? 282 : 250 });
const fail = (e) => notify({ title: "issues", body: String(e?.message ?? e), level: "error" });
const task = (cx, fn) => cx.spawn(async () => { try { await fn(); } catch (e) { fail(e); } });

function button(t, id, text, primary, action) {
  return h_flex().id(id).h(30).px(12).items_center().rounded(7).border_1()
    .border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
    .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).cursor_pointer()
    .hover((s) => s.opacity(0.88)).on_click(action).child(text);
}

class Board {
  init(cx) {
    this.items = [];
    this.sel = null;
    this.handle = cx.focus_handle();
    cx.spawn(async (cx) => {
      await this.reload(cx);
      for (;;) { await watchFolder(store.dir()); await this.reload(cx); }
    });
    cx.timer.every(10 * 60 * 1000, (cx) => cx.notify());
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") this.handle.focus();
        const run = /^run-(\d+)$/.exec(c);
        if (run) task(cx, () => runIssue(Number(run[1])));
        cx.notify();
      }
    });
  }

  async reload(cx) {
    const prev = this.loaded ? new Map(this.items.map((i) => [i.id, i.raw])) : null;
    try { this.items = await store.list(); this.loaded = true; } catch (e) { this.error = String(e?.message ?? e); }
    const changed = prev ? this.items.filter((i) => prev.get(i.id) !== i.raw) : [];
    if (changed.length) this.blink(changed.map((i) => i.id), cx);
    cx.notify();
  }

  // Added or changed cards fade out and back in twice.
  blink(ids, cx) {
    this.flash ??= new Set();
    ids.forEach((id) => this.flash.add(id));
    const running = this.frame !== undefined;
    this.frame = 0;
    if (!running) this.tick(cx);
  }

  tick(cx) {
    if (this.frame >= FADE.frames) { this.flash.clear(); this.frame = undefined; }
    else { this.frame++; cx.timer.after(FADE.ms, (cx) => this.tick(cx)); }
    cx.notify();
  }

  fade(id) {
    if (!this.flash?.has(id) || this.frame === undefined) return null;
    const wave = (1 - Math.cos(2 * Math.PI * FADE.pulses * this.frame / FADE.frames)) / 2;
    return 1 - (1 - FADE.min) * wave;
  }

  ordered() {
    return store.STATUSES.flatMap((s) => this.column(s));
  }

  column(s) {
    return this.items.filter((i) => (i.meta.status ?? "todo") === s && !store.expired(i));
  }

  drop(s, cx) {
    const issue = this.items.find((i) => i.id === this.pressed);
    this.pressed = null;
    this.over = null;
    if (!issue) return;
    // Released over its own column: a click (no on_click on cards, so presses can become drags).
    if ((issue.meta.status ?? "todo") !== s) task(cx, () => store.setStatus(issue.id, s));
    else openView(issue.id);
    this.sel = issue.id;
    cx.notify();
  }

  key(e, cx) {
    const list = this.ordered();
    const at = list.findIndex((i) => i.id === this.sel);
    const cur = list[at];
    const move = (d) => {
      const s = store.STATUSES[store.STATUSES.indexOf(cur.meta.status ?? "todo") + d];
      if (s) task(cx, () => store.setStatus(cur.id, s));
    };
    switch (e.key) {
      case "j": case "down": this.sel = list[Math.min(list.length - 1, at + 1)]?.id ?? null; break;
      case "k": case "up": this.sel = list[Math.max(0, at - 1)]?.id ?? null; break;
      case "n": openEdit(); break;
      case "e": case "enter": if (cur) openEdit(cur.id); break;
      case "d": if (cur) openMenu(cur.id, false, true); break;
      case "r": if (cur) task(cx, () => runIssue(cur.id)); break;
      case "[": if (cur) move(-1); break;
      case "]": if (cur) move(1); break;
      default: return;
    }
    cx.stop_propagation();
    cx.notify();
  }

  card(t, i) {
    const space = i.meta.space && spaces().find((s) => s.name === i.meta.space);
    const dot = space?.status ? t[space.status] : null;
    const edge = space ? spaceColor(t, space) : null;
    const repo = store.repoOf(i.meta).split("/").pop();
    const goals = store.criteria(i.body);
    const done = goals.filter((g) => g.done).length;
    const pane = hasAgent(i.meta);
    const info = [i.meta.workspace, repo, i.meta.agent, i.meta.model, i.meta.branch].filter(Boolean).join(" · ");
    const fade = this.fade(i.id);
    const sel = this.sel === i.id && this.handle.is_focused();
    return v_flex().id(`card-${i.id}`).gap(3).p(8).rounded(7).border_1()
      .border_color(edge ?? (sel ? t.accent : t.border)).bg(edge && sel ? t.selected : t.background).cursor_pointer()
      .when(fade !== null, (el) => el.opacity(fade))
      .when(this.pressed === i.id && this.over !== (i.meta.status ?? "todo"), (el) => el.opacity(0.5))
      .on_mouse_down("left", () => { this.pressed = i.id; this.over = i.meta.status ?? "todo"; })
      .hover((s) => s.bg(t.hover))
      .on_mouse_down("right", (_e, cx) => { this.sel = i.id; openMenu(i.id, hasAgent(i.meta)); cx.stop_propagation(); cx.notify(); })
      .child(h_flex().gap(6).items_center()
        .child(div().text_size(11).text_color(t.dim).child(`#${i.id}`))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).child(i.meta.title || "(untitled)"))
        .when(goals.length > 0, (el) => el.child(div().text_size(11).text_color(done === goals.length ? t.done : t.dim).child(`☑ ${done}/${goals.length}`)))
        .when(Boolean(dot), (el) => el.child(div().w(8).h(8).rounded(4).bg(dot))))
      .when(Boolean(info) || pane, (el) => el.child(h_flex().gap(6).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted)
          .child(info))
        // A press, not on_click: stopping it keeps the card from starting a drag.
        .when(pane, (row) => row.child(div().id(`pane-${i.id}`).flex_none().px(5).rounded(4).border_1().border_color(t.border)
          .text_size(10.5).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_mouse_down("left", (_e, cx) => { focusIssue(i.meta); cx.stop_propagation(); })
          .child("Pane ↗")))));
  }

  render() {
    const t = theme();
    return v_flex().id("issues-board").size_full().bg(t.chrome).text_color(t.foreground)
      .track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_up("left", (_e, cx) => { if (this.pressed !== null) { this.pressed = null; this.over = null; cx.notify(); } })
      .child(h_flex().h(34).px(10).items_center().border_b_1().border_color(t.border)
        .child(div().flex_1().text_size(13).font_semibold().child("Issues"))
        .child(div().id("issues-add").px(8).rounded(5).text_size(16).text_color(t.muted).cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => openEdit()).child("+")))
      .when(Boolean(this.error), (el) => el.child(div().p(8).text_size(11.5).text_color(t.blocked).child(this.error)))
      .child(v_flex().id("issues-cols").flex_1().min_h(0).overflow_y_scrollbar().p(8).gap(12).children(
        store.STATUSES.map((s) => {
          const items = this.column(s);
          const from = this.items.find((i) => i.id === this.pressed);
          const target = Boolean(from) && this.over === s && (from.meta.status ?? "todo") !== s;
          return v_flex().id(`col-${s}`).gap(6).p(4).min_h(36).rounded(8).border_1()
            .border_color(target ? t.accent : "#00000000").when(target, (el) => el.bg(t.hover))
            .on_mouse_move((_e, cx) => { if (this.pressed !== null && this.over !== s) { this.over = s; cx.notify(); } })
            .on_mouse_up("left", (_e, cx) => this.drop(s, cx))
            .child(h_flex().gap(6).text_size(11.5).text_color(t.dim)
              .child(div().font_semibold().child(store.LABELS[s])).child(div().child(String(items.length))))
            .children(items.map((i) => this.card(t, i)));
        })));
  }
}

class Edit {
  init(cx) {
    this.id = props()?.id ?? null;
    this.title = InputState.new({ value: "", placeholder: "Title" });
    this.body = EditorState.new({ language: "markdown", value: this.id ? "" : NEW_BODY, line_numbers: false, soft_wrap: true });
    this.handle = cx.focus_handle();
    this.title.focus();
    if (this.id) cx.spawn(async (cx) => {
      this.issue = await store.get(this.id);
      if (this.issue) {
        this.title.set_value(this.issue.meta.title ?? "");
        this.body.set_value(this.issue.body);
      }
      cx.notify();
    });
  }

  async save() {
    const title = this.title.value().trim();
    if (!title) { this.error = "Enter a title"; return; }
    if (this.issue) await store.save(this.issue, { ...this.issue.meta, title }, this.body.value());
    else await store.create({ title, repository: focused()?.cwd ?? "", body: this.body.value() });
    closeOverlay(props().overlay);
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const label = (text) => div().pt(12).pb(6).text_size(11.5).text_color(t.dim).child(text);
    const field = (state) => Input.new(state).h(34).px(10).rounded(8).border_1().border_color(t.input).bg(t.background).text_size(12.8).text_color(t.foreground);
    return v_flex().id("issues-edit").track_focus(this.handle).size_full().p(18).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
      .child(div().text_size(15).font_semibold().child(this.id ? `Edit issue #${this.id}` : "New issue"))
      .child(label("Title")).child(field(this.title))
      .child(label("Body (markdown)"))
      .child(div().flex_1().min_h(0).rounded(8).border_1().border_color(t.input).bg(t.background).overflow_hidden().child(Editor.new(this.body)))
      .when(Boolean(this.error), (el) => el.child(div().pt(8).text_size(11.5).text_color(t.blocked).child(this.error)))
      .child(h_flex().pt(14).gap(8).justify_end()
        .child(button(t, "issues-cancel", "Cancel", false, () => closeOverlay(p.overlay)))
        .child(button(t, "issues-save", "Save", true, (_e, cx) => cx.spawn(async (cx) => {
          try { await this.save(); } catch (e) { this.error = String(e?.message ?? e); }
          cx.notify();
        }))));
  }
}

class Menu {
  init(cx) {
    this.confirm = Boolean(props()?.confirm);
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.spawn(async (cx) => { this.issue = await store.get(props().id); cx.notify(); });
  }

  // Finish the work inside this copy's task before closing it: closing cancels its tasks.
  act(cx, fn) {
    this.busy = true;
    cx.notify();
    const overlay = props().overlay;
    task(cx, async () => { try { await fn(); } finally { closeOverlay(overlay); } });
  }

  render() {
    const t = theme();
    const { id } = props();
    const item = (key, text, action, color) => div().id(`m-${key}`).px(10).py(6).rounded(5).text_size(12.5)
      .text_color(color ?? t.foreground).cursor_pointer().hover((s) => s.bg(t.hover)).on_click(action).child(text);
    const root = v_flex().id("issues-menu").track_focus(this.handle).size_full().p(4).bg(t.popover)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); } });
    if (this.confirm) return root.gap(6).p(10)
      .child(div().text_size(12.5).child(`Delete issue #${id}?`))
      .child(h_flex().gap(8).justify_end()
        .child(button(t, "m-no", "No", false, () => closeOverlay(props().overlay)))
        .child(button(t, "m-yes", "Delete", true, (_e, cx) => this.act(cx, () => store.remove(id)))));
    if (this.busy) return root.p(10).child(div().text_size(12.5).text_color(t.muted).child("Working…"));
    return root
      .when(Boolean(this.issue && hasAgent(this.issue.meta)), (el) => el.child(item("focus", "Go to pane", () => { focusIssue(this.issue.meta); closeOverlay(props().overlay); })))
      .child(item("run", "▶ Run", (_e, cx) => this.act(cx, () => runIssue(id))))
      .child(item("edit", "Edit", (_e, cx) => this.act(cx, () => openEdit(id))))
      .children(store.STATUSES.map((s) => item(`s-${s}`, `Move to ${store.LABELS[s]}`, (_e, cx) => this.act(cx, () => store.setStatus(id, s)), t.muted)))
      .child(item("del", "Delete", (_e, cx) => { this.confirm = true; cx.notify(); }, t.blocked));
  }
}

class Preview {
  init(cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.spawn(async (cx) => { this.issue = await store.get(props().id); cx.notify(); });
  }

  render() {
    const t = theme();
    const p = props();
    const close = () => closeOverlay(p.overlay);
    return v_flex().id("issues-view").track_focus(this.handle).size_full().p(18).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => { if (e.key === "escape") { close(); cx.stop_propagation(); } })
      .child(h_flex().gap(8).items_start()
        .child(div().flex_1().min_w(0).text_size(15).font_semibold().child(`#${p.id} ${this.issue?.meta.title ?? ""}`))
        .child(div().id("issues-close").flex_none().p(3).rounded(4).text_color(t.dim).cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(close).child(svg("mods/pane/close.svg").size(14))))
      .child(div().id("issues-view-body").flex_1().min_h(0).mt(12).overflow_y_scrollbar().text_size(12.8)
        .child(TextView.markdown(`issues-md-${p.id}`, this.issue?.body ?? "")))
      .child(h_flex().pt(14).gap(8).justify_end()
        .child(button(t, "issues-run", "▶ Run", false, (_e, cx) => task(cx, async () => { try { await runIssue(p.id); } finally { close(); } })))
        .child(button(t, "issues-edit", "Edit", true, () => { closeOverlay(p.overlay); openEdit(p.id); })));
  }
}

const VIEWS = { edit: Edit, menu: Menu, view: Preview };

export default class Issues extends View {
  init(_props, cx) {
    this.view = new (VIEWS[props()?.view] ?? Board)();
    this.view.init(cx);
  }

  render(cx) {
    return this.view.render(cx);
  }
}
