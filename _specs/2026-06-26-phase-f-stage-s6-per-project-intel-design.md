# Phase F · S6 — Per-project periodic intel (design)

*Date: 2026-06-26. Last subsystem of the North-star control surface (S1–S6).*

## Context

S1–S5 of the North-star decomposition are merged and deployed:

- **S1** project portfolio dashboard, **S2** intake→triage, **S3** approve-plans-from-UI,
  **S4** capability catalog, **S5** Claude-ecosystem radar (global GitHub-topic feed,
  mechanical Go collector + optional Telegram digest).

S6 is the last subsystem. Original framing (S1 design doc, line 26):

> **S6. Per-project periodic intel** — scheduled scrape from pre-selected sources
> (e.g. Mentis learning-center census, weekly/monthly diff).

S6 differs from S5 on two axes: sources are **custom per project** (not a global
GitHub topic search), and delivery is **pull-only** into Mission Control (S5 already
covers push-awareness via Telegram).

## Goal

A read-only "intel" feed in Mission Control. On a per-source schedule, a Claude agent
collects a **structured snapshot** from a pre-described source, S6 stores the history,
and the page shows the latest snapshot plus a "what changed" note per source.

## Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | Scope of first sources | Heterogeneous sources across **multiple projects**; universal source registry from the start |
| D2 | Primary value each cycle | **Read-only MC page with snapshots + history** (per source). Telegram digest / threshold alerts are **not** in v1 (YAGNI — S5 already gives push-awareness) |
| D3 | Extraction mechanism | **Agent-driven scrape** over the existing scheduled-task pattern. The agent receives the *previous snapshot* and returns a *new snapshot* + a `change_note`. The agent writes the diff — Go never parses arbitrary JSON to diff it |
| D4 | Source registry | **YAML config** (`intel:` block), hot-reloadable — like the existing `projects:` map. No UI CRUD in v1 |
| D5 | Default agent | Per-source optional `agent`; default = `router.default_agent`. `researcher` (WebSearch/WebFetch) is the natural choice for web sources and can be set per source |

Rejected: mechanical per-source Go collectors (B) — brittle, one code path per source
type, poor fit for "heterogeneous from scratch". Hybrid (C) — most complex, two paths.

## Architecture (reuses S5 / scheduler patterns)

```
config intel.sources ──┐
                        ▼
   internal/intel.Collector  (goroutine; gronx schedule per source)
        │  on tick: load latest snapshot for source.key
        │  prompt = instruction + previous snapshot + output contract
        ▼
   AgentRunner.Run(agent, prompt) → agent response text   ← NOT delivered to Telegram
        │  (capture via orchestrator OnOutput listener correlated by msg_id)
        ▼
   intel.parseSnapshot(response) → store.UpsertIntelSnapshot(...)
                                          │
   web GET /api/intel (read-only) ◄───────┘ → ui Intel.tsx (history + change_note)
```

Import graph `store ← intel ← web ← main`; `intel` isolated behind interfaces
(`SnapshotStore`, `AgentRunner`) so it is unit-testable without NATS/agents,
mirroring how S5 isolated `radar` behind `RepoSearcher`/`RadarStore`.

## Data model

### YAML config

```yaml
intel:
  enabled: true
  sources:
    - key: mentis-centers              # stable id, used as snapshot grouping key
      project: mentis                  # ties to projects: map / portfolio
      name: "Учебные центры Ташкента"
      instruction: "Посчитай учебные центры по химии/биологии в Ташкенте (goldenpages.uz и аналоги); верни список с ценами где есть."
      cron: "0 9 * * 1"                # weekly, Mon 09:00 (gronx, as scheduler)
      agent: researcher                # optional; default = router.default_agent
```

`applyIntelDefaults` fills: missing `cron` → a sane weekly default; missing `agent`
→ `router.default_agent`. `enabled: false` (or absent) → collector goroutine never starts.

### Agent output contract

