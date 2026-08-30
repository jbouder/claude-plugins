# skills-sync

A Claude Code plugin that keeps your profile-level skills (`~/.claude/skills`) in sync with the
git repos they came from — your own skills repo, [cloudflare/skills](https://github.com/cloudflare/skills),
or any other repo that publishes `<skill>/SKILL.md` directories.

- **SessionStart hook** — at session start (throttled, default every 6h) it fetches each source,
  auto-applies safe updates, auto-installs new upstream skills, and tells Claude what changed.
- **Never clobbers your edits** — a content-hash lock tracks the last-applied upstream version;
  a skill you edited locally is left alone and reported instead.
- **`/skills-sync:sync` skill** — interactive management: status, force sync, add/remove sources,
  install/exclude skills, resolve conflicts, adopt untracked local skills into your own repo.

## Install

```
/plugin marketplace add jbouder/skills-sync
/plugin install skills-sync@skills-sync
```

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
  "newSkills": "auto"
}
```

| Field | Meaning |
|---|---|
| `sources[].repo` | `owner/repo` on GitHub (any git host via `url`) |
| `sources[].path` | Subdirectory containing the skill dirs (default `.`) |
| `sources[].skills` | `"*"` = track every skill in the source (new upstream skills install automatically), or an explicit list |
| `sources[].exclude` | Skills never to install/track |
| `sources[].url` | Override clone URL (private repos over SSH, non-GitHub hosts) |
| `throttleHours` | Minimum hours between hook-triggered syncs (default 6) |
| `newSkills` | `auto` (default) install new upstream skills · `prompt` report and let Claude ask you · `ignore` |

When two sources provide the same skill name, the first source in the list wins and the collision
is reported.

## How syncing decides what to do

State lives in `~/.claude/skills-sync/` (lock + shallow clone cache). For each tracked skill,
three content hashes are compared — upstream, installed, and the lock (last version applied):

| Situation | Action |
|---|---|
| Not installed, new upstream | Install (`newSkills: auto`) or report (`prompt`) |
| Upstream changed, installed untouched since last sync | Update automatically, report |
| Installed edited locally, upstream unchanged | Leave alone, report as locally modified |
| Both changed | **Conflict** — leave alone, report; resolve via `/skills-sync:sync` |
| You deleted an installed skill | Respected — reported once, never reinstalled |
| Skill removed/renamed upstream | Kept locally, reported once |
| Installed skill no source provides | Reported as untracked; adopt it into your own repo via `/skills-sync:sync` |

The hook prints nothing (and adds nothing to context) when everything is in sync, and always
exits 0 — it never blocks session startup. Network failures skip the source and are reported.

## CLI

Everything the hook and skill do is a plain Node script (no dependencies):

```
node scripts/sync.mjs sync                  # sync now, ignore throttle
node scripts/sync.mjs status [--fetch]      # report only, change nothing
node scripts/sync.mjs add owner/repo [--path skills] [--skills a,b] [--exclude a,b] [--url git@...]
node scripts/sync.mjs remove owner/repo
node scripts/sync.mjs install <skill>       # install a pending/excluded-by-prompt skill
node scripts/sync.mjs exclude <skill>       # never install a given upstream skill
node scripts/sync.mjs relock <skill>|--all  # accept current installed content as the new baseline
node scripts/sync.mjs init                  # write a starter manifest
```

## Notes

- Marketplace auto-update for third-party plugins is off by default; the plugin still syncs your
  *skills* every session regardless. To update the plugin itself: `/plugin marketplace update skills-sync`.
- Test overrides for development: `SKILLS_SYNC_CONFIG`, `SKILLS_SYNC_STATE`, `SKILLS_SYNC_SKILLS_DIR`.

## License

MIT
