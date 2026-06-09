# F.4 Async Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Mission Control deploy action non-blocking so long host-rebuilds don't hit Cloudflare's edge timeout; surface per-project deploy status in `/api/projects`; reject concurrent deploys of the same project with 409.

**Architecture:** `handleDeploy` validates the deploy mechanism synchronously, atomically marks the project `running` in a new in-memory `deployStore` (409 if already running), launches the deploy in a background goroutine on `context.Background()`, and returns 202 immediately. The goroutine records the outcome and emits the existing TG audit. The live deploy status is overlaid onto the cached `/api/projects` roll-up at response time so it isn't masked by the 30s cache.

**Tech Stack:** Go 1.26 (backend), React + Vite + Vitest (UI). Spec: `_specs/2026-06-09-phase-f-stage-f4-async-deploy-design.md`.

---

## Conventions (test runners)

Go is not installed natively on this Windows host — run Go tests/build in Docker (cache volumes are required, else every run re-downloads deps):

`<GOTEST>` means:
```bash
MSYS_NO_PATHCONV=1 docker run --rm \
  -v /c/Users/Alex/10_Projects/praktor:/src \
  -v praktor-gocache:/root/.cache/go-build \
  -v praktor-gomod:/go/pkg/mod \
  -w /src -e GOTOOLCHAIN=auto golang:1.26rc1 \
  sh -c '<command>'
```

UI runs natively (Node 22) from the repo root:
- Test: `npx --prefix ui vitest run --root ui <file>` (or `cd ui && npx vitest run <file>`)
- Build: `npm --prefix ui run build`

Commit after each task. Branch: `feature/f4-async-deploy` (already created off main).

---

## File structure

- **Create** `internal/web/deploy_status.go` — `deployStore` (in-memory per-project deploy state) + `deployRun` type.
- **Create** `internal/web/deploy_status_test.go` — store unit tests.
- **Modify** `internal/web/server.go` — add `deploys *deployStore` field + init in `NewServer`.
- **Modify** `internal/web/actions.go` — async `handleDeploy` (validate → 409 guard → goroutine → 202).
- **Modify** `internal/web/projects.go` — `DeployRun` field on `ProjectStatus`, pure `overlayDeployRuns` helper, use it in `handleProjects`.
- **Modify** `internal/web/projects_test.go` (or new test) — test `overlayDeployRuns`.
- **Modify** `ui/src/pages/projectStatus.ts` — `DeployRun` type + `deployRunLabel`.
- **Create** `ui/src/__tests__/projectStatus.test.ts` — `deployRunLabel` tests.
- **Modify** `ui/src/pages/Projects.tsx` — show label, disable button while running, fast-poll while running, refetch after deploy click.
- **Modify** `ui/src/__tests__/actions.test.ts` — assert `deploy` resolves on 202.

---

## Task 1: deployStore (in-memory deploy status)

**Files:**
- Create: `internal/web/deploy_status.go`
- Test: `internal/web/deploy_status_test.go`

- [ ] **Step 1: Write the failing test**

Create `internal/web/deploy_status_test.go`:
```go
package web

import (
	"errors"
	"sync"
	"sync/atomic"
	"testing"
)

func TestTryStartGuardsRunning(t *testing.T) {
	d := newDeployStore()
	if !d.tryStart("pdai") {
		t.Fatal("first tryStart should succeed")
	}
	if d.tryStart("pdai") {
		t.Fatal("second tryStart must fail while running")
	}
	if got := d.snapshot("pdai").State; got != "running" {
		t.Fatalf("state = %q, want running", got)
	}
}

func TestFinishSetsOutcome(t *testing.T) {
	d := newDeployStore()
	d.tryStart("a")
	d.finish("a", nil)
	if got := d.snapshot("a").State; got != "ok" {
		t.Fatalf("state = %q, want ok", got)
	}
	if d.snapshot("a").FinishedAt.IsZero() {
		t.Fatal("FinishedAt must be set")
	}
	// after finishing, a new run can start
	if !d.tryStart("a") {
		t.Fatal("tryStart should succeed after finish")
	}

	d.tryStart("b")
	d.finish("b", errors.New("boom"))
	snap := d.snapshot("b")
	if snap.State != "failed" || snap.Error != "boom" {
		t.Fatalf("got state=%q err=%q, want failed/boom", snap.State, snap.Error)
	}
}

func TestTryStartConcurrentSingleWinner(t *testing.T) {
	d := newDeployStore()
	var wins int64
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if d.tryStart("x") {
				atomic.AddInt64(&wins, 1)
			}
		}()
	}
	wg.Wait()
	if wins != 1 {
		t.Fatalf("exactly one tryStart should win, got %d", wins)
	}
}

func TestSnapshotNeverRunIsZero(t *testing.T) {
	d := newDeployStore()
	if got := d.snapshot("nope").State; got != "" {
		t.Fatalf("never-run state = %q, want empty", got)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `<GOTEST>` with command `go test ./internal/web/ -run 'TestTryStart|TestFinish|TestSnapshot' -v`
Expected: FAIL — `undefined: newDeployStore`.

- [ ] **Step 3: Write minimal implementation**

Create `internal/web/deploy_status.go`:
```go
package web

