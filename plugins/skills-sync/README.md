# skills-sync

A Claude Code plugin that keeps your profile-level skills (`~/.claude/skills`) in sync with the
git repos they came from — your own skills repo, [cloudflare/skills](https://github.com/cloudflare/skills),
or any other repo that publishes `<skill>/SKILL.md` directories.

- **SessionStart hook** — at session start (throttled, default every 6h) it fetches each source,
  auto-applies safe updates, surfaces new upstream skills (or auto-installs them if you opt in),
  and tells Claude what changed.
- **Never clobbers your edits** — a content-hash lock tracks the last-applied upstream version;
  a skill you edited locally is left alone and reported instead.
- **`/skills-sync:sync` skill** — interactive management: status, force sync, add/remove sources,
  install/exclude skills, resolve conflicts, adopt untracked local skills into your own repo.

## Install

```
/plugin marketplace add jbouder/claude-plugins
/plugin install skills-sync@jbouder-plugins
```

## Use

The hook runs on its own at session start. For everything interactive, invoke the skill:

```
/skills-sync:sync                        # sync now, ignoring the throttle
/skills-sync:sync status                 # what's tracked, pending, modified, conflicted
/skills-sync:sync add cloudflare/skills  # start tracking a new source repo
/skills-sync:sync install <skill>        # install a new upstream skill you were prompted about
/skills-sync:sync resolve <skill>        # walk through a conflict
/skills-sync:sync adopt <skill>          # move an untracked local skill into your own repo
```

The bare `/sync` also works as long as no other skill or command claims that name. Plain English
works too — "sync my skills", "skill sync status", "add pbakaus/impeccable as a skill source".

## Configure

Create `~/.claude/skills-sync.json` (or run `node <plugin>/scripts/sync.mjs init` for a starter):

```json
{
  "sources": [
    { "repo": "you/skills",            "path": ".",              "skills": "*" },
    { "repo": "cloudflare/skills",     "path": "skills",         "skills": "*", "exclude": ["sandbox-migrate-to-next"] },
    { "repo": "pbakaus/impeccable",    "path": ".claude/skills", "skills": ["impeccable"] }
  ],
  "throttleHours": 6,
  "newSkills": "prompt"
}
```

| Field | Meaning |
|---|---|
| `sources[].repo` | `owner/repo` on GitHub (any git host via `url`) |
| `sources[].path` | Subdirectory containing the skill dirs (default `.`) |
| `sources[].skills` | `"*"` = track every skill in the source (new upstream skills are picked up automatically), or an explicit list |
| `sources[].exclude` | Skills never to install/track |
| `sources[].url` | Override clone URL (private repos over SSH, non-GitHub hosts) |
| `throttleHours` | Minimum hours between hook-triggered syncs (default 6) |
| `newSkills` | `prompt` (default) report new upstream skills and let Claude ask you · `auto` install them immediately · `ignore` |

When two sources provide the same skill name, the first source in the list wins and the collision
is reported.

## How syncing decides what to do

State lives in `~/.claude/skills-sync/` (lock + shallow clone cache). For each tracked skill,
three content hashes are compared — upstream, installed, and the lock (last version applied):

| Situation | Action |
|---|---|
| Not installed, new upstream | Report and ask (`newSkills: prompt`) or install (`auto`) |
| Upstream changed, installed untouched since last sync | Update automatically, report |
| Installed edited locally, upstream unchanged | Leave alone, report as locally modified |
| Both changed | **Conflict** — leave alone, report; resolve via `/skills-sync:sync` |
| Already installed when tracking begins, differs from upstream | **Pinned** — kept as-is (can't tell a stale copy from a local edit); `install <skill>` takes upstream, or it unpins itself when the two converge |
| You deleted an installed skill | Respected — reported once, never reinstalled |
| Skill removed/renamed upstream | Kept locally, reported once |
| Installed skill no source provides | Reported as untracked; adopt it into your own repo via `/skills-sync:sync` |

When a sync changes or flags anything, a one-line summary is shown directly in the Claude Code UI
(`systemMessage`) and a fuller report is handed to Claude to brief you. When everything is in sync
the hook prints nothing and adds nothing to context. It always exits 0 — it never blocks session
startup. Network failures skip the source and are reported.

## CLI

Everything the hook and skill do is a plain Node script (no dependencies):

```
node scripts/sync.mjs sync                  # sync now, ignore throttle
node scripts/sync.mjs status [--fetch]      # report only, change nothing
node scripts/sync.mjs add owner/repo [--path skills] [--skills a,b] [--exclude a,b] [--url git@...]
node scripts/sync.mjs remove owner/repo
node scripts/sync.mjs install <skill>       # install a pending/excluded-by-prompt skill
node scripts/sync.mjs exclude <skill>       # never install a given upstream skill
node scripts/sync.mjs relock <skill>|--all  # pin current installed content (never auto-overwritten)
node scripts/sync.mjs init                  # write a starter manifest
```

## Notes

- Marketplace auto-update for third-party plugins is off by default; the plugin still syncs your
  *skills* every session regardless. To update the plugin itself: `/plugin marketplace update jbouder-plugins`.
- Test overrides for development: `SKILLS_SYNC_CONFIG`, `SKILLS_SYNC_STATE`, `SKILLS_SYNC_SKILLS_DIR`.

## Security model

Adding a source means trusting that repo with model instructions: skills shape how Claude
behaves, and this plugin copies them into `~/.claude/skills` for every future session. Only add
repos you'd trust with your editor config. The default `newSkills: "prompt"` surfaces each new
upstream skill for your approval before it is installed; `"auto"` is an explicit opt-in per
manifest. Updates to skills you already installed from a source are applied automatically —
pin (`relock`) or `exclude` a skill to stop that.

## License

MIT
