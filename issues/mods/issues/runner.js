import { exec, home, run, spaces, agents, notify } from "herdr";
import * as store from "./store.js";

const AGENTS = ["claude", "codex", "copilot"];

// Same checkout location and slug rule as the shipped worktree mod.
const slug = (s) => s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");

async function git(cwd, args) {
  const r = await exec("git", args, { cwd });
  return { ok: r.code === 0, out: r.stdout.trim(), err: r.stderr.trim() };
}

function task(issue) {
  return `Use the herdr-issues skill to work on issue #${issue.id} (${issue.file}). ` +
    `Read the file and do what "## Description" says. Log each milestone, and check off each acceptance criterion once you have verified it. ` +
    `If you are blocked on someone else, set the status to waiting with the condition to resume. ` +
    `When finished, write a summary with \`issues.sh summary\` and set the status to done.`;
}

function locate(meta) {
  const space = meta.space && spaces().find((s) => s.name === meta.space);
  if (!space) return null;
  const tab = meta.tab ? space.tabs.find((t) => t.name === meta.tab) : null;
  if (meta.tab && !tab) return null;
  const agent = agents().find((a) => a.space === space.id && (!tab || a.tab === tab.id));
  return { space, tab, agent };
}

export const hasAgent = (meta) => Boolean(locate(meta)?.agent);

// Shows the space/tab an issue was run in and focuses its agent's pane. False if it isn't open.
export function focusIssue(meta) {
  const at = locate(meta);
  if (!at) return false;
  run("space.select", { id: at.space.id });
  if (at.tab) run("tab.select", { id: at.tab.id });
  if (at.agent) run("pane.focus", { pane: at.agent.pane });
  return true;
}

export async function runIssue(id) {
  const issue = await store.get(id);
  if (!issue) return;
  const { meta } = issue;
  if (focusIssue(meta)) return;
  try {
    const agent = meta.agent || "claude";
    if (!AGENTS.includes(agent)) throw new Error(`unknown agent: ${agent}`);
    const repoPath = store.repoOf(meta);
    if (!repoPath) throw new Error("repository is not set");
    const top = await git(repoPath, ["rev-parse", "--show-toplevel"]);
    if (!top.ok) throw new Error(`not a git repository: ${repoPath}`);
    const repo = top.out;
    const branch = meta.branch || `issue/${issue.id}${slug(meta.title ?? "") ? `-${slug(meta.title).toLowerCase().slice(0, 40)}` : ""}`;
    const path = meta.worktree || `${home()}/.herdr/worktrees/${repo.split("/").pop()}/${slug(branch)}`;
    const wt = await git(repo, ["worktree", "list", "--porcelain"]);
    if (!wt.out.split("\n").includes(`worktree ${path}`)) {
      const exists = (await git(repo, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])).ok;
      const add = await git(repo, exists ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path, "HEAD"]);
      if (!add.ok) throw new Error(add.err || "git worktree add failed");
    }
    const name = `#${issue.id} ${meta.title ?? ""}`.trim();
    const argv = meta.model ? [agent, "--model", meta.model] : [agent];
    // workspace: an existing space gets a new tab; an unknown name becomes a new space.
    const target = meta.workspace && spaces().find((s) => s.name === meta.workspace);
    const space = meta.workspace || name;
    const tab = target ? name : undefined;
    const { repo: _old, ...rest } = meta;
    await store.save(issue, { ...rest, repository: rest.repository || repoPath, status: "doing", branch, worktree: path, space, tab },
      store.appendLog(issue.body, `Run started (space ${space}${tab ? ` / tab ${tab}` : ""}, branch ${branch}${agent !== "claude" ? `, agent ${agent}` : ""}${meta.model ? `, model ${meta.model}` : ""})`));
    if (target) run("tab.new", { space: target.id, name, folder: path, argv, task: task(issue) });
    else run("space.new", { name: space, folder: path, argv, task: task(issue) });
  } catch (e) {
    notify({ title: `Cannot run issue #${issue.id}`, body: String(e?.message ?? e), level: "error" });
    await store.update(issue.id, (m, b) => ({ meta: m, body: store.appendLog(b, `Run failed: ${e?.message ?? e}`) })).catch(() => {});
  }
}
