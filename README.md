# claude-plugins

Claude Code plugins by [@jbouder](https://github.com/jbouder), distributed as a single
marketplace: add it once, install any plugin from it.

## Install

```
/plugin marketplace add jbouder/claude-plugins
/plugin install <plugin>@jbouder-plugins
```

## Plugins

| Plugin | What it does | Install |
|---|---|---|
| [skills-sync](./plugins/skills-sync/) | Keeps `~/.claude/skills` in sync with the git repos your skills came from — multi-source, hook-driven at session start, never clobbers local edits. | `/plugin install skills-sync@jbouder-plugins` |
| [standup](./plugins/standup/) | Automatic zero-token work journal (SessionEnd hook) plus a `/standup:standup` skill that composes Yesterday/Today — with time, model, and token stats — from the journal and your git activity. | `/plugin install standup@jbouder-plugins` |

Each plugin's README covers its configuration, data locations, and CLI.

## Updating

Marketplace auto-update is off by default for third-party marketplaces. To pull the latest:

```
/plugin marketplace update jbouder-plugins
/plugin update <plugin>@jbouder-plugins
```

## Repo layout

```
.claude-plugin/marketplace.json   # the marketplace manifest (name: jbouder-plugins)
plugins/<name>/                   # one plugin per directory
├── .claude-plugin/plugin.json    #   manifest (name, version)
├── hooks/hooks.json              #   hook wiring
├── scripts/*.mjs                 #   zero-dependency Node engines
└── skills/<skill>/SKILL.md       #   slash-command skills (/​<plugin>:<skill>)
```

Adding a plugin = a new `plugins/<name>/` directory plus one entry in
`marketplace.json`, validated with `claude plugin validate .`.

## License

[MIT](./LICENSE)
