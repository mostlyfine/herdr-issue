#!/usr/bin/env bash
# Usage: issues.sh list | show <id> | path <id> | new <title> [repository] [workspace] [model] [worktree] | set <id> <workspace|repository|model|worktree|title> <value> | check <id> <n> | status <id> <todo|doing|review|done> [note] | log <id> <text> | summary <id> <text> | run <id>
set -euo pipefail

dir="${ISSUES_DIR:-${HERDR_APP_HOME:-$HOME/.config/herdr-app}/data/issues}"
now() { date '+%Y-%m-%d %H:%M'; }
die() { echo "issues.sh: $*" >&2; exit 1; }
file_of() { [[ "${1:-}" =~ ^[0-9]+$ ]] || die "id must be a number: ${1:-}"; f="$dir/$1.md"; [ -f "$f" ] || die "issue #$1 not found"; echo "$f"; }
meta() { awk -v k="$2" 'NR==1&&/^---$/{fm=1;next} fm&&/^---$/{exit} fm{i=index($0,":"); if(substr($0,1,i-1)==k){v=substr($0,i+1); sub(/^ +/,"",v); print v}}' "$1"; }

# set_meta <file> <key> <value>: replace or add a frontmatter key.
set_meta() {
  awk -v k="$2" -v v="$3" '
    NR==1&&/^---$/{fm=1;print;next}
    fm&&/^---$/{if(!done)print k": "v; fm=0; print; next}
    fm{i=index($0,":"); if(substr($0,1,i-1)==k){print k": "v; done=1; next}}
    {print}' "$1" > "$1.tmp" && mv "$1.tmp" "$1"
}

# append_log <file> <text>: add "- <now> <text>" at the end of the Log section.
append_log() {
  local entry="- $(now) $2"
  if ! grep -qx '## Log' "$1"; then printf '\n## Log\n%s\n' "$entry" >> "$1"; return; fi
  awk -v e="$entry" '
    {lines[NR]=$0}
    $0=="## Log"{at=NR}
    at&&NR>at&&/^## /&&!end{end=NR}
    END{
      if(!end)end=NR+1
      last=end-1; while(last>at&&lines[last]~/^[[:space:]]*$/)last--
      for(i=1;i<=last;i++)print lines[i]
      print e
      for(i=last+1;i<=NR;i++)print lines[i]
    }' "$1" > "$1.tmp" && mv "$1.tmp" "$1"
}

cmd="${1:-}"; shift || true
case "$cmd" in
  list)
    mkdir -p "$dir"
    for f in "$dir"/*.md; do [ -e "$f" ] || continue
      printf '#%s\t%s\t%s\t%s\n' "$(meta "$f" id)" "$(meta "$f" status)" "$(meta "$f" title)" "$(r="$(meta "$f" repository)"; echo "${r:-$(meta "$f" repo)}")"
    done | sort -t$'\t' -k1.2n ;;
  show) f="$(file_of "${1:-}")"; cat "$f" ;;
  path) file_of "${1:-}" ;;
  new)
    [ -n "${1:-}" ] || die "title is required"
    mkdir -p "$dir"
    id=$(( $(ls "$dir" | sed -n 's/^\([0-9][0-9]*\)\.md$/\1/p' | sort -n | tail -1 || true) + 1 ))
    t="$(now)"
    { printf -- '---\nid: %s\ntitle: %s\nstatus: todo\n' "$id" "$1"
      printf 'workspace: %s\nrepository: %s\nmodel: %s\nworktree: %s\n' "${3:-}" "${2:-$PWD}" "${4:-}" "${5:-}"
      printf 'created: %s\nupdated: %s\n---\n## Description\n\n\n## Acceptance criteria\n- [ ] \n\n## Log\n' "$t" "$t"; } > "$dir/$id.md"
    echo "$dir/$id.md" ;;
  status)
    f="$(file_of "${1:-}")"; s="${2:-}"
    case "$s" in todo|doing|review|done) ;; *) die "status must be one of todo|doing|review|done: $s" ;; esac
    prev="$(meta "$f" status)"
    set_meta "$f" status "$s"; set_meta "$f" updated "$(now)"
    if [ "$s" = done ]; then [ "$prev" = done ] && [ -n "$(meta "$f" done_at)" ] || set_meta "$f" done_at "$(now)"
    else awk 'NR==1&&/^---$/{fm=1;print;next} fm&&/^---$/{fm=0} fm&&/^done_at:/{next} {print}' "$f" > "$f.tmp" && mv "$f.tmp" "$f"; fi
    append_log "$f" "${3:-status → $s}" ;;
  set)
    f="$(file_of "${1:-}")"
    case "${2:-}" in workspace|repository|model|worktree|title) ;; *) die "set accepts workspace|repository|model|worktree|title: ${2:-}" ;; esac
    set_meta "$f" "$2" "${3:-}"; set_meta "$f" updated "$(now)" ;;
  check)
    f="$(file_of "${1:-}")"; [[ "${2:-}" =~ ^[0-9]+$ ]] || die "give the acceptance criterion number (from 1)"
    awk -v n="$2" '
      $0=="## Acceptance criteria"{sec=1; print; next}
      sec&&/^## /{sec=0}
      sec&&/^[[:space:]]*[-*] \[[ xX]\][[:space:]]*[^[:space:]]/{c++; if(c==n){sub(/\[[ xX]\]/,"[x]"); hit=1}}
      {print}
      END{if(!hit) exit 3}' "$f" > "$f.tmp" || { rm -f "$f.tmp"; die "acceptance criterion $2 not found"; }
    mv "$f.tmp" "$f"; set_meta "$f" updated "$(now)"
    append_log "$f" "Acceptance criterion $2 met: $(awk -v n="$2" '$0=="## Acceptance criteria"{sec=1;next} sec&&/^## /{exit} sec&&/^[[:space:]]*[-*] \[[ xX]\][[:space:]]*[^[:space:]]/{c++; if(c==n){sub(/^[[:space:]]*[-*] \[[ xX]\][[:space:]]*/,""); print; exit}}' "$f")" ;;
  log)
    f="$(file_of "${1:-}")"; [ -n "${2:-}" ] || die "log text is required"
    set_meta "$f" updated "$(now)"; append_log "$f" "$2" ;;
  summary)
    f="$(file_of "${1:-}")"; [ -n "${2:-}" ] || die "summary text is required"
    awk -v s="$2" '
      function put(){print "## Summary"; print s; print ""; done=1}
      $0=="## Summary"{skip=1; next}
      skip&&/^## /{skip=0}
      skip{next}
      $0=="## Log"&&!done{put()}
      {print}
      END{if(!done){print ""; put()}}' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
    set_meta "$f" updated "$(now)"; append_log "$f" "Summary updated" ;;
  run)
    f="$(file_of "${1:-}")"; command -v herdr-app >/dev/null || die "herdr-app not found"
    herdr-app do "issues.run-$1" >/dev/null || die "could not ask herdr-app to run it"
    echo "asked herdr-app to run issue #$1" ;;
  *) sed -n 2p "$0" | sed 's/^# //'; exit 2 ;;
esac
