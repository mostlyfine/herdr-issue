---
name: herdr-issues
description: Operate the herdr-app issue kanban (~/.config/herdr-app/data/issues/*.md). Create, list and read issues, append to the work log, write a summary, update status (todo/doing/waiting/done), and run issues. Use for "create an issue", "add to the ticket", "update the status", "run issue #N", "work on issue #N". The agent (claude / codex / copilot) started from the kanban records its progress with this skill.
---

# herdr-issues

Each issue is one markdown file at `~/.config/herdr-app/data/issues/<id>.md` (override with `ISSUES_DIR`). The Issues panel of herdr-app watches this folder, so file changes show up immediately.

## Always use issues.sh

`issues.sh` is in this skill's base directory (shown when the skill loads), whether it was installed as a plugin, with `npx skills`, or by `install.sh`. Run it as `bash <dir>/issues.sh ...`.

```sh
S="bash <base directory of this skill>/issues.sh"   # issues.sh sits next to this SKILL.md
$S list                          # id, status, title, repository (tab separated)
$S show <id>                     # print the issue
$S path <id>                     # absolute path of the file
$S new "<title>" [repository] [workspace] [model] [worktree] [agent]  # create (repository defaults to cwd); prints the path
$S set <id> <workspace|repository|agent|model|worktree|title> "<value>"  # change a setting ("" clears it)
$S check <id> <n>                # check off acceptance criterion n (from 1) and log it
$S summary <id> "<text>"         # write (replace) the ## Summary section and log it
$S status <id> <status> [note]   # change status and log it
$S log <id> "<text>"             # append one line to the log
$S run <id>                      # run it like the kanban does (herdr-app must be running): worktree → agent
```

Edit the file directly (path from `path`) only to extend `## Description`. Never hand-edit the frontmatter, `## Summary` or `## Log`; use the commands so `updated` and the log format stay right.

## File format

```markdown
---
id: 12
title: Fix login form validation
status: todo
workspace: backend        # optional: herdr space to run in
repository: /path/to/repo # repository the worktree is created from
agent: claude             # optional: claude | codex | copilot (empty: claude)
model: opus               # optional: passed to the agent as --model
branch: issue/12-...      # set by the kanban on run
worktree: /path/to/worktree  # optional: empty → ~/.herdr/worktrees/<repo>/<branch>, set on run
space: #12 ...            # herdr space used for the run
tab: #12 ...              # tab name when added to an existing workspace
created: 2026-11-10 10:00
updated: 2026-11-10 10:00
done_at: 2026-11-10 12:00 # when it became done (removed for other statuses)
---
## Description
What to do

## Acceptance criteria
- [ ] One verifiable outcome per line
- [ ] e.g. `make test` passes

## Summary
What was done, results, open points

## Log
- 2026-11-10 10:05 Run started (branch issue/12-...)
```

workspace / repository / agent / model / worktree are not in the kanban form; set them in the frontmatter (keys stay even when empty).

On run: a worktree on `issue/<id>-…` is created in `repository` (or `worktree` is used; an existing worktree is reused). If `workspace` names an existing space a tab is added there, otherwise a space with that name is created, or `#<id> <title>` when empty. The program is `agent` (claude when empty); with `model` it starts as `<agent> --model <model>`. A legacy `repo:` key is read as repository.

Write `## Acceptance criteria` as a checkbox list (`- [ ] ...`). When creating an issue, derive verifiable criteria from the description.

Status: `todo` not started, `doing` in progress, `waiting` blocked on someone else's action (a review, an answer, another task), `done` complete. Done issues leave the board after 24 hours (the file stays and `list` still shows it).

## When started from the kanban

The first message gives the issue number and file path. Work in this order:

1. Read it with `show <id>`. The current directory is a git worktree dedicated to this issue.
2. At each milestone (investigation, decision, implementation, tests) record one line with `log <id> "<what you did and the result>"`.
3. Each time an acceptance criterion is met, run `check <id> <n>`. Never check one you have not verified.
4. If you are blocked on someone else (an answer, a review, another task), run `status <id> waiting "<condition to resume>"`, then ask. Set `doing` again when you resume.
5. When finished, write `summary <id> "<what was done, results, open points>"`, then `status <id> done`.
