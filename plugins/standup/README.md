# standup

Automatic work journal for standups, with zero token cost for the tracking.

- **SessionEnd hook** — whenever a Claude Code session ends, `journal.mjs log` parses the
  session transcript locally and appends one entry to `~/.claude/standup/journal.jsonl`:
  repo, branch, topic (your opening prompt), files edited, commits you made during the
  session, duration, models used, and token totals. No LLM calls; trivial sessions
  (nothing edited, nothing committed, barely any conversation) are skipped.
- **`/standup:standup` skill** — composes Yesterday / Today / Blockers from the journal
  **plus your git commits across all your repos** (so work done outside Claude Code is
  included), prints it, and appends it to a monthly markdown log.

## Install

```
/plugin marketplace add jbouder/claude-plugins
/plugin install standup@jbouder-plugins
```

## Configure (optional)

`~/.claude/standup.json`:

```json
{
  "reportsDir": "~/standups",
  "reposDir": "~/repos"
}
```

| Field | Meaning |
|---|---|
| `reportsDir` | Where monthly standup logs are written (`YYYY-MM.md`). Default `~/standups`. |
| `reposDir` | Directory scanned for your git commits when composing a report (author = your global `git config user.email`). Unset = journal-only reports. |

## Privacy

Everything stays on your machine. The journal stores your session's opening prompt
(truncated to 200 chars), file paths, and commit subjects — not conversation content or
diffs. Delete `~/.claude/standup/journal.jsonl` anytime to clear history.

## CLI

```
node scripts/journal.mjs report --days 4   # raw JSON the skill consumes
```

## License

MIT
