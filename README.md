# agent-skills

The [Claude Code](https://code.claude.com/docs/en/skills) / agent skills I use day-to-day. Skills follow the open [Agent Skills spec](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview), so they also work with other agents that adopt the standard (Codex, Cursor, Copilot, etc.).

## Skills

Copied from [t3dotgg/tstack](https://github.com/t3dotgg/tstack) (MIT). `file-pr` and `leaving-pr-comments` are edited to drop all model/harness attribution, and `council` uses Gemini Neon via Cursor instead of Gemini Pro; the rest match upstream.

| Skill | What it does |
|---|---|
| [`babysit-pr`](./babysit-pr) | Monitors a PR through review and CI. |
| [`council`](./council) | On "council": three delegates from different providers review the work and score it. |
| [`file-pr`](./file-pr) | Files a concise PR: checks for an existing one, verifies the diff, follows title conventions, leads with the problem. No attribution line. |
| [`full-send`](./full-send) | On "full send": autonomous end-to-end work through to a merged PR. Kept because `full-stop` reads it. |
| [`full-stop`](./full-stop) | On "full stop": the `full-send` workflow, stopping with the PR ready to merge. Never merges. |
| [`leaving-pr-comments`](./leaving-pr-comments) | How to write GitHub comments, reviews and replies. No attribution callout. |
| [`modernize`](./modernize) | Brings an old PR up to date with its base branch. |
| [`sol-loop`](./sol-loop) | On "sol loop": reviews code changes with GPT Sol in a loop, with minimal fixes. |
| [`takeover`](./takeover) | Takes over an existing PR, branch, or agent thread. |

## Install

### Via [skills.sh](https://skills.sh) CLI

```bash
npx skills add disolaterX/agent-skills --skill babysit-pr --skill council --skill file-pr --skill full-send --skill full-stop --skill leaving-pr-comments --skill modernize --skill sol-loop --skill takeover
```

### Linked from a clone

`skills.sh` symlinks every skill in this repo into `~/.claude/skills`, so the live skills and the repo are the same files:

```bash
git clone https://github.com/disolaterX/agent-skills.git
cd agent-skills
./skills.sh link     # create the links
./skills.sh status   # behind/ahead/dirty, and link state
./skills.sh update   # pull, then relink
```

## Updating from tstack

Pull upstream changes into each skill by hand and keep the local edits above.

## License

[MIT](./LICENSE).
