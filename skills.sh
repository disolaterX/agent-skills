#!/usr/bin/env bash
#
# skills.sh — manage the agent-skills repo and its links into ~/.claude/skills
#
# This repo is the source of truth. Each top-level dir containing a SKILL.md is a
# skill, and gets symlinked into the live skills dir so the deployed skill and the
# repo working copy are the same files (edit once, push from one place).
#
# Usage:
#   ./skills.sh status        # fetch upstream, report if behind/ahead/dirty, show link state (default)
#   ./skills.sh update        # pull --ff-only, then (re)link all skills, report what changed
#   ./skills.sh link          # (re)create symlinks for every skill (safe; never clobbers divergent dirs)
#   ./skills.sh list          # list skills and whether each is linked correctly
#
set -euo pipefail

# Repo = directory containing this script (resolve symlinks so it works via ~/.claude/skills.sh too).
SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" >/dev/null 2>&1 && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
REPO="$(cd -P "$(dirname "$SOURCE")" >/dev/null 2>&1 && pwd)"
SKILLS_DIR="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"

c_red=$'\033[31m'; c_grn=$'\033[32m'; c_yel=$'\033[33m'; c_dim=$'\033[2m'; c_rst=$'\033[0m'

# List skill names (top-level dirs in REPO containing a SKILL.md).
list_skills() {
  for d in "$REPO"/*/; do
    [ -f "${d}SKILL.md" ] && basename "$d"
  done
}

# Link one skill into SKILLS_DIR. Replaces an identical real dir; refuses to clobber a divergent one.
link_one() {
  local name="$1" src="$REPO/$1" dst="$SKILLS_DIR/$1"
  mkdir -p "$SKILLS_DIR"
  if [ -L "$dst" ]; then
    if [ "$(readlink "$dst")" = "$src" ]; then echo "  ${c_dim}linked   $name${c_rst}"; return; fi
    rm "$dst"; ln -s "$src" "$dst"; echo "  ${c_grn}relinked $name${c_rst}"; return
  fi
  if [ -e "$dst" ]; then
    # Real dir present. Only replace if it is byte-identical to the repo copy.
    if diff -rq "$dst" "$src" >/dev/null 2>&1; then
      local bak="$dst.bak.$(date +%Y%m%d%H%M%S)"
      mv "$dst" "$bak"; ln -s "$src" "$dst"
      echo "  ${c_grn}linked   $name${c_rst} ${c_dim}(identical copy backed up -> $(basename "$bak"))${c_rst}"
    else
      echo "  ${c_red}SKIP     $name${c_rst} — live copy differs from repo; resolve manually (diff '$dst' '$src')"
    fi
    return
  fi
  ln -s "$src" "$dst"; echo "  ${c_grn}linked   $name${c_rst}"
}

cmd_link() {
  echo "Linking skills into $SKILLS_DIR:"
  local n=0
  while read -r s; do [ -n "$s" ] && { link_one "$s"; n=$((n+1)); }; done < <(list_skills)
  if [ "$n" -eq 0 ]; then echo "  (no skills found in $REPO)"; fi
}

cmd_list() {
  printf "%-24s %s\n" "SKILL" "LINK STATE"
  while read -r s; do
    [ -z "$s" ] && continue
    local dst="$SKILLS_DIR/$s" state
    if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$REPO/$s" ]; then state="${c_grn}linked${c_rst}"
    elif [ -L "$dst" ]; then state="${c_yel}symlink -> $(readlink "$dst")${c_rst}"
    elif [ -e "$dst" ]; then state="${c_yel}unlinked real dir${c_rst}"
    else state="${c_dim}not deployed${c_rst}"; fi
    printf "%-24s %b\n" "$s" "$state"
  done < <(list_skills)
}

cmd_status() {
  echo "Repo:   $REPO"
  echo "Skills: $SKILLS_DIR"
  echo
  git -C "$REPO" fetch --quiet origin || { echo "${c_red}fetch failed${c_rst}"; }
  local branch; branch="$(git -C "$REPO" rev-parse --abbrev-ref HEAD)"
  local up="origin/$branch"
  if git -C "$REPO" rev-parse --verify --quiet "$up" >/dev/null; then
    local behind ahead; behind="$(git -C "$REPO" rev-list --count "HEAD..$up")"; ahead="$(git -C "$REPO" rev-list --count "$up..HEAD")"
    if [ "$behind" -gt 0 ]; then
      echo "${c_yel}UPDATE AVAILABLE${c_rst} — $behind commit(s) behind $up:"
      git -C "$REPO" log --oneline "HEAD..$up" | sed 's/^/    /'
      echo "    files: $(git -C "$REPO" diff --name-only "HEAD..$up" | tr '\n' ' ')"
      echo "  run: ${c_grn}$0 update${c_rst}"
    else
      echo "${c_grn}up to date${c_rst} with $up"
    fi
    [ "$ahead" -gt 0 ] && echo "${c_yel}note:${c_rst} $ahead local commit(s) not pushed."
  else
    echo "${c_yel}no upstream tracking branch for $branch${c_rst}"
  fi
  if ! git -C "$REPO" diff --quiet || ! git -C "$REPO" diff --cached --quiet || [ -n "$(git -C "$REPO" status --porcelain --untracked-files=normal)" ]; then
    echo "${c_yel}local changes in working tree:${c_rst}"
    git -C "$REPO" status --short | sed 's/^/    /'
  fi
  echo; cmd_list
}

cmd_update() {
  local before; before="$(git -C "$REPO" rev-parse HEAD)"
  git -C "$REPO" fetch --quiet origin
  git -C "$REPO" pull --ff-only
  local after; after="$(git -C "$REPO" rev-parse HEAD)"
  if [ "$before" != "$after" ]; then
    echo "Updated $before -> $after. Changed files:"
    git -C "$REPO" diff --name-only "$before..$after" | sed 's/^/    /'
  else
    echo "Already at latest ($after)."
  fi
  echo; cmd_link
}

case "${1:-status}" in
  status|check)  cmd_status ;;
  update|sync)   cmd_update ;;
  link|relink)   cmd_link ;;
  list|ls)       cmd_list ;;
  *) echo "usage: $0 {status|update|link|list}"; exit 2 ;;
esac