The agent must return a fenced JSON block:

```json
{
  "summary": "1–2 sentences describing the current state",
  "metrics": { "centers": 42, "avg_price": 900000 },
  "items": [ { "name": "...", "note": "..." } ],
  "change_note": "what changed vs the previous snapshot (or 'first snapshot')"
}
```

`metrics` and `items` are free-form (agent decides per source). `change_note` is the
human-readable diff.

### Storage

Table `intel_snapshots`:

| column | type | note |
|--------|------|------|
| `id` | INTEGER PK | |
| `source_key` | TEXT | grouping key from config |
| `project` | TEXT | for grouping in the UI |
| `captured_at` | INTEGER | unix epoch seconds |
| `payload_json` | TEXT | the full agent JSON (summary/metrics/items) |
| `change_note` | TEXT | agent-written diff |
| `ok` | INTEGER | 1 = parsed successfully, 0 = failure |
| `error` | TEXT | failure reason when `ok=0` |

History for a source = all rows with that `source_key`, newest first. Index on
`(source_key, captured_at)`.

## Components (mirrors S5 layout)

- `internal/intel/types.go` — `Source`, `Snapshot`, interfaces `SnapshotStore`, `AgentRunner`.
- `internal/intel/collector.go` — `Collector` + `collectOnce(ctx, source)`: build prompt,
  run agent, parse, upsert. First pass per source on startup honoring cron cadence
  (or an initial immediate pass, decided in plan).
- `internal/intel/prompt.go` — `buildPrompt(instruction, prev)` + `parseSnapshot(text)`
  (extract the fenced JSON block; tolerate prose around it).
- `internal/store/intel.go` — `intel_snapshots` table + `UpsertIntelSnapshot`,
  `ListSnapshotsByProject`, `LatestSnapshot(sourceKey)`.
- `internal/config/config.go` — `IntelConfig` + `applyIntelDefaults`.
- `cmd/praktor/main.go` — start the collector goroutine, gated on `intel.enabled`.
- `internal/web/intel.go` + `GET /api/intel` — read-only; group by project → source,
  each with its latest snapshot + history.
- `ui/src/pages/Intel.tsx` + `intelStatus.ts` + nav entry.

## Key new integration point

Capturing the agent's response text into the collector **without Telegram delivery**
is the one piece of new plumbing (S5's digest only *sent* to Telegram, never read the
reply back).

- **Recommended:** an `OnOutput` listener correlated by `msg_id`. `HandleMessage` already
  carries a `msg_id`; the collector dispatches with `meta` marking the message as intel
  so the Telegram-delivery path skips it, and resolves the awaiting call when the matching
  output arrives. This reuses the existing output path (same one scheduled tasks use).
- **Alternative:** a `RouteQuery`-style synchronous orchestrator method that runs a full
  agent turn (tools enabled) and returns the text.

The exact wiring (which of the two, timeout handling, concurrency with user messages)
is pinned in the implementation plan.

## Error handling

- Agent returns no valid JSON, or the source is unreachable → store a snapshot with
  `ok=0, error=<reason>`. History is never broken; the MC page shows "collection failed"
  + timestamp for that cycle.
- Agent run times out → same failure snapshot.
- Collector logs upsert/parse errors (symmetry with the S5 collector review follow-up).

## Testing (TDD)

- `parseSnapshot`: valid JSON, JSON wrapped in prose, garbage, partial/missing fields.
- `Collector.collectOnce`: fake `AgentRunner` returns fixed JSON → fake store receives
  the expected upsert; failure path stores `ok=0`.
- `store`: snapshot CRUD + `LatestSnapshot` ordering.
- `web /api/intel`: grouping by project→source, latest + history shape.
- UI vitest: `intelStatus.ts` status/label mapping.

## Out of scope (YAGNI)

Telegram digest, threshold alerts, UI CRUD for sources, mechanical collector adapters,
trend charts. Each can be a follow-up stage if a real need appears.
