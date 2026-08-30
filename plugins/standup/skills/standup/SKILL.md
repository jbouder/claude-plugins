---
name: standup
description: Compose a standup report from the automatic session journal and recent git activity. Use when the user asks for a standup, "what did I work on", a daily/weekly work summary, or /standup:standup. Reads the journal kept by this plugin's SessionEnd hook plus commits across the user's repos, writes the report to the monthly standup log, and prints it.
argument-hint: "[days back, default: since last working day]"
---

# Compose a standup

1. **Gather data**: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/journal.mjs" report --days <N>`.
   Default N: 4 (covers a weekend); if the user gave a number of days, use it. The JSON contains:
   - `sessions`: journaled Claude Code sessions — `ts`, `repo`, `branch`, `topic` (the user's opening prompt), `files`, `commits`, `durationMin`.
   - `commitsByRepo`: the user's commits across all repos in the same window (catches work done outside Claude Code).
   - `reportsDir`: where to write the report.

2. **Compose** a concise standup in the user's voice:
   - **Yesterday** (or "Since <weekday>" when the gap spans a weekend): group by repo, one bullet per distinct piece of work. Merge sessions and commits that clearly belong to the same task; prefer commit messages and session topics over file lists. Ignore trivial/noise sessions. Don't mention token counts or session durations unless asked.
   - **Today**: infer only from obvious in-flight work (e.g. a branch with uncommitted sessions); otherwise ask the user in one short question, or leave a `- …` placeholder if they've indicated they'll fill it in.
   - **Blockers**: only if the user mentions any; otherwise "None."

3. **Deliver**: print the report in the conversation, then append it to `<reportsDir>/YYYY-MM.md`
   (create the directory/file if missing) under a `## YYYY-MM-DD` heading. If a section for today
   already exists in the file, replace it instead of appending a duplicate.

Keep the report tight — a standup is three short sections, not a changelog. Repo names in
backticks, no headers beyond the three sections, no preamble.
