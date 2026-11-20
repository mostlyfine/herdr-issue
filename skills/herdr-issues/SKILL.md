---
name: herdr-issues
description: Operate the herdr-app issue kanban (~/.config/herdr-app/data/issues/*.md). Create, list and read issues, append to the work log, check off Goal / Todo items, update status (todo/doing/waiting/done), and run issues. Use for "create an issue", "add to the ticket", "update the status", "run issue #N", "work on issue #N". The agent (claude / codex / copilot) started from the kanban records its progress with this skill.
---

# herdr-issues

Each issue is one markdown file at `~/.config/herdr-app/data/issues/<id>.md` (override with `ISSUES_DIR`). The Issues panel of herdr-app watches this folder, so file changes show up immediately.

## Always use issues.sh

`issues.sh` is in this skill's base directory (shown when the skill loads), whether it was installed as a plugin, with `npx skills`, or by `install.sh`. Run it directly as `<dir>/issues.sh ...` (it is executable). Do not put `bash ` inside `$S`: zsh does not word-split `$S`, so `S="bash ..."` fails with "no such file or directory".

```sh
S="<base directory of this skill>/issues.sh"   # issues.sh sits next to this SKILL.md
$S list                          # id, status, title, repository (tab separated)
$S show <id>                     # print the issue
$S path <id>                     # absolute path of the file
$S new "<title>" [repository] [workspace] [model] [worktree] [agent]  # create (repository defaults to cwd); prints the path
$S set <id> <workspace|repository|agent|model|worktree|title> "<value>"  # change a setting ("" clears it)
$S check <id> <n>                # check off Goal item n (from 1) and log it
$S check <id> todo <n>           # check off Todo item n (from 1) and log it
$S summary <id> "<text>"         # write (replace) the ## Summary section and log it
$S status <id> <status> [note]   # change status and log it
$S log <id> "<text>"             # append one line to the log
$S run <id>                      # run it like the kanban does (herdr-app must be running): worktree → agent
```

Edit the file directly (path from `path`) to write `## Summary`, `## Goal`, `## Todo`, `## Memo` and `## References`. Never hand-edit the frontmatter or `## Logs`; use the commands so `updated` and the log format stay right.

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
## Summary
Overview and background in a few lines.

## Goal
- [ ] One verifiable state per line, e.g. `make test` passes

## Todo
- [ ] One action per line

## Memo
Notes found while working, one paragraph each.

## References
- [PR #34](https://github.com/org/repo/pull/34)

## Logs
- 2026-11-10 10:05: Run started (branch issue/12-...)
```

workspace / repository / agent / model / worktree are not in the kanban form; set them in the frontmatter (keys stay even when empty).

On run: a worktree on `issue/<id>-…` is created in `repository` (or `worktree` is used; an existing worktree is reused). If `workspace` names an existing space a tab is added there, otherwise a space with that name is created, or `#<id> <title>` when empty. The program is `agent` (claude when empty); with `model` it starts as `<agent> --model <model>`. A legacy `repo:` key is read as repository.

Sections:
- `## Summary`: the overview and background of the task in a few lines, one sentence per line (break the line after each `。`, or `.` in English).
- `## Goal`: the done conditions as a checkbox list (`- [ ] ...`). Write each one as a verifiable state ("〜になっている"), not an action. When creating an issue, derive them from the summary.
- `## Todo`: the actions to reach the Goal as a checkbox list (`- [ ] ...`). Write each one as an action ("〜する").
- `## Memo`: notes found while working, written freely, one paragraph per topic.
- `## References`: links to related tickets, documents, Slack, mail, JIRA, GitHub and so on, as `- [title](url)`.
- `## Logs`: the work log, one line per entry as `- datetime: description`. Written only by the commands.

Always include these Goal items by issue type, and add them when they are missing from an existing issue:
- Implementation: `PR を作成する` and `PR の approve を受ける`. Do not set `done` before the approve is confirmed (e.g. `gh pr view`).
- Investigation: `調査した内容を記録する` (in `## Memo`) and `依頼者に Slack で返信する`.

Older issues may have `## Description`, `## Acceptance criteria` and `## Log` instead; `check <id> <n>` and `log` still work on them.

Status: `todo` not started, `doing` in progress, `waiting` blocked on someone else's action (a review, an answer, another task), `done` complete. Done issues leave the board after 24 hours (the file stays and `list` still shows it).

## When started from the kanban

The first message gives the issue number and file path. Work in this order:

1. Read it with `show <id>`. The current directory is a git worktree dedicated to this issue.
2. Work through `## Todo`, adding items when needed. Run `check <id> todo <n>` when one is done.
3. At each milestone (investigation, decision, implementation, tests) record one line with `log <id> "<what you did and the result>"`.
4. Write findings to `## Memo` and related links to `## References`.
5. Each time a Goal item is met, run `check <id> <n>`. Never check one you have not verified.
6. If you are blocked on someone else (an answer, a review, another task), run `status <id> waiting "<condition to resume>"`, then ask. Set `doing` again when you resume.
7. When every Goal item is met, run `status <id> done`.
