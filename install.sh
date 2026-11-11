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
mkdir -p "$app/mods/tabs-issues" "$app/layouts"
cp "$root"/mods/tabs-issues/* "$app/mods/tabs-issues/"
layout="$(cat "$root/layouts/main-issues.json")"
for m in agents-ws pane-ws; do
  [ -d "$app/mods/$m" ] || { layout="${layout//\"mod\": \"$m\"/\"mod\": \"${m%-ws}\"}"; echo "$m not found: using ${m%-ws}"; }
done
printf '%s\n' "$layout" > "$app/layouts/main-issues.json"
echo "copied $app/mods/tabs-issues and $app/layouts/main-issues.json"
skill="$HOME/.claude/skills/herdr-issues"
if [ -e "$skill" ] && [ ! -L "$skill" ]; then echo "skip: $skill already exists" >&2; else ln -sfn "$root/skills/herdr-issues" "$skill"; echo "linked $skill"; fi
