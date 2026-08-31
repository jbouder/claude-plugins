---
name: sync
description: Manage the skills-sync setup that keeps ~/.claude/skills in sync with upstream git repos. Use when the user wants to sync their skills now, see skill sync status, add or remove a skill source repo, install or exclude a new upstream skill, resolve a skill sync conflict, or adopt an untracked local skill into their own skills repo. Triggers on /skills-sync:sync, "sync my skills", "skill sync status", "add a skill source", "adopt this skill".
argument-hint: "[status | sync | add <owner/repo> | remove <owner/repo> | install <skill> | exclude <skill> | adopt <skill> | resolve <skill>]"
---

# skills-sync management

A SessionStart hook keeps `~/.claude/skills` synced from upstream git repos. This skill drives
the same engine interactively via `node "${CLAUDE_PLUGIN_ROOT}/scripts/sync.mjs" <command>`.
(If `${CLAUDE_PLUGIN_ROOT}` is not substituted, locate the script with:
`ls ~/.claude/plugins/cache/*/skills-sync/*/scripts/sync.mjs ~/.claude/plugins/cache/*/skills-sync/scripts/sync.mjs 2>/dev/null | head -1`.)

State lives in:
- **Manifest** `~/.claude/skills-sync.json` — sources (`repo`, `path`, `skills` list or `"*"`, `exclude`, optional `url`), `throttleHours`, `newSkills` (`auto` | `prompt` | `ignore`).
- **Lock** `~/.claude/skills-sync/lock.json` — per-skill hash of the last-applied upstream version. Installed == lock means "no local edits, safe to auto-update".
- **Cache** `~/.claude/skills-sync/cache/` — shallow clones of the sources.

## Commands

| Intent | Run |
|---|---|
| Show state (no changes) | `sync.mjs status --fetch` |
| Sync now (ignores throttle) | `sync.mjs sync` |
| Add a source repo | `sync.mjs add <owner/repo> [--path <subdir>] [--skills a,b] [--exclude a,b] [--url <git-url>]` |
| Remove a source | `sync.mjs remove <owner/repo>` |
| Install a pending new upstream skill | `sync.mjs install <skill>` |
| Never install a given upstream skill | `sync.mjs exclude <skill>` |
| Keep the local version of a skill (pin it) | `sync.mjs relock <skill>` (or `--all`) |

The engine NEVER overwrites local content it can't prove is a clean upstream copy:
- installed edited since last sync + upstream unchanged → *locally modified*, left alone
- installed edited + upstream changed → *conflict*, left alone
- installed differs from upstream at first tracking (can't tell stale copy from local edit) → **pinned**: kept as-is, never auto-applied; upstream movement is noted once. `install <skill>` takes upstream and unpins; syncing converges (installed == upstream) also unpins.

## Resolving a conflict (`resolve <skill>`)

1. Diff installed vs upstream: `diff -ru ~/.claude/skills-sync/cache/<owner>__<repo>/<path>/<skill> ~/.claude/skills/<skill>` — summarize the difference for the user.
2. Ask which side wins:
   - **Upstream** → `sync.mjs install <skill>` (overwrites local, re-locks).
   - **Local** → if the source is the user's own repo, copy the installed dir into their local clone of that repo, commit, push, then `sync.mjs sync`. If the source is third-party, either `sync.mjs relock <skill>` (pin the local version; upstream changes are noted but never applied) or `sync.mjs exclude <skill>` (stop tracking).

## Adopting an untracked skill (`adopt <skill>`)

For a skill in `~/.claude/skills` that no source provides — move it into the user's own skills repo so it becomes tracked and synced:

1. Identify the user's own skills repo from the manifest (the source that is theirs — ask if ambiguous) and locate their local working clone of it (ask if unknown; do NOT commit inside `~/.claude/skills-sync/cache/`).
2. Copy `~/.claude/skills/<skill>` into that clone, commit, push.
3. `sync.mjs sync` — the skill is now claimed by the source and baselined.

## Notes

- The hook is throttled (`throttleHours`); `sync` and `status --fetch` always hit the network.
- After the user hand-deletes a synced skill, sync respects the deletion (reported once, not reinstalled). To reinstall: `sync.mjs install <skill>`.
- A skill reported *gone upstream* (renamed or removed in the source) is kept locally; ask the user whether to keep it (adopt it into their repo, or leave it untracked by removing its lock entry) or delete it, and check whether a renamed replacement was auto-installed.