import (
	"sync"
	"time"
)

// deployRun is the in-memory status of one project's most recent deploy.
type deployRun struct {
	State      string    `json:"state"` // "" (never run) | "running" | "ok" | "failed"
	StartedAt  time.Time `json:"started_at,omitempty"`
	FinishedAt time.Time `json:"finished_at,omitempty"`
	Error      string    `json:"error,omitempty"`
}

// deployStore tracks at most one deploy per project key. Status is in-memory only
// (lost on restart); the TG audit remains the durable record of completion.
type deployStore struct {
	mu   sync.Mutex
	runs map[string]deployRun
}

func newDeployStore() *deployStore {
	return &deployStore{runs: make(map[string]deployRun)}
}

// tryStart atomically marks key running. It returns false if a deploy for key is
// already in progress (the caller should reject with 409).
func (d *deployStore) tryStart(key string) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.runs[key].State == "running" {
		return false
	}
	d.runs[key] = deployRun{State: "running", StartedAt: time.Now()}
	return true
}

// finish records the outcome of key's run.
func (d *deployStore) finish(key string, err error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	r := d.runs[key]
	r.FinishedAt = time.Now()
	if err != nil {
		r.State = "failed"
		r.Error = err.Error()
	} else {
		r.State = "ok"
		r.Error = ""
	}
	d.runs[key] = r
}

