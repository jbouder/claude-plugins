# claude-plugins

A marketplace of Claude Code plugins.

```
/plugin marketplace add jbouder/claude-plugins
```

| Plugin | What it does | Install |
|---|---|---|
| [skills-sync](./plugins/skills-sync/) | Keeps `~/.claude/skills` in sync with the git repos your skills came from — multi-source, hook-driven at session start, never clobbers local edits. | `/plugin install skills-sync@jbouder-plugins` |

| [standup](./plugins/standup/) | Automatic zero-token work journal (SessionEnd hook) + `/standup:standup` report composer from the journal and your git activity. | `/plugin install standup@jbouder-plugins` |

Each plugin's README covers its configuration and usage.

## License

MIT
