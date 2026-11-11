import { describe, test, expect, beforeEach } from "bun:test";
import * as fs from "fs";
import { tempHome } from "./fakes.js";

const SH = `${import.meta.dir}/../skills/herdr-issues/issues.sh`;
let dir, bin;

function sh(...args) {
  const r = Bun.spawnSync(["bash", SH, ...args], { env: { ...process.env, ISSUES_DIR: dir, PATH: `${bin}:${process.env.PATH}` } });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}
const file = (id) => fs.readFileSync(`${dir}/${id}.md`, "utf8");
const meta = (id, k) => (file(id).match(new RegExp(`^${k}: ?(.*)$`, "m")) ?? [])[1];

beforeEach(() => {
  const home = tempHome();
  dir = `${home}/issues`;
  bin = `${home}/bin`;
  fs.mkdirSync(bin);
});

describe("new / list / show / path", () => {
  test("creates numbered files with the template", () => {
    expect(sh("list")).toEqual({ code: 0, out: "", err: "" });
    const a = sh("new", "First", "/src/a", "ws", "opus", "/wt", "codex");
    expect(a.out.trim()).toBe(`${dir}/1.md`);
    expect(file(1)).toMatch(/^---\nid: 1\ntitle: First\nstatus: todo\nworkspace: ws\nrepository: \/src\/a\nagent: codex\nmodel: opus\nworktree: \/wt\n/);
    expect(file(1)).toContain("## Description\n\n\n## Acceptance criteria\n- [ ] \n\n## Log\n");
    sh("new", "Second");
    expect(meta(2, "repository")).toBe(process.cwd());
    fs.writeFileSync(`${dir}/3.md`, "---\nid: 3\ntitle: Old\nstatus: done\nrepo: /old\n---\n");
    expect(sh("list").out).toBe(`#1\ttodo\tFirst\t/src/a\n#2\ttodo\tSecond\t${process.cwd()}\n#3\tdone\tOld\t/old\n`);
    expect(sh("show", "1").out).toBe(file(1));
    expect(sh("path", "2").out.trim()).toBe(`${dir}/2.md`);
  });

  test("errors", () => {
    expect(sh("new").err).toContain("title is required");
    expect(sh("show", "x").err).toContain("id must be a number: x");
    expect(sh("show", "9")).toMatchObject({ code: 1, err: "issues.sh: issue #9 not found\n" });
    const u = sh("bogus");
    expect(u.code).toBe(2);
    expect(u.out).toContain("Usage: issues.sh list");
  });
});

describe("edits", () => {
  beforeEach(() => {
    sh("new", "T", "/src");
    fs.writeFileSync(`${dir}/1.md`, file(1).replace("- [ ] \n", "- [ ] first\n- [ ] \n* [ ] second\n"));
  });

  test("set", () => {
    sh("set", "1", "model", "sonnet");
    expect(meta(1, "model")).toBe("sonnet");
    sh("set", "1", "agent", "copilot");
    expect(meta(1, "agent")).toBe("copilot");
    sh("set", "1", "workspace", "");
    expect(meta(1, "workspace")).toBe("");
    expect(sh("set", "1", "status", "x").err).toContain("set accepts");
  });

  test("set adds a missing key", () => {
    fs.writeFileSync(`${dir}/1.md`, "---\nid: 1\n---\nbody\n");
    sh("set", "1", "title", "New");
    expect(file(1)).toMatch(/^---\nid: 1\ntitle: New\nupdated: .*\n---\nbody\n/);
  });

  test("check numbers non-empty items", () => {
    sh("check", "1", "2");
    expect(file(1)).toContain("- [ ] first\n- [ ] \n* [x] second\n");
    expect(file(1)).toMatch(/- .* Acceptance criterion 2 met: second\n$/);
    expect(sh("check", "1", "3")).toMatchObject({ code: 1, err: "issues.sh: acceptance criterion 3 not found\n" });
    expect(fs.existsSync(`${dir}/1.md.tmp`)).toBe(false);
    expect(sh("check", "1", "a").err).toContain("give the acceptance criterion number");
  });

  test("summary is inserted before Log and replaced next time", () => {
    sh("log", "1", "started");
    sh("summary", "1", "first try");
    sh("summary", "1", "Did X.");
    const f = file(1);
    expect(f).toMatch(/\n## Summary\nDid X\.\n\n## Log\n- .* started\n- .* Summary updated\n- .* Summary updated\n$/);
    expect(f).not.toContain("first try");
    expect(sh("summary", "1").err).toContain("summary text is required");
  });

  test("summary is appended when there is no Log", () => {
    fs.writeFileSync(`${dir}/1.md`, "---\nid: 1\n---\n## Description\nx\n");
    sh("summary", "1", "S");
    expect(file(1)).toMatch(/## Description\nx\n\n## Summary\nS\n\n\n## Log\n- .* Summary updated\n$/);
  });

  test("status sets, keeps and clears done_at", () => {
    sh("status", "1", "done");
    const at = meta(1, "done_at");
    expect(at).toMatch(/^\d{4}-/);
    fs.writeFileSync(`${dir}/1.md`, file(1).replace(`done_at: ${at}`, "done_at: 2000-01-01 00:00"));
    sh("status", "1", "done", "still done");
    expect(meta(1, "done_at")).toBe("2000-01-01 00:00");
    sh("status", "1", "review");
    expect(meta(1, "done_at")).toBeUndefined();
    expect(meta(1, "status")).toBe("review");
    expect(file(1)).toMatch(/status → done\n- .* still done\n- .* status → review\n$/);
    expect(sh("status", "1", "nope").err).toContain("status must be one of");
  });

  test("log appends before the next section and creates Log if missing", () => {
    fs.writeFileSync(`${dir}/1.md`, "---\nid: 1\n---\n## Log\n- a\n\n## After\nz\n");
    sh("log", "1", "b");
    expect(file(1)).toMatch(/## Log\n- a\n- .* b\n\n## After\nz\n$/);
    fs.writeFileSync(`${dir}/1.md`, "---\nid: 1\n---\nbody\n");
    sh("log", "1", "c");
    expect(file(1)).toMatch(/body\n\n## Log\n- .* c\n$/);
    expect(sh("log", "1").err).toContain("log text is required");
  });
});

describe("run", () => {
  test("asks herdr-app to run the issue", () => {
    sh("new", "T");
    fs.writeFileSync(`${bin}/herdr-app`, `#!/bin/sh\necho "$@" > "${bin}/args"\n`, { mode: 0o755 });
    expect(sh("run", "1").out).toBe("asked herdr-app to run issue #1\n");
    expect(fs.readFileSync(`${bin}/args`, "utf8")).toBe("do issues.run-1\n");
  });

  test("reports a failing herdr-app", () => {
    sh("new", "T");
    fs.writeFileSync(`${bin}/herdr-app`, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    expect(sh("run", "1").err).toContain("could not ask herdr-app to run it");
  });

  test("reports a missing herdr-app", () => {
    sh("new", "T");
    const r = Bun.spawnSync(["/bin/bash", SH, "run", "1"], { env: { ISSUES_DIR: dir, PATH: "/usr/bin:/bin" } });
    expect(r.stderr.toString()).toContain("herdr-app not found");
  });
});