// snapshot returns a copy of key's current run state (zero value if never run).
func (d *deployStore) snapshot(key string) deployRun {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.runs[key]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `<GOTEST>` with command `go test ./internal/web/ -run 'TestTryStart|TestFinish|TestSnapshot' -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Alex/10_Projects/praktor
git add internal/web/deploy_status.go internal/web/deploy_status_test.go
git commit -m "feat(web): in-memory deploy-status store for async deploy"
```

---

## Task 2: Wire deployStore into Server

**Files:**
- Modify: `internal/web/server.go` (Server struct ~line 44-67; NewServer ~line 69-100)

- [ ] **Step 1: Add the field**

In the `Server` struct, after the `oneShot oneShotRunner // host one-shot container runner (F.3)` line, add:
```go
	deploys    *deployStore  // per-project async deploy status (F.4)
```

- [ ] **Step 2: Initialize it in NewServer**

In `NewServer`, immediately after `srv.projects = projects` (before the `if len(srv.projects) > 0 {` block), add:
```go
	srv.deploys = newDeployStore()
```
(Unconditional so `snapshot` is always safe even with no projects configured.)

- [ ] **Step 3: Verify it compiles**

Run: `<GOTEST>` with command `go build ./...`
Expected: builds clean (no usage yet — `deploys` is set but only read in later tasks; Go does not warn on unused struct fields).

- [ ] **Step 4: Commit**

```bash
cd /c/Users/Alex/10_Projects/praktor
git add internal/web/server.go
git commit -m "feat(web): add deployStore to Server"
```

---

## Task 3: Async handleDeploy (validate → 409 guard → goroutine → 202)

**Files:**
- Modify: `internal/web/actions.go` (`handleDeploy`, currently the synchronous version)
- Test: `internal/web/actions_test.go` (create if absent; otherwise append)

Current `handleDeploy` runs the deploy synchronously on `r.Context()` and returns 200/502. Replace it entirely with the async version below.

- [ ] **Step 1: Write the failing test**

Create or append to `internal/web/actions_test.go`:
```go
package web

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/mtzanidakis/praktor/internal/config"
)

// blockingRunner lets a host deploy hang until released, so the test can observe
// the "running" window and the 409 guard.
type blockingRunner struct {
	release chan struct{}
	err     error
}

func (b *blockingRunner) Run(ctx context.Context, _ oneShotSpec) (string, int, error) {
	<-b.release
	return "", 0, b.err
}

func newDeployTestServer(runner oneShotRunner) *Server {
	return &Server{
		projects: map[string]config.ProjectDefinition{
			"gnathology": {Repo: "x/g", DeployHostDir: "/opt/apps/g", DeployComposeProject: "g"},
			"bad":        {Repo: "x/b"},
		},
		deploys: newDeployStore(),
		oneShot: runner,
	}
}

func postDeploy(s *Server, key string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodPost, "/api/projects/"+key+"/deploy", nil)
	r.SetPathValue("key", key)
	w := httptest.NewRecorder()
	s.handleDeploy(w, r)
	return w
}

func TestHandleDeployUnknownProject(t *testing.T) {
	s := newDeployTestServer(&blockingRunner{release: make(chan struct{})})
	if got := postDeploy(s, "nope").Code; got != http.StatusNotFound {
		t.Fatalf("code = %d, want 404", got)
	}
}

func TestHandleDeployNoMechanism(t *testing.T) {
	s := newDeployTestServer(&blockingRunner{release: make(chan struct{})})
	if got := postDeploy(s, "bad").Code; got != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400", got)
	}
}

func TestHandleDeployAsyncAndGuard(t *testing.T) {
	runner := &blockingRunner{release: make(chan struct{})}
	s := newDeployTestServer(runner)

	// First deploy returns 202 immediately while the runner blocks.
	if got := postDeploy(s, "gnathology").Code; got != http.StatusAccepted {
		t.Fatalf("first deploy code = %d, want 202", got)
	}
	// Wait for the goroutine to mark running.
	deadline := time.Now().Add(2 * time.Second)
	for s.deploys.snapshot("gnathology").State != "running" {
		if time.Now().After(deadline) {
			t.Fatal("deploy never entered running state")
		}
		time.Sleep(5 * time.Millisecond)
	}
	// Second deploy while running → 409.
	if got := postDeploy(s, "gnathology").Code; got != http.StatusConflict {
		t.Fatalf("concurrent deploy code = %d, want 409", got)
	}
	// Release; the run finishes ok.
	close(runner.release)
	deadline = time.Now().Add(2 * time.Second)
	for s.deploys.snapshot("gnathology").State != "ok" {
		if time.Now().After(deadline) {
			t.Fatalf("deploy did not finish ok, state=%q", s.deploys.snapshot("gnathology").State)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestHandleDeployRecordsFailure(t *testing.T) {
	runner := &blockingRunner{release: make(chan struct{}), err: errors.New("compose boom")}
	s := newDeployTestServer(runner)
	postDeploy(s, "gnathology")
	close(runner.release)
	deadline := time.Now().Add(2 * time.Second)
	for s.deploys.snapshot("gnathology").State == "" || s.deploys.snapshot("gnathology").State == "running" {
		if time.Now().After(deadline) {
			t.Fatal("deploy never finished")
		}
		time.Sleep(5 * time.Millisecond)
	}
	snap := s.deploys.snapshot("gnathology")
	if snap.State != "failed" {
		t.Fatalf("state = %q, want failed", snap.State)
	}
}
```

(The `s.tg` field is nil in the test server; `s.audit` must no-op on nil `tg` — it already does: `audit` returns early when `s.tg == nil`. Verify that guard exists in `actions.go`; it does as of F.3.)

- [ ] **Step 2: Run test to verify it fails**

Run: `<GOTEST>` with command `go test ./internal/web/ -run TestHandleDeploy -v`
Expected: FAIL — the current synchronous `handleDeploy` returns 200 (not 202) and never sets `running`, so `TestHandleDeployAsyncAndGuard` fails.

- [ ] **Step 3: Replace handleDeploy with the async version**

In `internal/web/actions.go`, replace the entire `handleDeploy` function with:
```go
func (s *Server) handleDeploy(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	def, ok := s.projects[key]
	if !ok {
		jsonError(w, "unknown project", http.StatusNotFound)
		return
	}

	// Validate the deploy mechanism synchronously so a misconfigured project
	// returns a 4xx now instead of getting stuck in a "running" state.
	switch {
	case def.DeployWorkflow != "":
		// ok
	case def.DeployHostDir != "":
		if s.oneShot == nil {
			jsonError(w, "host deploy unavailable (no docker)", http.StatusServiceUnavailable)
			return
		}
	default:
		jsonError(w, "no deploy mechanism configured for project", http.StatusBadRequest)
		return
	}

	// One deploy per project at a time.
	if !s.deploys.tryStart(key) {
		jsonError(w, "deploy already in progress", http.StatusConflict)
		return
	}

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 12*time.Minute)
		defer cancel()

		var (
			detail string
			err    error
		)
		switch {
		case def.DeployWorkflow != "":
			detail = fmt.Sprintf("deploy %s (dispatch %s)", key, def.DeployWorkflow)
			err = s.ghWrite.DispatchWorkflow(ctx, def.Repo, def.DeployWorkflow, "main")
		case def.DeployHostDir != "":
			detail = fmt.Sprintf("deploy %s (host rebuild)", key)
			dep := &GnathologyDeployer{
				Runner:      s.oneShot,
				HostDir:     def.DeployHostDir,
				ComposeProj: def.DeployComposeProject,
				Token:       s.writeToken(),
			}
			err = dep.Deploy(ctx)
		}

		s.deploys.finish(key, err)
		if err != nil {
			s.audit(false, detail+": "+err.Error())
		} else {
			s.audit(true, detail)
		}
	}()

	// 202 Accepted: the deploy runs in the background; watch the TG audit / the
	// deploy_run status in /api/projects for the outcome.
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "started"})
}
```

Ensure `actions.go` imports `context`, `fmt`, `net/http`, `time`, `encoding/json` (all already imported as of F.3 — confirm `time` is present; add it to the import block if not).

- [ ] **Step 4: Run test to verify it passes**

Run: `<GOTEST>` with command `go test ./internal/web/ -run TestHandleDeploy -v`
Expected: PASS (4 tests). Then full package: `go vet ./internal/web/ && go test ./internal/web/ && go build ./...` — all green.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Alex/10_Projects/praktor
git add internal/web/actions.go internal/web/actions_test.go
git commit -m "feat(web): async handleDeploy with 409 concurrency guard"
```

---

## Task 4: Surface deploy_run in /api/projects (live, not cached)

**Files:**
- Modify: `internal/web/projects.go` (`ProjectStatus` struct ~line 37-47; `handleProjects` ~line 160-176)
- Test: `internal/web/projects_test.go` (append; create if absent)

The roll-up is cached 30s. The deploy status must be overlaid live at response time so a running deploy isn't masked by the cache.

- [ ] **Step 1: Write the failing test**

Append to `internal/web/projects_test.go` (create with `package web` + imports if the file does not exist):
```go
func TestOverlayDeployRuns(t *testing.T) {
	d := newDeployStore()
	d.tryStart("pdai")
	data := []ProjectStatus{
		{Name: "pdai", Repo: "x/pdai"},
		{Name: "gnathology", Repo: "x/g"},
	}
	out := overlayDeployRuns(data, d)
	if out[0].DeployRun.State != "running" {
		t.Fatalf("pdai deploy_run = %q, want running", out[0].DeployRun.State)
	}
	if out[1].DeployRun.State != "" {
		t.Fatalf("gnathology deploy_run = %q, want empty", out[1].DeployRun.State)
	}
	// The cached input slice must NOT be mutated.
	if data[0].DeployRun.State != "" {
		t.Fatal("overlay must not mutate the input (cached) slice")
	}
}
```
(Required imports for a new file: `testing`. The `package web` test files share the package, so `newDeployStore`/`ProjectStatus`/`overlayDeployRuns` are in scope.)

- [ ] **Step 2: Run test to verify it fails**

Run: `<GOTEST>` with command `go test ./internal/web/ -run TestOverlayDeployRuns -v`
Expected: FAIL — `DeployRun` field and `overlayDeployRuns` undefined.

- [ ] **Step 3: Add the field, the helper, and use it**

In `internal/web/projects.go`, add a field to `ProjectStatus` (after the `Agents` field):
```go
	DeployRun   deployRun    `json:"deploy_run"`
```

Add the pure helper (e.g. just below the `ProjectStatus` struct):
```go
// overlayDeployRuns returns a copy of data with each project's live deploy_run
// stamped from the store. The input slice (which may be the shared cache) is not
// mutated.
func overlayDeployRuns(data []ProjectStatus, d *deployStore) []ProjectStatus {
	out := make([]ProjectStatus, len(data))
	copy(out, data)
	for i := range out {
		out[i].DeployRun = d.snapshot(out[i].Name)
	}
	return out
}
```

In `handleProjects`, change the final response line from:
```go
	jsonResponse(w, data)
```
to:
```go
	jsonResponse(w, overlayDeployRuns(data, s.deploys))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `<GOTEST>` with command `go test ./internal/web/ -run TestOverlayDeployRuns -v`
Expected: PASS. Then: `go vet ./internal/web/ && go test ./internal/web/ && go build ./...` — all green.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Alex/10_Projects/praktor
git add internal/web/projects.go internal/web/projects_test.go
git commit -m "feat(web): overlay live deploy_run onto cached /api/projects"
```

---

## Task 5: UI — deploy status label, button guard, fast-poll

**Files:**
- Modify: `ui/src/pages/projectStatus.ts`
- Create: `ui/src/__tests__/projectStatus.test.ts`
- Modify: `ui/src/pages/Projects.tsx`
- Modify: `ui/src/__tests__/actions.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `ui/src/__tests__/projectStatus.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { deployRunLabel } from "../pages/projectStatus";

describe("deployRunLabel", () => {
  it("returns empty when never run", () => {
    expect(deployRunLabel(undefined)).toBe("");
    expect(deployRunLabel({})).toBe("");
  });
  it("shows running", () => {
    expect(deployRunLabel({ state: "running" })).toBe("deploy: running…");
  });
  it("shows ok", () => {
    expect(deployRunLabel({ state: "ok" })).toMatch(/^deploy: ok/);
  });
  it("shows failed with error", () => {
    expect(deployRunLabel({ state: "failed", error: "boom" })).toBe("deploy: failed: boom");
  });
});
```

Append to `ui/src/__tests__/actions.test.ts` (inside the existing `describe`):
```ts
  it("deploy resolves on 202 (started)", async () => {
    const f = mockFetch(true, { status: "started" });
    vi.stubGlobal("fetch", f);
    await expect(deploy("gnathology")).resolves.toBeUndefined();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ui && npx vitest run src/__tests__/projectStatus.test.ts src/__tests__/actions.test.ts`
Expected: FAIL — `deployRunLabel` is not exported (projectStatus suite). The 202 actions test passes already (mockFetch ok:true → `post` resolves), which is fine — it's a guard test.

- [ ] **Step 3: Add DeployRun type + deployRunLabel**

In `ui/src/pages/projectStatus.ts`, add the interface (after the `Deploy` interface) and field, and the label helper:
```ts
export interface DeployRun { state?: string; started_at?: string; finished_at?: string; error?: string }
```
Add `deploy_run?: DeployRun;` to the `ProjectStatus` interface (after `agents?: Agent[];`).

Append the helper:
```ts
export function deployRunLabel(r?: DeployRun): string {
  if (!r || !r.state) return "";
  if (r.state === "running") return "deploy: running…";
  if (r.state === "ok") {
    const t = r.finished_at ? " " + new Date(r.finished_at).toLocaleTimeString() : "";
    return `deploy: ok${t}`;
  }
  if (r.state === "failed") return `deploy: failed${r.error ? ": " + r.error : ""}`;
  return "";
}
```

- [ ] **Step 4: Wire into Projects.tsx**

In `ui/src/pages/Projects.tsx`:

(a) Update the import:
```tsx
import { ciLabel, deployLabel, deployRunLabel, type ProjectStatus } from './projectStatus';
```

(b) After the existing 30s-interval `useEffect`, add a faster poll while any deploy is running:
```tsx
  const anyRunning = (projects ?? []).some((p) => p.deploy_run?.state === 'running');
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(fetchProjects, 4000);
    return () => clearInterval(id);
  }, [anyRunning, fetchProjects]);
```

(c) In `confirmRun`, after `await pending.run();` (and before/after `setPending(null)`), trigger an immediate refresh so the card flips to running quickly:
```tsx
      await pending.run();
      setPending(null);
      fetchProjects();
```

(d) In the status grid (inside the `<div style={{ marginTop: 10, ... }}>` block, after the `audit:` line), add a deploy-run line that only renders when there is a label:
```tsx
              {deployRunLabel(p.deploy_run) && (
                <div style={{ color: p.deploy_run?.state === 'failed' ? '#c0392b' : 'var(--text-secondary)' }}>
                  {deployRunLabel(p.deploy_run)}
                </div>
              )}
```

(e) Disable the deploy button while running — change the deploy button to:
```tsx
              <button className="action-row" disabled={p.deploy_run?.state === 'running'} onClick={() => setPending({
                label: `deploy ${p.name}`,
                run: () => deploy(p.name),
              })}>deploy</button>
```

- [ ] **Step 5: Run tests + build**

Run: `cd ui && npx vitest run`
Expected: all UI tests PASS (existing + new projectStatus + actions 202).

Run: `npm --prefix ui run build`
Expected: build succeeds (no TypeScript errors).

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Alex/10_Projects/praktor
git add ui/src/pages/projectStatus.ts ui/src/pages/Projects.tsx ui/src/__tests__/projectStatus.test.ts ui/src/__tests__/actions.test.ts
git commit -m "feat(ui): async deploy status label, button guard, fast-poll"
```

---

## Task 6: Full verification + PR

- [ ] **Step 1: Full backend gate**

Run: `<GOTEST>` with command `gofmt -l internal/web/ ; go vet ./internal/web/ && go test ./internal/web/ && go build ./...`
Expected: gofmt prints nothing (clean); vet/test/build all green.

- [ ] **Step 2: Full UI gate**

Run: `cd ui && npx vitest run && cd .. && npm --prefix ui run build`
Expected: all tests pass; build clean.

- [ ] **Step 3: Push + open PR**

```bash
cd /c/Users/Alex/10_Projects/praktor
git push origin feature/f4-async-deploy
gh pr create --repo Meta-Psy/praktor --base main --head feature/f4-async-deploy \
  --title "F.4: async deploy from Mission Control" \
  --body "Non-blocking MC deploy: 409 guard, background goroutine, 202 immediately, live deploy_run status in /api/projects, UI label + button guard + fast-poll. Spec/plan in _specs/2026-06-09-phase-f-stage-f4-async-deploy-{design,plan}.md."
```

- [ ] **Step 4: [ALEX] deploy gate (after merge)**

On `own_landing`: `cd ~/praktor && git pull --ff-only origin main && docker build -t praktor:f3 . && docker compose up -d` (normal build — Go recompiles, UI rebuilds; the bundle hash changes since Projects.tsx changed). Then from the phone (incognito or after clearing the PWA service worker): click Deploy on gnathology → button returns immediately, card shows `deploy: running…`, then `deploy: ok HH:MM`; no browser 502. A second click while running → "deploy already in progress".

---

## Self-review notes

- **Spec coverage:** non-blocking deploy (Task 3), 409 guard (Task 3), in-memory status (Task 1), status in /api/projects live-not-cached (Task 4), UI label + disable + fast-poll (Task 5), restart limitation (documented; no persistence — matches spec). ✓
- **Type consistency:** `deployRun` (Go) ↔ `DeployRun`/`deploy_run` (TS) field names match the JSON tags (`state`/`started_at`/`finished_at`/`error`). `tryStart`/`finish`/`snapshot` used consistently across Tasks 1/3/4. ✓
- **No placeholders:** every code step shows full code; every run step shows the command + expected result. ✓
