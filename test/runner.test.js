import { describe, test, expect, beforeEach } from "bun:test";
import { H, tempHome } from "./fakes.js";
import * as store from "../mods/issues/store.js";
import { runIssue, focusIssue, hasAgent } from "../mods/issues/runner.js";

const BODY = "## Description\nDo it\n\n## Acceptance criteria\n- [ ] a\n\n## Log\n";

// git fake: `top` is the toplevel (null: not a repo), `trees` the worktree paths, `branches` existing branches.
function git({ top = "/src/repo", trees = [], branches = [], addFails = false } = {}) {
  H.exec = (cmd, args) => {
    expect(cmd).toBe("git");
    if (args[0] === "rev-parse") return top ? { code: 0, stdout: `${top}\n`, stderr: "" } : { code: 128, stdout: "", stderr: "fatal" };
    if (args[0] === "worktree" && args[1] === "list") return { code: 0, stdout: trees.map((t) => `worktree ${t}`).join("\n"), stderr: "" };
    if (args[0] === "show-ref") return { code: branches.includes(args[3].replace("refs/heads/", "")) ? 0 : 1, stdout: "", stderr: "" };
    if (args[0] === "worktree" && args[1] === "add") return addFails ? { code: 1, stdout: "", stderr: addFails === true ? "" : addFails } : { code: 0, stdout: "", stderr: "" };
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
}

const gitCalls = () => H.execs.map(([, a]) => a);
const lastLog = async (id) => (await store.get(id)).body.trim().split("\n").pop();

beforeEach(() => H.reset(tempHome()));

describe("focusIssue / hasAgent", () => {
  beforeEach(() => {
    H.spaces = [{ id: "s1", name: "work", tabs: [{ id: "t1", name: "#1 A" }] }];
    H.agents = [{ space: "s1", tab: "t1", pane: "p1" }];
  });

  test("no space → false", () => {
    expect(focusIssue({})).toBe(false);
    expect(focusIssue({ space: "nope" })).toBe(false);
    expect(hasAgent({ space: "nope" })).toBe(false);
    expect(H.runs).toEqual([]);
  });

  test("missing tab → false", () => {
    expect(focusIssue({ space: "work", tab: "other" })).toBe(false);
  });

  test("selects space and tab and focuses the agent pane", () => {
    expect(hasAgent({ space: "work", tab: "#1 A" })).toBe(true);
    expect(focusIssue({ space: "work", tab: "#1 A" })).toBe(true);
    expect(H.runs).toEqual([["space.select", { id: "s1" }], ["tab.select", { id: "t1" }], ["pane.focus", { pane: "p1" }]]);
  });

  test("space without tab or agent", () => {
    H.agents = [];
    expect(hasAgent({ space: "work" })).toBe(false);
    expect(focusIssue({ space: "work" })).toBe(true);
    expect(H.runs).toEqual([["space.select", { id: "s1" }]]);
  });
});

describe("runIssue", () => {
  test("missing issue does nothing", async () => {
    await runIssue(42);
    expect(H.runs).toEqual([]);
  });

  test("already open: focus only", async () => {
    await store.create({ title: "A", repository: "/src/repo", body: BODY });
    await store.update(1, (m, b) => ({ meta: { ...m, space: "work" }, body: b }));
    H.spaces = [{ id: "s1", name: "work", tabs: [] }];
    await runIssue(1);
    expect(H.runs).toEqual([["space.select", { id: "s1" }]]);
    expect(H.execs).toEqual([]);
  });

  test("no repository: notify and log", async () => {
    await store.create({ title: "A", repository: "", body: BODY });
    await runIssue(1);
    expect(H.notes[0]).toMatchObject({ title: "Cannot run issue #1", body: "repository is not set", level: "error" });
    expect(await lastLog(1)).toMatch(/Run failed: repository is not set$/);
  });

  test("not a git repository", async () => {
    git({ top: null });
    await store.create({ title: "A", repository: "/tmp/x", body: BODY });
    await runIssue(1);
    expect(H.notes[0].body).toBe("not a git repository: /tmp/x");
  });

  test("worktree add failure uses stderr or a default", async () => {
    git({ addFails: "boom" });
    await store.create({ title: "A", repository: "/src/repo", body: BODY });
    await runIssue(1);
    expect(H.notes[0].body).toBe("boom");
    git({ addFails: true });
    await runIssue(1);
    expect(H.notes[1].body).toBe("git worktree add failed");
  });

  test("new branch → new space named after the issue", async () => {
    git();
    await store.create({ title: "Fix Login!", repository: "/src/repo/sub", body: BODY });
    await runIssue(1);
    const path = `${H.home}/.herdr/worktrees/repo/issue-1-fix-login`;
    expect(gitCalls()).toContainEqual(["worktree", "add", "-b", "issue/1-fix-login", path, "HEAD"]);
    const [name, args] = H.runs[0];
    expect(name).toBe("space.new");
    expect(args).toMatchObject({ name: "#1 Fix Login!", folder: path, argv: ["claude"] });
    expect(args.task).toContain("issue #1");
    expect(args.task).toContain("issues.sh summary");
    expect(args.task).not.toContain("/goal");
    const i = await store.get(1);
    expect(i.meta).toMatchObject({ status: "doing", branch: "issue/1-fix-login", worktree: path, space: "#1 Fix Login!", repository: "/src/repo/sub" });
    expect(i.meta.tab).toBeUndefined();
    expect(await lastLog(1)).toMatch(/Run started \(space #1 Fix Login!, branch issue\/1-fix-login\)$/);
  });

  test("existing branch is checked out; untitled issue gets a plain branch", async () => {
    git({ branches: ["issue/1"] });
    await store.create({ title: "", repository: "/src/repo", body: BODY });
    await runIssue(1);
    expect(gitCalls()).toContainEqual(["worktree", "add", `${H.home}/.herdr/worktrees/repo/issue-1`, "issue/1"]);
  });

  test("existing workspace gets a tab; model, worktree and old repo key are used", async () => {
    git({ trees: ["/wt/x"] });
    H.spaces = [{ id: "s9", name: "backend", tabs: [] }];
    await store.create({ title: "A", repository: "", body: BODY });
    await store.update(1, (m, b) => ({ meta: { ...m, repository: "", repo: "/src/repo", workspace: "backend", model: "opus", worktree: "/wt/x", branch: "feat" }, body: b }));
    await runIssue(1);
    expect(gitCalls().some((a) => a[1] === "add")).toBe(false);
    expect(H.runs[0]).toEqual(["tab.new", expect.objectContaining({ space: "s9", name: "#1 A", folder: "/wt/x", argv: ["claude", "--model", "opus"] })]);
    const i = await store.get(1);
    expect(i.meta).toMatchObject({ space: "backend", tab: "#1 A", repository: "/src/repo", branch: "feat" });
    expect(i.meta.repo).toBeUndefined();
    expect(await lastLog(1)).toMatch(/Run started \(space backend \/ tab #1 A, branch feat, model opus\)$/);
  });

  test("unknown workspace becomes a new space with that name", async () => {
    git();
    await store.create({ title: "A", repository: "/src/repo", body: BODY });
    await store.update(1, (m, b) => ({ meta: { ...m, workspace: "newspace" }, body: b }));
    await runIssue(1);
    expect(H.runs[0][0]).toBe("space.new");
    expect(H.runs[0][1].name).toBe("newspace");
  });

  test("non-Error failures are reported as text", async () => {
    H.exec = () => { throw "plain"; };
    await store.create({ title: "A", repository: "/src/repo", body: BODY });
    await runIssue(1);
    expect(H.notes[0].body).toBe("plain");
  });
});
