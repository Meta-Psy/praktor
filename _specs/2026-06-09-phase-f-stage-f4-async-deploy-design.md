# Phase F.4 — Async deploy for Mission Control

**Date:** 2026-06-09
**Repo:** `Meta-Psy/praktor` (fork)
**Status:** design approved (Alex, 2026-06-09)

## Problem

The MC deploy action (`POST /api/projects/{key}/deploy`, F.3) runs **synchronously**.
The gnathology host-rebuild path (git pull + `compose up --build`) can take longer
than Cloudflare's ~100s edge timeout, so the browser sees a **502/524** even though
the deploy completes server-side. The TG audit already fires on completion (on a
fresh `context.Background()`), so the *completion signal* exists — what's missing is
that the HTTP request shouldn't block on the deploy.

(pdai's `workflow_dispatch` deploy is already fast — a single API call — but it shares
the same handler, so the fix applies uniformly.)

## Goal

Make the deploy action non-blocking: the button returns immediately, the deploy runs
in the background, and per-project deploy status is visible in the UI. A second deploy
of the same project while one is running is rejected (no concurrent builds).

Non-goals (YAGNI for current pain): persisted deploy history/logs, a streaming status
endpoint, queueing of deploys, async-ifying approve/merge (those are fast API calls).

## Approach (approved)

- **Status visibility:** in-memory per-project deploy status, surfaced in the existing
  `/api/projects` roll-up. No new endpoint, no DB. (Option 2 of 3.)
- **Concurrency:** reject a second deploy while one is running with **409**. (Option 1 of 3.)

## Architecture

`handleDeploy` stops blocking the request:

1. Atomically mark the project `running` via the status store. If already `running` →
   respond **409** `{"error":"deploy already in progress"}`, do nothing else.
2. Launch the deploy in a goroutine on `context.Background()` with a 12-minute timeout
   (matching the old handler ceiling) — **not** `r.Context()`, so a client disconnect /
   Cloudflare timeout no longer cancels the deploy.
3. Respond **202** `{"status":"started"}` immediately.
4. When the goroutine finishes, it records the outcome in the store (`ok`/`failed` +
   `finishedAt` + `error`) and emits the existing TG audit (`✅/❌ MC: deploy …`).

Applies to the whole `handleDeploy` (both `workflow_dispatch` and host-rebuild branches);
pdai simply transitions `running → ok` near-instantly.

## Components

### `internal/web/deploy_status.go` (new) + test
Concurrency-safe in-memory store. Per project key:

```
type deployRun struct {
    State      string // "" (never run) | "running" | "ok" | "failed"
    StartedAt  time.Time
    FinishedAt time.Time
    Error      string
}
```

- `tryStart(key string) bool` — under mutex: if current state is `running`, return false;
  else set `running` + `StartedAt`, return true.
- `finish(key string, err error)` — under mutex: set `ok` (err nil) or `failed` + `Error`,
  set `FinishedAt`.
- `snapshot(key string) deployRun` — copy for the aggregator.

Lives on `Server` (e.g. `s.deploys *deployStore`), initialized in `NewServer`.

### `internal/web/actions.go` — `handleDeploy` rewrite
- Resolve project (404 if unknown) as today.
- `if !s.deploys.tryStart(key) { jsonError(409 "deploy already in progress") }`.
- `go func() { ... s.deploys.finish(key, err); s.audit(ok, detail) }()` with a fresh
  `context.WithTimeout(context.Background(), 12*time.Minute)`.
- The goroutine body keeps the existing branch logic (DispatchWorkflow / GnathologyDeployer).
- Respond 202 `{"status":"started"}`.
- The `s.oneShot == nil` / `DeployHostDir`-vs-`DeployWorkflow` validation stays **before**
  `tryStart` so a misconfigured project still returns a synchronous 4xx (not a stuck `running`).

### `internal/web/projects.go` — aggregator
Add `deploy_run` to each project's status JSON, populated from `s.deploys.snapshot(key)`:
`{state, started_at, finished_at, error}` (omit empty). Read-only; no network.

### UI (`ui/src/pages/{Projects.tsx,projectStatus.ts,actions.ts}` + `ui/src/__tests__`)
- `actions.ts` `deploy()`: treat 202 as success ("deploy started"); surface 409 as a
  clear "already running" message (not a generic failure).
- `projectStatus.ts`: a `deployRunLabel(deploy_run)` helper → `running…` / `ok HH:MM` /
  `failed: <err>` / (nothing if never run).
- `Projects.tsx`: show the deploy-run label on the card; disable the **deploy** button
  while `running`. After a deploy POST returns 202, poll `/api/projects` at a faster
  cadence (~4s) until that project's `deploy_run.state` leaves `running`, then fall back
  to the normal 30s refetch.

## Data flow

```
click → POST /deploy → tryStart
  ├─ already running → 409 (UI: "already in progress")
  └─ ok → 202 + goroutine
            UI: card shows running…, fast-polls /api/projects
            goroutine done → finish(ok/failed) + TG audit
            next refetch → card shows ok HH:MM / failed: <err>
```

## Error handling & restart

- Deploy error → `finish(key, err)` records `failed` + message; TG audit `❌`; UI shows
  `failed: <err>`.
- **praktor restart mid-deploy:** in-memory store is lost → state resets to `` (never run)
  on boot; the background goroutine dies with the process (no final TG audit), and the
  `praktor-deploy-*` one-shot container may be left orphaned. Accepted limitation: restart
  is rare, the deploy can be re-triggered, and no persistence is introduced (YAGNI).

## Testing

- `deploy_status_test.go`: `tryStart` returns false while `running`; concurrent `tryStart`
  — exactly one wins; `finish(nil)` → `ok`, `finish(err)` → `failed` + error text.
- `handleDeploy`: 202 on start; 409 when a run is already in progress (fake deployer);
  unknown project → 404; misconfigured project (no mechanism) → synchronous 4xx before
  any `running` state is set.
- Existing `host_deploy` tests unchanged.
- UI: `actions.test.ts` covers 202 (started) and 409 (already running) handling.

## Files (~5)

- `internal/web/deploy_status.go` (new) + `deploy_status_test.go` (new)
- `internal/web/actions.go` (handleDeploy)
- `internal/web/projects.go` (aggregator field)
- `ui/src/pages/{Projects.tsx,projectStatus.ts,actions.ts}` + `ui/src/__tests__/actions.test.ts`
