# Phase F · S1 — Project Portfolio Dashboard (design)

**Date:** 2026-06-11
**Repo surface:** `Meta-Psy/praktor` (fork — MC backend + UI), `~/.claude` (local publisher), new `Meta-Psy/portfolio-data` (data repo)
**Status:** design approved by Alex 2026-06-11; next → `writing-plans`.

## Context — Phase F reframe

The Phase F sub-project originally labelled "многоагентность" was, on elaboration, redefined
by Alex into the North-star control surface that memory anticipated ("кастомный лендинг ТОЛЬКО
когда агрегация станет реальной болью" — the pain has now arrived). Multi-agent dissolves into
this: the "3 directions" Alex described (trivial-trust / standard-approve / complex-plan-HTML-approve)
are a triage layer, not an agent swarm.

The full vision decomposes into **6 independent subsystems**, each its own spec → plan → impl cycle:

- **S1. Project portfolio dashboard** — visual monitoring of every non-PII project: planned
  directions, in-progress + progress, done. *(this doc)*
- **S2. Intake from any device → triage** — TG voice/photo/chat → analyze → 3 routes
  (trivial-autonomous / standard-plan-approve / complex-HTML-plan-approve).
- **S3. Approve-plans-from-UI** — render plan as HTML on the landing + approve/edit button
  (extends F.3 approve-from-UI from PR-level to plan-level).
- **S4. Capability catalog** — MCP/tools/skills + visibility into self-learning / memory-hygiene
  / optimization processes.
- **S5. Claude-ecosystem radar** — real-time "new cool Claude tooling on GitHub".
- **S6. Per-project periodic intel** — scheduled scrape from pre-selected sources (e.g. Mentis
  learning-center census, weekly/monthly diff).

**Order:** S1 first (Alex's #1 stated need = visibility; foundation shell for the rest; lowest
risk, read-only; fits 2GB VPS), then S2+S3 (control loop), S4 folds into S1, S5/S6 later.

This doc covers **S1 only.**

## Goal

A read-only dashboard, reachable from any device via the existing MC surface
(`mc.alexmetapsy.com`, behind CF Tunnel + Basic-auth), that shows — clearly and structurally —
for every opted-in non-PII project: its planned directions, what is in progress (with progress),
and what is done. Kills the "I have no single structured view of my projects" pain.

## Decisions (locked via brainstorm)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Source of truth | **Hybrid** — structured `roadmap:` block in `project_*.md` frontmatter + live GitHub enrichment for code-projects |
| D2 | Project scope | **Opt-in by roadmap-block presence**; PII repos (histology/pemphigus) hard carve-out, never appear |
| D3 | Read vs control | **Read-only** (control buttons are S2/S3) |
| D4 | Granularity / UX | **Overview + drill-down** — compact rows (status + % + next-action) → click → directions in lanes planned/doing/done |
| D5 | Transport (local memory → VPS) | **Sanitized `portfolio.json` → private repo `Meta-Psy/portfolio-data` → MC reads via F.2 GitHub-read client** |
| D6 | Surface | **Extend MC React app** (new Portfolio page), reuse F.2/F.3 patterns |

## Architecture (3 units)

### 1. Local publisher (`~/.claude`)
- `portfolio-publish.cjs` (pure `buildPortfolio(memoryDir)` + thin CLI) + `/publish-portfolio` command.
  Later (optional): SessionEnd hook.
- Reads `projects/C--Users-Alex/memory/project_*.md`, parses the `roadmap:` frontmatter block,
  emits a **sanitized** `portfolio.json` (ONLY roadmap fields — never body prose, never secrets),
  commits + pushes to `Meta-Psy/portfolio-data`.
- **PII carve-out** enforced here: explicit name-list (histology/pemphigus) skipped + a guard that
  refuses to emit if a file lacks the structured block but matches a PII name.

### 2. MC Go backend (fork)
- New `internal/web/portfolio.go`: read `portfolio.json` from the data repo via the existing F.2
  GitHub-read client; `GET /api/portfolio` with the F.2 cache pattern (build-outside-lock,
  `context.Background()` + timeout, ~30s TTL).
- For code-projects, merge roadmap data with live F.2 `/api/projects` state (CI/PR/deploy) by
  project key. Partial-degradation: GitHub enrichment failure → roadmap still shown + error chip.

### 3. MC React frontend (fork)
- New `ui/src/pages/Portfolio.tsx` + helpers + nav entry. Overview rows → drill-down lanes.
  Reuses F.2 Projects page patterns (fetch, WS refetch throttled, status chips).

## roadmap-block schema (frontmatter in `project_*.md`)

```yaml
roadmap:
  status: active | paused | done
  next_action: "one line — what's next"
  directions:
    - { title: "...", state: planned }
    - { title: "...", state: doing }
    - { title: "...", state: done }
```

- `percent` is **derived** = done / total directions (not stored).
- Minimal by design (YAGNI): no dates, no burndown, no assignees.

## Data flow

```
roadmap block (local memory)
  → /publish-portfolio  → portfolio.json
  → Meta-Psy/portfolio-data (private repo)
  → MC GitHub-read client (cached)  → GET /api/portfolio
  → React Portfolio page  → drill-down
```

## Error handling

- Per-project GitHub enrichment fails → render roadmap data anyway, error chip on that card (F.2 pattern).
- Data repo unreachable → serve last cache + a "stale" banner.
- A `project_*.md` with a malformed `roadmap:` block → publisher skips it + logs which file
  (never publishes a half-parsed entry).

## Testing

- **Publisher** (unit): parse a valid block; derive percent; skip files without a block; skip
  PII files by name; refuse malformed block; sanitize (assert no body/secret keys leak into JSON).
- **Go**: portfolio aggregator merge (roadmap × GitHub state); cache behaviour; partial-degradation.
- **React**: render overview rows; drill-down lanes; stale banner; error chip.

## Scope — v1 boundaries (YAGNI)

- Read-only; no action buttons.
- Backfill roadmap blocks for **active** projects only; dormant projects simply don't appear until given a block.
- No S4/S5/S6.
- No dates / burndown / historical trend.
- PII carve-out enforced at the publisher.

## [ALEX] gates (prod — classifier blocks, Alex executes)

1. Create private repo `Meta-Psy/portfolio-data`.
2. Add that repo to the scope of the read-PAT `GITHUB_READ_TOKEN` (already on the server from F.2).
3. Approve the publisher addition to `~/.claude` (via diff — process rule #2).
4. (Deploy, as in F.2/F.3) rebuild orchestrator image with S1 backend + recreate; new `projects`/
   data-repo wiring as needed.

## Open questions (non-blocking, resolve in plan)

- Exact data-repo path layout (`portfolio.json` at root vs `data/`).
- Whether Portfolio is a new nav page or a tab on the existing Projects page.
- Publisher trigger: command-only for v1 vs add SessionEnd hook (lean command-only first).
