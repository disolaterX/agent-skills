#!/usr/bin/env bash
#
# extract-cc-voice.sh — mine your Claude Code session transcripts for how you
# actually type, to seed a voice profile. Local-only: reads nothing but your own
# ~/.claude/projects transcripts and prints stats + a random sample of prompts.
#
# Usage:  extract-cc-voice.sh [PROJECTS_DIR] [SAMPLE_N]
#   PROJECTS_DIR  transcripts dir       (default: $HOME/.claude/projects)
#   SAMPLE_N      sample messages shown (default: 60)
#
# Requires: jq, awk, grep, sed, sort, uniq  (portable; no shuf / GNU-only flags).

# Best-effort reporting script: a grep with no matches or head closing a pipe
# early is expected and must not abort. Keep -u to catch unset-var typos, but
# not -e/pipefail (they kill the script on those benign non-zero exits).
set -u

PROJECTS_DIR="${1:-$HOME/.claude/projects}"
SAMPLE_N="${2:-60}"

command -v jq >/dev/null 2>&1 || { echo "ERROR: jq is required (brew install jq | apt install jq)"; exit 1; }
[ -d "$PROJECTS_DIR" ] || { echo "ERROR: no transcripts dir at $PROJECTS_DIR"; exit 1; }

ALL="$(mktemp)"; TYPED="$(mktemp)"
trap 'rm -f "$ALL" "$TYPED"' EXIT

# One typed message per line: pull type==user text (string or array), collapse
# newlines, drop tool results / command wrappers / system noise / interrupts.
find "$PROJECTS_DIR" -name '*.jsonl' -print0 | while IFS= read -r -d '' f; do
  jq -rc 'select(.type=="user") | select(.message!=null) | (.message.content) as $c |
    ( if   ($c|type)=="string" then $c
      elif ($c|type)=="array"  then ([$c[] | select(.type=="text") | .text] | join(" "))
      else empty end ) | gsub("[\n\t]";" ")' "$f" 2>/dev/null
done \
| grep -vaiE '<(command-name|command-message|command-args|local-command|bash-input|bash-stdout|bash-stderr|system-reminder|user-prompt-submit-hook|persisted-context|task-notification)' \
| grep -vaE 'tool_use_id|tool-use-id' \
| grep -vaE '^[[:space:]]*Caveat:' \
| grep -vaE '^\[Request interrupted' \
| sed -E 's/  +/ /g; s/^ +//; s/ +$//' \
| awk 'NF' > "$ALL" || true

TOTAL=$(wc -l < "$ALL" | tr -d ' ')
echo "==================================================================="
echo " Claude Code voice extraction  —  $TOTAL typed messages"
echo " source: $PROJECTS_DIR"
echo "==================================================================="

# Genuine typed prompts: 2..40 words (excludes pure pastes and 1-word acks).
awk 'NF>=2 && NF<=40' "$ALL" > "$TYPED"
T=$(wc -l < "$TYPED" | tr -d ' ')

echo; echo "## Length distribution (words/message)"
awk '{n=NF; if(n<=3)a++;else if(n<=8)b++;else if(n<=20)c++;else if(n<=50)d++;else e++}
     END{printf "  1-3:%d  4-8:%d  9-20:%d  21-50:%d  50+(often pastes):%d\n",a,b,c,d,e}' "$ALL"

echo; echo "## Capitalization & punctuation (of $T typed prompts)"
printf "  starts lowercase : %s\n" "$(grep -cE '^[a-z]' "$TYPED" || true)"
printf "  no end punctuation: %s\n" "$(grep -cvE '[.!?]\"?$' "$TYPED" || true)"
printf "  contains a '?'   : %s\n" "$(grep -cE '\?' "$TYPED" || true)"

echo; echo "## Top 25 opening words"
awk '{print tolower($1)}' "$TYPED" | sed -E 's/[^a-z0-9]//g' | awk 'NF' | sort | uniq -c | sort -rn | head -25

echo; echo "## Top 20 opening bigrams"
awk 'NF>=2{print tolower($1" "$2)}' "$TYPED" | sed -E 's/[^a-z0-9 ]//g' | sort | uniq -c | sort -rn | head -20

echo; echo "## Casual / filler markers"
for w in bro hey btw lol lmao haha damn dude man bruh ok okay yeah yep nope nah pls plz wanna gonna kinda sorta basically actually literally just honestly tbh imo fr ngl ; do
  c=$(grep -woiE "$w" "$TYPED" | wc -l | tr -d ' ' || true); [ "${c:-0}" -gt 0 ] && printf "  %-10s %s\n" "$w" "$c"
done | sort -b -k2 -rn | head -20

echo; echo "## Apostrophe-dropping (contractions typed without ')"
for w in dont cant wont didnt doesnt isnt arent im ive id youre theyre wasnt couldnt shouldnt thats whats ; do
  c=$(grep -woiE "$w" "$TYPED" | wc -l | tr -d ' ' || true); [ "${c:-0}" -gt 0 ] && printf "  %-10s %s\n" "$w" "$c"
done | sort -b -k2 -rn | head -15

echo; echo "## Emoji / non-ASCII usage (rough: messages with a non-ASCII byte)"
# Count messages with any byte outside printable ASCII (space..~). LC_ALL=C so
# multibyte UTF-8 (emoji/accents) is seen as raw high bytes; a UTF-8 locale or
# the [:print:] class would decode them to "printable" and report 0. Tabs were
# already collapsed to spaces above, so no control-char false positives.
printf "  %s of %s typed prompts\n" "$(LC_ALL=C grep -cE '[^ -~]' "$TYPED" 2>/dev/null || echo 0)" "$T"

echo; echo "## Random sample of $SAMPLE_N typed prompts (5-30 words) — read these for phrasing"
awk 'NF>=5 && NF<=30' "$TYPED" \
 | awk 'BEGIN{srand()}{print rand()"\t"$0}' | sort -n | cut -f2- \
 | head -"$SAMPLE_N" | nl -ba -w2 -s'. '
