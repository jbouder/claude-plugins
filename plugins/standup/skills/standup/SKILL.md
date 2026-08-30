---
name: standup
description: Compose a standup report from the automatic session journal and recent git activity. Use when the user asks for a standup, "what did I work on", a daily/weekly work summary, or /standup:standup. Reads the journal kept by this plugin's SessionEnd hook plus commits across the user's repos, writes the report to the monthly standup log, and prints it.
argument-hint: "[days back, default: since last working day]"
---

# Compose a standup

1. **Gather data**: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/journal.mjs" report --days <N>`.
   Default N: 4 (covers a weekend); if the user gave a number of days, use it. The JSON contains:
   - `sessions`: journaled Claude Code sessions — `ts`, `repo`, `branch`, `topic` (the user's opening prompt), `files`, `commits`, `durationMin`, `models`, `tokens`.
   - `totals`: pre-aggregated stats — `sessions`, `activeMin`, `tokens` (in/out/cacheRead), `byModel` (session counts), `byRepo` and `byDay` (sessions + activeMin).
   - `commitsByRepo`: the user's commits across all repos in the same window (catches work done outside Claude Code).
   - `reportsDir`: where to write the report.

2. **Compose** a concise standup in the user's voice:
   - **Yesterday** (or "Since <weekday>" when the gap spans a weekend): group by repo, one bullet per distinct piece of work. Merge sessions and commits that clearly belong to the same task; prefer commit messages and session topics over file lists. Ignore trivial/noise sessions.
   - **Today**: infer only from obvious in-flight work (e.g. a branch with uncommitted sessions); otherwise ask the user in one short question, or leave a `- …` placeholder if they've indicated they'll fill it in.
   - **Blockers**: only if the user mentions any; otherwise "None."
   - **Stats** footer — one compact line from `totals`, e.g.:
     `🕒 4h 27m clauding across 6 sessions · fable-5 ×5, haiku ×1 · 1.2M in / 380k out (14.6M cache-read)`
     Shorten model IDs (claude-fable-5 → fable-5), humanize minutes (267 → 4h 27m) and token
     counts (1234567 → 1.2M). Add per-repo time in parentheses on the Yesterday repo bullets
     when a repo took meaningful time.

3. **Deliver**: print the report in the conversation, then append it to `<reportsDir>/YYYY-MM.md`
   (create the directory/file if missing) under a `## YYYY-MM-DD` heading. If a section for today
   already exists in the file, replace it instead of appending a duplicate.

Keep the report tight — a standup is three short sections plus the stats line, not a
changelog. Repo names in backticks, no headers beyond those sections, no preamble.
