# agent-skills

A collection of [Claude Code](https://code.claude.com/docs/en/skills) / agent skills I use day-to-day. Skills follow the open [Agent Skills spec](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview), so they also work with other agents that adopt the standard (Cursor, Copilot, etc.).

## Skills in this repo

| Skill | What it does |
|---|---|
| [`youtube-research`](./youtube-research) | Search YouTube with date / view / keyword filters, fetch transcripts + metadata with a persistent cache, and synthesize across many videos (itineraries, market research, comparison reports). No API key required. |

## Install

### Via [skills.sh](https://skills.sh) CLI (recommended)

```bash
npx skills add disolaterX/agent-skills --skill youtube-research
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
├── youtube-research/
│   ├── SKILL.md          # frontmatter + workflow doc
│   └── scripts/          # uv-script Python helpers
└── README.md             # this file
```

## License

[MIT](./LICENSE).
