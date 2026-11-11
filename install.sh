#!/usr/bin/env bash
# Copies the issues mod into herdr-app (it ignores symlinked mod folders) and symlinks the herdr-issues skill into Claude Code.
set -euo pipefail
root="$(cd "$(dirname "$0")" && pwd)"
app="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
mkdir -p "$app/mods/issues" "$HOME/.claude/skills"
chmod +x "$root/skills/herdr-issues/issues.sh"
[ -L "$app/mods/issues" ] && rm "$app/mods/issues" && mkdir -p "$app/mods/issues"
cp "$root"/mods/issues/*.js "$root"/mods/issues/mod.json "$app/mods/issues/"
echo "copied $app/mods/issues"
skill="$HOME/.claude/skills/herdr-issues"
if [ -e "$skill" ] && [ ! -L "$skill" ]; then echo "skip: $skill already exists" >&2; else ln -sfn "$root/skills/herdr-issues" "$skill"; echo "linked $skill"; fi
