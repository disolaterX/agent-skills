# agent-skills

A collection of [Claude Code](https://code.claude.com/docs/en/skills) / agent skills I use day-to-day. Skills follow the open [Agent Skills spec](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview), so they also work with other agents that adopt the standard (Cursor, Copilot, etc.).

## Skills in this repo

| Skill | What it does |
|---|---|
| [`make-it-more-me`](./make-it-more-me) | Learns *your* writing voice from your own Claude Code transcripts and prose, builds a personal voice profile, then edits text to sound like you instead of like a language model. Two phases (calibrate once, then apply). Ships no personal data. |
| [`youtube-research`](./youtube-research) | Search YouTube with date / view / keyword filters, fetch transcripts + metadata with a persistent cache, and synthesize across many videos (itineraries, market research, comparison reports). No API key required. |
| [`file-pr`](./file-pr) | Files a concise pull request: checks for an existing PR on the branch, verifies the diff against origin/main, follows repo title conventions, and writes a description that leads with the problem, not an implementation inventory. |

## Install

### Via [skills.sh](https://skills.sh) CLI (recommended)

```bash
npx skills add disolaterX/agent-skills --skill make-it-more-me
npx skills add disolaterX/agent-skills --skill youtube-research
npx skills add disolaterX/agent-skills --skill file-pr
```

### Manual

Clone the relevant skill directory straight into your `~/.claude/skills/`:

```bash
git clone https://github.com/disolaterX/agent-skills.git /tmp/agent-skills
cp -R /tmp/agent-skills/youtube-research ~/.claude/skills/
```

Restart your agent / re-open the project so the new `SKILL.md` is picked up.

## Layout

Each top-level directory is one self-contained skill:

```
agent-skills/
├── make-it-more-me/
│   ├── SKILL.md          # router: setup vs apply, verification
│   ├── references/       # calibration, AI-tells ruleset, profile template
│   └── scripts/          # transcript miner + front-matter quoter
├── youtube-research/
│   ├── SKILL.md          # frontmatter + workflow doc
│   └── scripts/          # uv-script Python helpers
├── file-pr/
│   └── SKILL.md          # PR title/description conventions
└── README.md             # this file
```

## License

[MIT](./LICENSE).
