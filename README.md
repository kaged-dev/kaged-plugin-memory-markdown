<div align="center">

<img src="https://kaged.dev/hero.svg" alt="kaged" width="100%" />

# 影 @kaged/memory-markdown

**shadow ops for your `[memory]`**

Markdown-file-backed agent memory for [kaged](https://kaged.dev) — every entry a plain markdown file with YAML frontmatter, searchable by keyword + recency + tag scoring. The canonical **reference plugin**: if you're building a kaged project plugin, start here.

[![npm](https://img.shields.io/npm/v/@kaged/memory-markdown?color=FFB000&label=npm&labelColor=0A0A0B)](https://www.npmjs.com/package/@kaged/memory-markdown)
[![license](https://img.shields.io/badge/license-MIT-FF2E63?labelColor=0A0A0B)](#license)
[![plugin](https://img.shields.io/badge/plugin-project%20%C2%B7%20observer-00E0FF?labelColor=0A0A0B)](#what-it-does)

</div>

---

## What it does

Zero-credentials, file-based memory for kaged agents. Every memory entry is a markdown file with YAML frontmatter. The operator can `cat`, `grep`, `git diff`, or hand-edit any file.

- **`retain`** — store a memory entry (auto-appends short facts to `facts.md`)
- **`recall`** — keyword + recency + tag scoring search across entries
- **`forget`** — delete a memory entry by ID (idempotent)
- **`list_tags`** — list all unique tags across entries
- **`on_session_start`** — inject recent memories into the agent's context
- **`on_session_idle`** — auto-save session transcript
- **`on_compact`** — preserve compacted messages on disk, inject relevant context

This is the **reference floor** — the simplest credible memory backend. The ceiling is `@kaged/memory-hindsight` (vector-graph-temporal search via the Hindsight API).

## Why it's the reference plugin

This plugin demonstrates **every** manifest surface a project plugin can use:

| Surface | What this plugin does |
|---|---|
| **Manifest** (`kaged-plugin.yaml`) | Full metadata, sandbox capabilities, env vars |
| **Roles** | `observer` (hooks into session lifecycle) |
| **Hooks** | All 3 lifecycle hooks: `on_session_start`, `on_session_idle`, `on_compact` |
| **Tools** | 4 tools: `retain`, `recall`, `forget`, `list_tags` |
| **Config schema** | 14 project-side fields (scoring weights, limits, headers, isolation) |
| **System config schema** | 1 operator-local secret (`encryption_key`) — demonstrates the project/system split |
| **Knobs (7 types)** | `path`, `enum`, `boolean`, `int_range`, `text`, `range`, `multiline` |
| **JSON-RPC server** | Stdio transport, handshake, method dispatch, context extraction |

When kaged adds new plugin features, this plugin gets updated to showcase them. If a feature doesn't apply to a memory plugin (e.g. `model_alias` knobs), it's noted in the spec with an explanation of why it's omitted.

## Quick start

### Declare in project DSL

```yaml
# .kaged/project.yaml
plugins:
  memory:
    package: "@kaged/memory-markdown"
```

That's it. No API keys, no external services. Memory files land in `~/.local/share/kaged/memory/` by default.

### Operator config (optional)

Override in `local.toml`:

```toml
[plugins."@kaged/memory-markdown".system_config]
encryption_key = "..."  # v0 placeholder — demonstrates system_config
```

### Configure per-project (optional)

```yaml
# .kaged/project.yaml
plugins:
  memory:
    package: "@kaged/memory-markdown"
    config:
      isolation: project          # share memory across agents
      store: "project:/memory"    # store inside project dir (committable)
      tags: [project-x]           # default tags on every retain
      score_tag_exact: 5          # heavier tag matching
      custom_inject_header: "Context from past sessions:"
```

All config fields have sensible defaults — the plugin works with zero configuration.

## Architecture

```
src/
  config.ts        MarkdownConfig, MarkdownSystemConfig, RuntimeConfig, mergeConfig()
  handlers.ts      Tool + hook handlers composing URI → directory → I/O
  server.ts        JSON-RPC 2.0 stdio server, method dispatch
  main.ts          Process entry point (stdin line reader)
  io.ts            File I/O: write, read, recall, delete, tags
  frontmatter.ts   YAML frontmatter build/parse round-trip
  score.ts         Configurable keyword + recency + tag scoring
  storage.ts       Store directory resolution (per-agent vs per-project)
  uri.ts           URI scheme resolution (config:/, project:/)
  id.ts            Snowflake ID generation
  readme.ts        README template for store root
  index.ts         Barrel exports
```

## Config reference

### Project-side (committed to git)

| Field | Type | Default | Description |
|---|---|---|---|
| `isolation` | `"agent"` \| `"project"` | `"agent"` | Per-agent or per-project memory scope |
| `store` | string (URI) | `"config:/memory"` | Where memory files live (`config:/` or `project:/`) |
| `tags` | string[] | `[]` | Default tags applied to every retain |
| `retain_on_session_idle` | boolean | `true` | Auto-save transcript when session goes idle |
| `inject_on_session_start_max_entries` | integer | `10` | Max entries to inject at session start |
| `max_content_bytes` | integer | `102400` | Max retain content size (100 KB) |
| `fact_max_length` | integer | `200` | Content shorter than this gets appended to `facts.md` |
| `inject_tag_hint` | boolean | `true` | Include known-tags hint in session-start injection |
| `score_recency_24h` | integer | `2` | Recency boost for entries < 24h old |
| `score_recency_7d` | integer | `1` | Recency boost for entries < 7d old |
| `score_tag_exact` | integer | `3` | Boost for exact tag-token matches |
| `debug` | boolean | `false` | Verbose stderr logging |
| `store_description` | string | `""` | Human-readable store description (in README) |
| `custom_inject_header` | string | `"Known about this project:"` | Override the injection header |

### System-side (operator-local, never committed)

| Field | Type | Description |
|---|---|---|
| `encryption_key` | string | v0 placeholder — demonstrates system_config_schema usage |

## Testing

```bash
bun test          # 186 tests, 317 assertions
tsc --noEmit      # typecheck
```

## On-disk layout

```
<store>/
  README.md                     # auto-generated, preserved if operator edits
  facts.md                      # curated bullet list of short facts
  <snowflake-id>.md             # individual memory entries
  transcripts/
    <session-id>.md             # full session transcript (upsert)
    <session-id>-compact-<id>.md  # preserved compaction chunks
  primary/                      # per-agent dir when isolation: agent
  primary.subagents.researcher/ # subagent dirs when isolation: agent
```

Every file is plain markdown with YAML frontmatter. The operator can read, edit, diff, or commit any of it.

---

## License

MIT © the kaged project

<div align="center">

`[kaged]` · [kaged.dev](https://kaged.dev) · *sanctioned edge, sacred code*

</div>
