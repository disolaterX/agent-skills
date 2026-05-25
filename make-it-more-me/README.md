# make-it-more-me

A Claude Code skill that learns *your* writing voice and edits prose to sound like you instead of like a language model.

Most AI editing imposes one generic "good writing" style. This does the opposite: it measures how **you** actually write — from your own writing and your Claude Code chat history — builds a personal voice profile, and applies it.

## How it works

Two phases:

1. **Setup (once):** say *"learn how I write"* / *"calibrate my voice"*. It mines your Claude Code transcripts (`~/.claude/projects`) for how you type, optionally scans your blog/READMEs/samples for how you publish, extracts your signature, validates it with you, and writes a profile to `~/.claude/voice/profiles/default.md`.
2. **Apply (any time):** say *"make it more me"* / *"de-ai-ify this"* on any draft. It loads your profile and rewrites in your voice.

The skill ships with **no personal data** — your profile lives outside the repo, in your home dir, and is never shared. Two voices are tracked separately: how you type to an AI vs how you write for publication.

## Requirements

`jq` (for the transcript miner). Everything else is standard Unix (bash, awk, grep, sed). Portable across macOS and Linux.

## Files

| File | Purpose |
|------|---------|
| `SKILL.md` | Router: setup-vs-apply, two-registers rule, verification |
| `references/calibration.md` | The setup procedure |
| `references/universal-ai-tells.md` | Default de-AI ruleset + build/YAML safety |
| `references/profile-template.md` | Profile structure |
| `references/example-profile.md` | A filled synthetic example |
| `scripts/extract-cc-voice.sh` | Portable Claude Code transcript miner |

## Privacy

Everything runs locally. The skill reads only your own files and prints stats to your terminal. Nothing is uploaded. Your profile is yours; delete `~/.claude/voice/` to wipe it.
