# F.3 approve-из-UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add approve / merge / deploy buttons to Mission Control so the full autonomous cycle can be driven from a phone via `mc.alexmetapsy.com`.

**Architecture:** Hybrid execution. GitHub actions (approve = issue comment, merge = PR merge, pdai deploy = `workflow_dispatch`) go through a Go GitHub write-client. gnathology deploy runs on the host via two one-shot Docker containers (`alpine/git` pull → `docker:cli` compose rebuild) over the already-mounted docker socket. Every action emits a Telegram audit line. All endpoints sit behind the existing single-password auth middleware.

**Tech Stack:** Go 1.26 (`net/http` std mux, `github.com/moby/moby/client` Docker SDK), React + TypeScript (Vite), Vitest.

**Spec:** `_specs/2026-06-08-phase-f-stage-f3-approve-from-ui-design.md`

**Test runner note (F.2 environment fact):** Go is NOT installed natively. Run Go tests via Docker:
`docker run --rm -e GOTOOLCHAIN=auto -v "$PWD":/src -w /src golang:1.26rc1 go test ./...`
Node 22 is native: `cd ui && npm test`.

---

## File Structure

| File | Responsibility | New/Modify |
|---|---|---|
| `internal/config/config.go` | `ProjectDefinition` gains `DeployWorkflow`, `DeployHostDir`, `DeployComposeProject` | Modify |
| `internal/config/config_test.go` | parse-test for the 3 new fields | Modify |
| `internal/web/github_write.go` | GitHub write-client: `AddComment`, `MergePR`, `DispatchWorkflow` | Create |
| `internal/web/github_write_test.go` | httptest-mock tests for write-client | Create |
| `internal/web/audit_tg.go` | Telegram `sendMessage` audit helper | Create |
| `internal/web/audit_tg_test.go` | httptest-mock test for audit helper | Create |
| `internal/web/host_deploy.go` | `oneShotRunner` interface + `GnathologyDeployer.Deploy` (testable logic) | Create |
| `internal/web/host_deploy_test.go` | fake-runner tests for `Deploy` | Create |
| `internal/web/oneshot_docker.go` | real `oneShotRunner` over Docker SDK (not unit-tested) | Create |
| `internal/web/actions.go` | 3 handlers (approve/merge/deploy) + audit wiring | Create |
| `internal/web/actions_test.go` | handler tests with fake deps | Create |
| `internal/web/server.go` | Server fields (`ghWrite`, `tg`, `oneShot`) + `NewServer` param `tg config.TelegramConfig` + route registration | Modify |
| `cmd/praktor/main.go:166` | pass `cfg.Telegram` to `NewServer` | Modify |
| `ui/src/pages/Projects.tsx` | action buttons + confirm modal | Modify |
| `ui/src/pages/actions.ts` | API client for the 3 actions | Create |
| `ui/src/__tests__/actions.test.ts` | client + modal-state tests | Create |

---

## Task 1: ProjectDefinition deploy fields

**Files:**
- Modify: `internal/config/config.go` (ProjectDefinition struct, ~line 27)
- Test: `internal/config/config_test.go` (~line 253)

- [ ] **Step 1: Write the failing test**

Add to `internal/config/config_test.go` inside the existing projects-parsing test fixture (the `pdai:`/`gnathology:` YAML block near line 253) the new keys, and new assertions after the existing `Health` assertion (~line 283):

```go
// in the YAML fixture string, under pdai:
//   deploy_workflow: deploy.yml
// under gnathology:
//   deploy_host_dir: /opt/apps/gnathology-bot/deploy
//   deploy_compose_project: gnathology-bot

if cfg.Projects["pdai"].DeployWorkflow != "deploy.yml" {
	t.Errorf("pdai deploy_workflow = %q", cfg.Projects["pdai"].DeployWorkflow)
}
if cfg.Projects["gnathology"].DeployHostDir != "/opt/apps/gnathology-bot/deploy" {
	t.Errorf("gnathology deploy_host_dir = %q", cfg.Projects["gnathology"].DeployHostDir)
}
if cfg.Projects["gnathology"].DeployComposeProject != "gnathology-bot" {
	t.Errorf("gnathology deploy_compose_project = %q", cfg.Projects["gnathology"].DeployComposeProject)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker run --rm -e GOTOOLCHAIN=auto -v "$PWD":/src -w /src golang:1.26rc1 go test ./internal/config/ -run TestProjects -v`
Expected: FAIL — `cfg.Projects[...].DeployWorkflow` undefined (struct field does not exist).

- [ ] **Step 3: Add the fields**

In `internal/config/config.go`, extend `ProjectDefinition`:

```go
// ProjectDefinition is one project surfaced in the Mission Control roll-up.
type ProjectDefinition struct {
	Repo      string   `yaml:"repo"`       // owner/name on GitHub
	Agents    []string `yaml:"agents"`     // Praktor agent ids associated with this project
	DeployURL string   `yaml:"deploy_url"` // public URL to probe (HTTP 200 = healthy)
	Health    string   `yaml:"health"`     // internal health URL (praktor-net), used if DeployURL empty

	// Deploy mechanism (F.3). Exactly one of DeployWorkflow / DeployHostDir is used.
	DeployWorkflow       string `yaml:"deploy_workflow"`        // GitHub Actions workflow file to dispatch (e.g. deploy.yml)
	DeployHostDir        string `yaml:"deploy_host_dir"`        // host path of a git working copy to pull+rebuild
	DeployComposeProject string `yaml:"deploy_compose_project"` // compose -p name (must match existing stack)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker run --rm -e GOTOOLCHAIN=auto -v "$PWD":/src -w /src golang:1.26rc1 go test ./internal/config/ -run TestProjects -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/config/config.go internal/config/config_test.go
git commit -m "feat(config): per-project deploy mechanism fields (F.3)"
```

---

## Task 2: GitHub write-client

**Files:**
- Create: `internal/web/github_write.go`
- Test: `internal/web/github_write_test.go`

- [ ] **Step 1: Write the failing test**

`internal/web/github_write_test.go` (mirrors `github_test.go` style):

```go
package web

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAddComment(t *testing.T) {
	var gotPath, gotAuth, gotBody string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":1}`))
	}))
	defer ts.Close()

	c := &WriteGitHubClient{Token: "tok", BaseURL: ts.URL, HTTP: ts.Client()}
	if err := c.AddComment(context.Background(), "o/r", 7, "/approve all"); err != nil {
		t.Fatalf("AddComment: %v", err)
	}
	if gotPath != "/repos/o/r/issues/7/comments" {
		t.Errorf("path = %q", gotPath)
	}
	if gotAuth != "Bearer tok" {
		t.Errorf("auth = %q", gotAuth)
	}
	var parsed map[string]string
	_ = json.Unmarshal([]byte(gotBody), &parsed)
	if parsed["body"] != "/approve all" {
		t.Errorf("body = %q", gotBody)
	}
}

func TestMergePR(t *testing.T) {
	var gotPath, gotMethod string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotMethod = r.URL.Path, r.Method
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"merged":true}`))
	}))
	defer ts.Close()

	c := &WriteGitHubClient{Token: "tok", BaseURL: ts.URL, HTTP: ts.Client()}
	if err := c.MergePR(context.Background(), "o/r", 12, "squash"); err != nil {
		t.Fatalf("MergePR: %v", err)
	}
	if gotMethod != http.MethodPut || gotPath != "/repos/o/r/pulls/12/merge" {
		t.Errorf("%s %s", gotMethod, gotPath)
	}
}

func TestMergePRConflict(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusMethodNotAllowed)
		_, _ = w.Write([]byte(`{"message":"Pull Request is not mergeable"}`))
	}))
	defer ts.Close()

	c := &WriteGitHubClient{Token: "tok", BaseURL: ts.URL, HTTP: ts.Client()}
	err := c.MergePR(context.Background(), "o/r", 12, "squash")
	if err == nil || !strings.Contains(err.Error(), "not mergeable") {
		t.Fatalf("want mergeable error, got %v", err)
	}
}

func TestDispatchWorkflow(t *testing.T) {
	var gotPath, gotBody string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer ts.Close()

	c := &WriteGitHubClient{Token: "tok", BaseURL: ts.URL, HTTP: ts.Client()}
	if err := c.DispatchWorkflow(context.Background(), "o/r", "deploy.yml", "main"); err != nil {
		t.Fatalf("DispatchWorkflow: %v", err)
	}
	if gotPath != "/repos/o/r/actions/workflows/deploy.yml/dispatches" {
		t.Errorf("path = %q", gotPath)
	}
	if !strings.Contains(gotBody, `"ref":"main"`) {
		t.Errorf("body = %q", gotBody)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker run --rm -e GOTOOLCHAIN=auto -v "$PWD":/src -w /src golang:1.26rc1 go test ./internal/web/ -run 'TestAddComment|TestMergePR|TestDispatchWorkflow' -v`
Expected: FAIL — `WriteGitHubClient` undefined.

- [ ] **Step 3: Write the implementation**

`internal/web/github_write.go`:

```go
package web

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// WriteGitHubClient performs the small set of write actions Mission Control needs.
// Token comes from GITHUB_WRITE_TOKEN (separate from the read-only roll-up token).
type WriteGitHubClient struct {
	Token   string
	BaseURL string // default https://api.github.com
	HTTP    *http.Client
}

func (c *WriteGitHubClient) base() string {
	if c.BaseURL != "" {
		return c.BaseURL
	}
	return "https://api.github.com"
}

func (c *WriteGitHubClient) httpClient() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return &http.Client{Timeout: 15 * time.Second}
}

// do sends a request, treats any status outside wantStatus as an error
// (surfacing the GitHub "message" field when present).
func (c *WriteGitHubClient) do(ctx context.Context, method, path string, body any, wantStatus int) error {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base()+path, rdr)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Content-Type", "application/json")
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	resp, err := c.httpClient().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != wantStatus {
		raw, _ := io.ReadAll(resp.Body)
		var ge struct {
			Message string `json:"message"`
		}
		_ = json.Unmarshal(raw, &ge)
		if ge.Message != "" {
			return fmt.Errorf("github %s %s: %s (%s)", method, path, ge.Message, resp.Status)
		}
		return fmt.Errorf("github %s %s: %s", method, path, resp.Status)
	}
	return nil
}

// AddComment posts a comment on an issue (used to trigger approve-handler.yml).
func (c *WriteGitHubClient) AddComment(ctx context.Context, repo string, issue int, body string) error {
	return c.do(ctx, http.MethodPost,
		fmt.Sprintf("/repos/%s/issues/%d/comments", repo, issue),
		map[string]string{"body": body}, http.StatusCreated)
}

// MergePR merges a pull request. method is "merge"|"squash"|"rebase".
func (c *WriteGitHubClient) MergePR(ctx context.Context, repo string, number int, method string) error {
	return c.do(ctx, http.MethodPut,
		fmt.Sprintf("/repos/%s/pulls/%d/merge", repo, number),
		map[string]string{"merge_method": method}, http.StatusOK)
}

// DispatchWorkflow triggers a workflow_dispatch on the given workflow file.
func (c *WriteGitHubClient) DispatchWorkflow(ctx context.Context, repo, workflow, ref string) error {
	return c.do(ctx, http.MethodPost,
		fmt.Sprintf("/repos/%s/actions/workflows/%s/dispatches", repo, workflow),
		map[string]string{"ref": ref}, http.StatusNoContent)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker run --rm -e GOTOOLCHAIN=auto -v "$PWD":/src -w /src golang:1.26rc1 go test ./internal/web/ -run 'TestAddComment|TestMergePR|TestDispatchWorkflow' -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add internal/web/github_write.go internal/web/github_write_test.go
git commit -m "feat(web): GitHub write-client (comment/merge/dispatch) for F.3"
```

---

## Task 3: Telegram audit helper

**Files:**
- Create: `internal/web/audit_tg.go`
- Test: `internal/web/audit_tg_test.go`

- [ ] **Step 1: Write the failing test**

`internal/web/audit_tg_test.go`:

```go
package web

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTGAuditNotify(t *testing.T) {
	var gotPath, gotBody string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer ts.Close()

	a := &tgAuditor{Token: "BOT:tok", ChatID: 71353121, BaseURL: ts.URL, HTTP: ts.Client()}
	a.Notify(context.Background(), "✅ MC: merge o/r#12")

	if !strings.HasSuffix(gotPath, "/botBOT:tok/sendMessage") {
		t.Errorf("path = %q", gotPath)
	}
	var parsed struct {
		ChatID int64  `json:"chat_id"`
		Text   string `json:"text"`
	}
	_ = json.Unmarshal([]byte(gotBody), &parsed)
	if parsed.ChatID != 71353121 || !strings.Contains(parsed.Text, "merge o/r#12") {
		t.Errorf("body = %q", gotBody)
	}
}

// Notify must never panic or block forever when TG is unreachable / unconfigured.
func TestTGAuditDisabledNoop(t *testing.T) {
	a := &tgAuditor{} // no token
	a.Notify(context.Background(), "anything")     // must not panic
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker run --rm -e GOTOOLCHAIN=auto -v "$PWD":/src -w /src golang:1.26rc1 go test ./internal/web/ -run TestTGAudit -v`
Expected: FAIL — `tgAuditor` undefined.

- [ ] **Step 3: Write the implementation**

`internal/web/audit_tg.go`:

```go
package web

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"
)

// auditor records a control-plane action out-of-band (so a leaked MC password
// surfaces as a visible side effect). Best-effort: failures are logged, not returned.
type auditor interface {
	Notify(ctx context.Context, text string)
}

// tgAuditor sends a Telegram message via the bot Token to ChatID.
type tgAuditor struct {
	Token   string
	ChatID  int64
	BaseURL string // default https://api.telegram.org
	HTTP    *http.Client
}

func (a *tgAuditor) Notify(ctx context.Context, text string) {
	if a == nil || a.Token == "" || a.ChatID == 0 {
		return // auditing disabled
	}
	base := a.BaseURL
	if base == "" {
		base = "https://api.telegram.org"
	}
	hc := a.HTTP
	if hc == nil {
		hc = &http.Client{Timeout: 8 * time.Second}
	}
	body, _ := json.Marshal(map[string]any{"chat_id": a.ChatID, "text": text})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/bot%s/sendMessage", base, a.Token), bytes.NewReader(body))
	if err != nil {
		slog.Warn("tg audit build request", "err", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := hc.Do(req)
	if err != nil {
		slog.Warn("tg audit send", "err", err)
		return
	}
	_ = resp.Body.Close()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker run --rm -e GOTOOLCHAIN=auto -v "$PWD":/src -w /src golang:1.26rc1 go test ./internal/web/ -run TestTGAudit -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add internal/web/audit_tg.go internal/web/audit_tg_test.go
git commit -m "feat(web): Telegram audit helper for MC actions (F.3)"
```

---

## Task 4: gnathology host deployer

**Files:**
- Create: `internal/web/host_deploy.go` (testable logic + interface)
- Create: `internal/web/oneshot_docker.go` (real Docker SDK runner — not unit-tested)
- Test: `internal/web/host_deploy_test.go`

- [ ] **Step 1: Write the failing test**

`internal/web/host_deploy_test.go`:

```go
package web

import (
	"context"
	"strings"
	"testing"
)

type fakeRunner struct {
	calls []oneShotSpec
	exit  []int    // exit code to return per call
	errs  []error  // error to return per call
	logs  []string // logs to return per call
}

func (f *fakeRunner) Run(_ context.Context, spec oneShotSpec) (string, int, error) {
	i := len(f.calls)
	f.calls = append(f.calls, spec)
	var code int
	var err error
	var log string
	if i < len(f.exit) {
		code = f.exit[i]
	}
	if i < len(f.errs) {
		err = f.errs[i]
	}
	if i < len(f.logs) {
		log = f.logs[i]
	}
	return log, code, err
}

func newDeployer(r oneShotRunner) *GnathologyDeployer {
	return &GnathologyDeployer{
		Runner:      r,
		HostDir:     "/opt/apps/gnathology-bot/deploy",
		ComposeProj: "gnathology-bot",
		Token:       "wtok",
	}
}

func TestDeploySuccess(t *testing.T) {
	r := &fakeRunner{exit: []int{0, 0}}
	if err := newDeployer(r).Deploy(context.Background()); err != nil {
		t.Fatalf("Deploy: %v", err)
	}
	if len(r.calls) != 2 {
		t.Fatalf("want 2 runs, got %d", len(r.calls))
	}
	// 1: git pull — alpine/git, token in env, host dir bound, no docker socket.
	pull := r.calls[0]
	if pull.Image != defaultGitImage {
		t.Errorf("pull image = %q", pull.Image)
	}
	if !contains(pull.Env, "GIT_TOKEN=wtok") {
		t.Errorf("pull env = %v", pull.Env)
	}
	if !contains(pull.Binds, "/opt/apps/gnathology-bot/deploy:/repo") {
		t.Errorf("pull binds = %v", pull.Binds)
	}
	if contains(pull.Binds, "/var/run/docker.sock:/var/run/docker.sock") {
		t.Errorf("pull must NOT mount docker socket")
	}
	// 2: compose — docker:cli, socket bound, project pinned to gnathology-bot.
	comp := r.calls[1]
	if comp.Image != defaultComposeImage {
		t.Errorf("compose image = %q", comp.Image)
	}
	if !contains(comp.Binds, "/var/run/docker.sock:/var/run/docker.sock") {
		t.Errorf("compose must mount docker socket: %v", comp.Binds)
	}
	joined := strings.Join(comp.Cmd, " ")
	if !strings.Contains(joined, "-p gnathology-bot") {
		t.Errorf("compose must pin project: %q", joined)
	}
	if !strings.Contains(joined, "up -d --build") {
		t.Errorf("compose cmd = %q", joined)
	}
}

func TestDeployPullFailsStopsBeforeCompose(t *testing.T) {
	r := &fakeRunner{exit: []int{1, 0}, logs: []string{"merge conflict", ""}}
	err := newDeployer(r).Deploy(context.Background())
	if err == nil || !strings.Contains(err.Error(), "merge conflict") {
		t.Fatalf("want pull error with log tail, got %v", err)
	}
	if len(r.calls) != 1 {
		t.Fatalf("compose must not run after failed pull, got %d calls", len(r.calls))
	}
}

func TestDeployComposeFails(t *testing.T) {
	r := &fakeRunner{exit: []int{0, 2}, logs: []string{"", "build error: no space left"}}
	err := newDeployer(r).Deploy(context.Background())
	if err == nil || !strings.Contains(err.Error(), "no space left") {
		t.Fatalf("want compose error with log tail, got %v", err)
	}
}

func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker run --rm -e GOTOOLCHAIN=auto -v "$PWD":/src -w /src golang:1.26rc1 go test ./internal/web/ -run TestDeploy -v`
Expected: FAIL — `oneShotSpec`/`oneShotRunner`/`GnathologyDeployer` undefined.

- [ ] **Step 3: Write the testable logic**

`internal/web/host_deploy.go`:

```go
package web

import (
	"context"
	"fmt"
)

const (
	defaultGitImage     = "alpine/git"
	defaultComposeImage = "docker:cli"
	composeFile         = "/repo/compose.yml"
	dockerSockBind      = "/var/run/docker.sock:/var/run/docker.sock"
)

// oneShotSpec describes a single throwaway container run.
type oneShotSpec struct {
	Image string
	Binds []string
	Env   []string
	Cmd   []string
}

// oneShotRunner runs a container to completion and returns combined logs + exit code.
type oneShotRunner interface {
	Run(ctx context.Context, spec oneShotSpec) (logs string, exitCode int, err error)
}

// GnathologyDeployer rebuilds the gnathology bot on the host: pull latest main,
// then compose up --build. The deploy dir must already be a git working copy
// (one-time [ALEX] setup) with .env and data/ gitignored.
type GnathologyDeployer struct {
	Runner      oneShotRunner
	HostDir     string // e.g. /opt/apps/gnathology-bot/deploy
	ComposeProj string // e.g. gnathology-bot (must match existing stack)
	Token       string // GitHub write PAT for the private pull
}

func (d *GnathologyDeployer) Deploy(ctx context.Context) error {
	repoBind := d.HostDir + ":/repo"

	// 1) git pull --ff-only (token via env, never in argv).
	logs, code, err := d.Runner.Run(ctx, oneShotSpec{
		Image: defaultGitImage,
		Binds: []string{repoBind},
		Env:   []string{"GIT_TOKEN=" + d.Token},
		Cmd: []string{"sh", "-c",
			`git -c http.extraheader="AUTHORIZATION: bearer $GIT_TOKEN" -C /repo pull --ff-only`},
	})
	if err != nil {
		return fmt.Errorf("git pull: %w", err)
	}
	if code != 0 {
		return fmt.Errorf("git pull failed (exit %d): %s", code, tail(logs))
	}

	// 2) compose up -d --build, project pinned so it replaces the existing stack
	//    (not creating a second one under the bind-mount basename).
	logs, code, err = d.Runner.Run(ctx, oneShotSpec{
		Image: defaultComposeImage,
		Binds: []string{repoBind, dockerSockBind},
		Cmd:   []string{"docker", "compose", "-p", d.ComposeProj, "-f", composeFile, "up", "-d", "--build"},
	})
	if err != nil {
		return fmt.Errorf("compose up: %w", err)
	}
	if code != 0 {
		return fmt.Errorf("compose up failed (exit %d): %s", code, tail(logs))
	}
	return nil
}

// tail returns the last ~600 bytes of s, for surfacing failure logs without flooding TG/UI.
func tail(s string) string {
	const max = 600
	if len(s) <= max {
		return s
	}
	return "…" + s[len(s)-max:]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker run --rm -e GOTOOLCHAIN=auto -v "$PWD":/src -w /src golang:1.26rc1 go test ./internal/web/ -run TestDeploy -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the real Docker runner (no unit test — integration only)**

`internal/web/oneshot_docker.go`:

```go
package web

import (
	"context"
	"fmt"
	"io"
	"time"

	"github.com/moby/moby/api/pkg/stdcopy"
	dockercontainer "github.com/moby/moby/api/types/container"
	"github.com/moby/moby/client"
)

// dockerOneShot is the production oneShotRunner: create → start → wait → logs → remove.
type dockerOneShot struct {
	docker *client.Client
}

func newDockerOneShot() (*dockerOneShot, error) {
	c, err := client.New(client.FromEnv)
	if err != nil {
		return nil, fmt.Errorf("docker client: %w", err)
	}
	return &dockerOneShot{docker: c}, nil
}

func (d *dockerOneShot) Run(ctx context.Context, spec oneShotSpec) (string, int, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()

	name := fmt.Sprintf("praktor-deploy-%d", time.Now().UnixNano())
	resp, err := d.docker.ContainerCreate(ctx, client.ContainerCreateOptions{
		Config: &dockercontainer.Config{
			Image: spec.Image,
			Cmd:   spec.Cmd,
			Env:   spec.Env,
		},
		HostConfig: &dockercontainer.HostConfig{Binds: spec.Binds},
		Name:       name,
	})
	if err != nil {
		return "", 0, fmt.Errorf("create %s: %w", spec.Image, err)
	}
	defer func() {
		_, _ = d.docker.ContainerRemove(context.Background(), resp.ID, client.ContainerRemoveOptions{Force: true})
	}()

	if err := d.docker.ContainerStart(ctx, resp.ID, client.ContainerStartOptions{}); err != nil {
		return "", 0, fmt.Errorf("start: %w", err)
	}

	waitCh, errCh := d.docker.ContainerWait(ctx, resp.ID, dockercontainer.WaitConditionNotRunning)
	var exit int
	select {
	case err := <-errCh:
		if err != nil {
			return "", 0, fmt.Errorf("wait: %w", err)
		}
	case st := <-waitCh:
		exit = int(st.StatusCode)
	}

	logs := ""
	if rc, err := d.docker.ContainerLogs(ctx, resp.ID, client.ContainerLogsOptions{ShowStdout: true, ShowStderr: true}); err == nil {
		var buf writeBuf
		_, _ = stdcopy.StdCopy(&buf, &buf, rc)
		_ = rc.Close()
		logs = buf.String()
	}
	return logs, exit, nil
}

// writeBuf is a tiny io.Writer accumulator (avoids importing bytes just for this).
type writeBuf struct{ b []byte }

func (w *writeBuf) Write(p []byte) (int, error) { w.b = append(w.b, p...); return len(p), nil }
func (w *writeBuf) String() string              { return string(w.b) }

var _ io.Writer = (*writeBuf)(nil)
```

> **Implementer note:** verify the exact moby SDK option/type names against the patterns already in `internal/container/manager.go` (same import paths: `client.ContainerCreateOptions`, `dockercontainer.HostConfig`, `stdcopy.StdCopy`, `dockercontainer.WaitConditionNotRunning`). Adjust names to match the version in `go.mod` if they differ — `manager.go` is the source of truth for this SDK's surface.

- [ ] **Step 6: Verify the package compiles**

Run: `docker run --rm -e GOTOOLCHAIN=auto -v "$PWD":/src -w /src golang:1.26rc1 go build ./internal/web/`
Expected: no output (success). Fix SDK name mismatches against `manager.go` if the build fails.

- [ ] **Step 7: Commit**

```bash
git add internal/web/host_deploy.go internal/web/oneshot_docker.go internal/web/host_deploy_test.go
git commit -m "feat(web): host-docker gnathology deployer (pull+compose) for F.3"
```

---

## Task 5: Action handlers + server wiring

**Files:**
- Create: `internal/web/actions.go`
- Test: `internal/web/actions_test.go`
- Modify: `internal/web/server.go` (Server fields, `NewServer` signature, `registerAPI`)
- Modify: `cmd/praktor/main.go:166`

- [ ] **Step 1: Write the failing test**

`internal/web/actions_test.go`:

```go
package web

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mtzanidakis/praktor/internal/config"
)

type fakeGHWriter struct {
	comment string
	merged  int
	dispatched string
	err     error
}

func (f *fakeGHWriter) AddComment(_ context.Context, repo string, issue int, body string) error {
	f.comment = body
	return f.err
}
func (f *fakeGHWriter) MergePR(_ context.Context, repo string, n int, method string) error {
	f.merged = n
	return f.err
}
func (f *fakeGHWriter) DispatchWorkflow(_ context.Context, repo, wf, ref string) error {
	f.dispatched = wf
	return f.err
}

type fakeAuditor struct{ last string }

func (f *fakeAuditor) Notify(_ context.Context, text string) { f.last = text }

func testServer(gh ghWriter, aud auditor, run oneShotRunner) *Server {
	return &Server{
		ghWrite: gh,
		tg:      aud,
		oneShot: run,
		projects: map[string]config.ProjectDefinition{
			"pdai":       {Repo: "Meta-Psy/pdai_calculator", DeployWorkflow: "deploy.yml"},
			"gnathology": {Repo: "Meta-Psy/gnathology-bot", DeployHostDir: "/opt/apps/gnathology-bot/deploy", DeployComposeProject: "gnathology-bot"},
		},
	}
}

func do(t *testing.T, s *Server, method, path, body string, h http.HandlerFunc) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.SetPathValue("key", strings.Split(strings.TrimPrefix(path, "/api/projects/"), "/")[0])
	rec := httptest.NewRecorder()
	h(rec, req)
	return rec
}

func TestHandleApprove(t *testing.T) {
	gh, aud := &fakeGHWriter{}, &fakeAuditor{}
	s := testServer(gh, aud, nil)
	rec := do(t, s, http.MethodPost, "/api/projects/pdai/approve", `{"tier":"all","issue":7}`, s.handleApprove)
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d (%s)", rec.Code, rec.Body)
	}
	if gh.comment != "/approve all" {
		t.Errorf("comment = %q", gh.comment)
	}
	if !strings.Contains(aud.last, "approve") {
		t.Errorf("audit not fired: %q", aud.last)
	}
}

func TestHandleApproveBadTier(t *testing.T) {
	gh := &fakeGHWriter{}
	s := testServer(gh, &fakeAuditor{}, nil)
	rec := do(t, s, http.MethodPost, "/api/projects/pdai/approve", `{"tier":"everything","issue":7}`, s.handleApprove)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rec.Code)
	}
	if gh.comment != "" {
		t.Errorf("must not comment on bad tier")
	}
}

func TestHandleApproveUnknownProject(t *testing.T) {
	s := testServer(&fakeGHWriter{}, &fakeAuditor{}, nil)
	rec := do(t, s, http.MethodPost, "/api/projects/nope/approve", `{"tier":"all","issue":7}`, s.handleApprove)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", rec.Code)
	}
}

func TestHandleDeployPdaiDispatches(t *testing.T) {
	gh, aud := &fakeGHWriter{}, &fakeAuditor{}
	s := testServer(gh, aud, nil)
	rec := do(t, s, http.MethodPost, "/api/projects/pdai/deploy", ``, s.handleDeploy)
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d (%s)", rec.Code, rec.Body)
	}
	if gh.dispatched != "deploy.yml" {
		t.Errorf("dispatched = %q", gh.dispatched)
	}
}

func TestHandleDeployGnathologyUsesRunner(t *testing.T) {
	gh, aud := &fakeGHWriter{}, &fakeAuditor{}
	run := &fakeRunner{exit: []int{0, 0}}
	s := testServer(gh, aud, run)
	rec := do(t, s, http.MethodPost, "/api/projects/gnathology/deploy", ``, s.handleDeploy)
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d (%s)", rec.Code, rec.Body)
	}
	if len(run.calls) != 2 {
		t.Errorf("want 2 container runs, got %d", len(run.calls))
	}
}

func TestHandleMergeError(t *testing.T) {
	gh := &fakeGHWriter{err: context.DeadlineExceeded}
	aud := &fakeAuditor{}
	s := testServer(gh, aud, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/projects/pdai/pulls/12/merge", nil)
	req.SetPathValue("key", "pdai")
	req.SetPathValue("n", "12")
	rec := httptest.NewRecorder()
	s.handleMerge(rec, req)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("want 502, got %d", rec.Code)
	}
	if !strings.Contains(aud.last, "❌") {
		t.Errorf("failed action must audit with failure marker: %q", aud.last)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker run --rm -e GOTOOLCHAIN=auto -v "$PWD":/src -w /src golang:1.26rc1 go test ./internal/web/ -run 'TestHandle' -v`
Expected: FAIL — `ghWriter`, `s.ghWrite`, `s.tg`, `s.oneShot`, `s.handleApprove`, etc. undefined.

- [ ] **Step 3: Add Server fields + interface**

In `internal/web/server.go`, add the write-side interface and fields to `Server` (after the `projects` field, ~line 56):

```go
// ghWriter is the write surface used by action handlers (mockable in tests).
type ghWriter interface {
	AddComment(ctx context.Context, repo string, issue int, body string) error
	MergePR(ctx context.Context, repo string, n int, method string) error
	DispatchWorkflow(ctx context.Context, repo, workflow, ref string) error
}
```

```go
	aggregator *Aggregator
	projCache  *projectsCache
	projects   map[string]config.ProjectDefinition

	ghWrite ghWriter      // GitHub write-client (F.3)
	tg      auditor       // Telegram audit (F.3)
	oneShot oneShotRunner // host one-shot container runner (F.3)
```

- [ ] **Step 4: Update NewServer to wire the new deps**

Change the `NewServer` signature to accept telegram config, and initialize the new fields inside the `if len(srv.projects) > 0` block. Replace the signature and that block in `internal/web/server.go`:

```go
func NewServer(s *store.Store, bus *natsbus.Bus, orch *agent.Orchestrator, reg *registry.Registry, rtr *router.Router, swarmCoord *swarm.Coordinator, cfg config.WebConfig, v *vault.Vault, version string, projects map[string]config.ProjectDefinition, tg config.TelegramConfig) *Server {
	srv := &Server{
		store:      s,
		bus:        bus,
		orch:       orch,
		registry:   reg,
		router:     rtr,
		swarmCoord: swarmCoord,
		vault:      v,
		hub:        NewHub(),
		cfg:        cfg,
		version:    version,
		startedAt:  time.Now(),
		sessions:   make(map[string]time.Time),
	}
	srv.projects = projects
	if len(srv.projects) > 0 {
		srv.aggregator = &Aggregator{
			gh:   &GitHubClient{Token: os.Getenv("GITHUB_READ_TOKEN")},
			http: &http.Client{Timeout: 8 * time.Second},
		}
		srv.projCache = &projectsCache{ttl: 30 * time.Second}
		srv.ghWrite = &WriteGitHubClient{Token: os.Getenv("GITHUB_WRITE_TOKEN")}
		srv.tg = &tgAuditor{Token: tg.Token, ChatID: tg.MainChatID}
		if r, err := newDockerOneShot(); err != nil {
			slog.Warn("host deploy disabled: docker client", "err", err)
		} else {
			srv.oneShot = r
		}
	}
	return srv
}
```

- [ ] **Step 5: Update the call site**

`cmd/praktor/main.go:166` — pass `cfg.Telegram`:

```go
		srv := web.NewServer(db, bus, orch, reg, rtr, swarmCoord, cfg.Web, v, version, cfg.Projects, cfg.Telegram)
```

- [ ] **Step 6: Write the handlers**

`internal/web/actions.go`:

```go
package web

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"
)

// audit emits a Telegram line for a control-plane action; ok=false prefixes ❌.
func (s *Server) audit(ctx context.Context, ok bool, detail string) {
	if s.tg == nil {
		return
	}
	mark := "✅"
	if !ok {
		mark = "❌"
	}
	s.tg.Notify(ctx, fmt.Sprintf("%s MC: %s", mark, detail))
}

func (s *Server) handleApprove(w http.ResponseWriter, r *http.Request) {
	def, ok := s.projects[r.PathValue("key")]
	if !ok {
		jsonError(w, "unknown project", http.StatusNotFound)
		return
	}
	var body struct {
		Tier  string `json:"tier"`
		Issue int    `json:"issue"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if body.Tier != "trivial" && body.Tier != "all" {
		jsonError(w, `tier must be "trivial" or "all"`, http.StatusBadRequest)
		return
	}
	if body.Issue <= 0 {
		jsonError(w, "issue must be a positive number", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	detail := fmt.Sprintf("approve %s on %s#%d", body.Tier, def.Repo, body.Issue)
	err := s.ghWrite.AddComment(ctx, def.Repo, body.Issue, "/approve "+body.Tier)
	if err != nil {
		s.audit(ctx, false, detail+": "+err.Error())
		jsonError(w, err.Error(), http.StatusBadGateway)
		return
	}
	s.audit(ctx, true, detail)
	jsonResponse(w, map[string]string{"status": "ok"})
}

func (s *Server) handleMerge(w http.ResponseWriter, r *http.Request) {
	def, ok := s.projects[r.PathValue("key")]
	if !ok {
		jsonError(w, "unknown project", http.StatusNotFound)
		return
	}
	n, err := strconv.Atoi(r.PathValue("n"))
	if err != nil || n <= 0 {
		jsonError(w, "invalid pr number", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	detail := fmt.Sprintf("merge %s#%d", def.Repo, n)
	if err := s.ghWrite.MergePR(ctx, def.Repo, n, "squash"); err != nil {
		s.audit(ctx, false, detail+": "+err.Error())
		jsonError(w, err.Error(), http.StatusBadGateway)
		return
	}
	s.audit(ctx, true, detail)
	jsonResponse(w, map[string]string{"status": "ok"})
}

func (s *Server) handleDeploy(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	def, ok := s.projects[key]
	if !ok {
		jsonError(w, "unknown project", http.StatusNotFound)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Minute)
	defer cancel()

	switch {
	case def.DeployWorkflow != "":
		detail := fmt.Sprintf("deploy %s (dispatch %s)", key, def.DeployWorkflow)
		if err := s.ghWrite.DispatchWorkflow(ctx, def.Repo, def.DeployWorkflow, "main"); err != nil {
			s.audit(ctx, false, detail+": "+err.Error())
			jsonError(w, err.Error(), http.StatusBadGateway)
			return
		}
		s.audit(ctx, true, detail)
		jsonResponse(w, map[string]string{"status": "ok"})

	case def.DeployHostDir != "":
		if s.oneShot == nil {
			jsonError(w, "host deploy unavailable (no docker)", http.StatusServiceUnavailable)
			return
		}
		detail := fmt.Sprintf("deploy %s (host rebuild)", key)
		dep := &GnathologyDeployer{
			Runner:      s.oneShot,
			HostDir:     def.DeployHostDir,
			ComposeProj: def.DeployComposeProject,
			Token:       s.writeToken(),
		}
		if err := dep.Deploy(ctx); err != nil {
			s.audit(ctx, false, detail+": "+err.Error())
			jsonError(w, err.Error(), http.StatusBadGateway)
			return
		}
		s.audit(ctx, true, detail)
		jsonResponse(w, map[string]string{"status": "ok"})

	default:
		jsonError(w, "no deploy mechanism configured for project", http.StatusBadRequest)
	}
}

// writeToken exposes the write PAT to the host deployer (private pull).
func (s *Server) writeToken() string {
	if c, ok := s.ghWrite.(*WriteGitHubClient); ok {
		return c.Token
	}
	return ""
}
```

- [ ] **Step 7: Register the routes**

In `internal/web/api.go` `registerAPI`, after the `GET /api/projects` line (~line 74):

```go
	mux.HandleFunc("POST /api/projects/{key}/approve", s.handleApprove)
	mux.HandleFunc("POST /api/projects/{key}/pulls/{n}/merge", s.handleMerge)
	mux.HandleFunc("POST /api/projects/{key}/deploy", s.handleDeploy)
```

- [ ] **Step 8: Run tests + full build**

Run: `docker run --rm -e GOTOOLCHAIN=auto -v "$PWD":/src -w /src golang:1.26rc1 sh -c "go build ./... && go test ./internal/web/ ./internal/config/ -v"`
Expected: build clean; all web + config tests PASS (incl. F.2 tests still green).

- [ ] **Step 9: gofmt**

Run: `docker run --rm -e GOTOOLCHAIN=auto -v "$PWD":/src -w /src golang:1.26rc1 gofmt -l internal/web/ internal/config/ cmd/praktor/`
Expected: no output (all formatted). If files listed, run `gofmt -w` on them.

- [ ] **Step 10: Commit**

```bash
git add internal/web/actions.go internal/web/actions_test.go internal/web/server.go internal/web/api.go cmd/praktor/main.go
git commit -m "feat(web): approve/merge/deploy action endpoints + audit wiring (F.3)"
```

---

## Task 6: React UI — action buttons + confirm modal

**Files:**
- Create: `ui/src/pages/actions.ts` (API client)
- Test: `ui/src/__tests__/actions.test.ts`
- Modify: `ui/src/pages/Projects.tsx`

> Read `ui/src/pages/Projects.tsx` and `ui/src/pages/projectStatus.ts` first to match existing fetch/types conventions (the F.2 page already renders `prs`, `audit_issues`, `deploy`, `agents`).

- [ ] **Step 1: Write the failing test**

`ui/src/__tests__/actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { approve, mergePR, deploy } from "../pages/actions";

beforeEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(ok: boolean, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok,
    json: async () => body,
  } as Response);
}

describe("actions client", () => {
  it("approve posts tier + issue", async () => {
    const f = mockFetch(true, { status: "ok" });
    vi.stubGlobal("fetch", f);
    await approve("pdai", "all", 7);
    expect(f).toHaveBeenCalledWith(
      "/api/projects/pdai/approve",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ tier: "all", issue: 7 }),
      }),
    );
  });

  it("mergePR hits the pull merge path", async () => {
    const f = mockFetch(true, { status: "ok" });
    vi.stubGlobal("fetch", f);
    await mergePR("gnathology", 12);
    expect(f).toHaveBeenCalledWith(
      "/api/projects/gnathology/pulls/12/merge",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("deploy surfaces server error text", async () => {
    const f = mockFetch(false, { error: "compose up failed (exit 2): no space left" });
    vi.stubGlobal("fetch", f);
    await expect(deploy("gnathology")).rejects.toThrow(/no space left/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npm test -- actions`
Expected: FAIL — cannot import from `../pages/actions`.

- [ ] **Step 3: Write the API client**

`ui/src/pages/actions.ts`:

```ts
async function post(path: string, body?: unknown): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `request failed (${res.status})`);
  }
}

export function approve(
  key: string,
  tier: "trivial" | "all",
  issue: number,
): Promise<void> {
  return post(`/api/projects/${key}/approve`, { tier, issue });
}

export function mergePR(key: string, n: number): Promise<void> {
  return post(`/api/projects/${key}/pulls/${n}/merge`);
}

export function deploy(key: string): Promise<void> {
  return post(`/api/projects/${key}/deploy`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npm test -- actions`
Expected: PASS (3 tests)

- [ ] **Step 5: Wire buttons + confirm modal into Projects.tsx**

Add a minimal confirm-modal + action buttons. Insert near the top of the `Projects` component body:

```tsx
import { approve, mergePR, deploy } from "./actions";

// inside the component:
const [pending, setPending] = useState<null | { label: string; run: () => Promise<void> }>(null);
const [busy, setBusy] = useState(false);
const [err, setErr] = useState<string | null>(null);

async function confirmRun() {
  if (!pending) return;
  setBusy(true);
  setErr(null);
  try {
    await pending.run();
    setPending(null);
  } catch (e) {
    setErr(e instanceof Error ? e.message : String(e));
  } finally {
    setBusy(false);
  }
}
```

Render, per project `p` (key `p.name`), contextual buttons:

```tsx
{p.audit_issues?.map((iss) => (
  <div key={`appr-${iss.number}`} className="action-row">
    <span>audit #{iss.number}</span>
    <button onClick={() => setPending({
      label: `approve trivial on ${p.repo}#${iss.number}`,
      run: () => approve(p.name, "trivial", iss.number),
    })}>approve trivial</button>
    <button onClick={() => setPending({
      label: `approve ALL on ${p.repo}#${iss.number}`,
      run: () => approve(p.name, "all", iss.number),
    })}>approve all</button>
  </div>
))}

{p.prs?.map((pr) => (
  <div key={`pr-${pr.number}`} className="action-row">
    <span>PR #{pr.number} {pr.title}</span>
    <button onClick={() => setPending({
      label: `merge ${p.repo}#${pr.number}`,
      run: () => mergePR(p.name, pr.number),
    })}>merge</button>
  </div>
))}

<button onClick={() => setPending({
  label: `deploy ${p.name}`,
  run: () => deploy(p.name),
})}>deploy</button>
```

Confirm modal (rendered once at component root):

```tsx
{pending && (
  <div className="modal-backdrop" role="dialog" aria-modal="true">
    <div className="modal">
      <p>Подтвердить действие:</p>
      <strong>{pending.label}</strong>
      {err && <p className="error">{err}</p>}
      <div className="modal-actions">
        <button onClick={() => { setPending(null); setErr(null); }} disabled={busy}>Отмена</button>
        <button onClick={confirmRun} disabled={busy}>{busy ? "…" : "Подтвердить"}</button>
      </div>
    </div>
  </div>
)}
```

> Match `useState` import + existing `ProjectStatus` field names (`name`, `repo`, `prs`, `audit_issues`) from `projectStatus.ts`. Reuse existing CSS classes if the page already defines a modal; otherwise these class names are inert and styling can follow later.

- [ ] **Step 6: Run the full UI test + build**

Run: `cd ui && npm test && npm run build`
Expected: all tests PASS; Vite build succeeds (TS typecheck clean).

- [ ] **Step 7: Commit**

```bash
git add ui/src/pages/actions.ts ui/src/__tests__/actions.test.ts ui/src/pages/Projects.tsx
git commit -m "feat(ui): approve/merge/deploy buttons + confirm modal (F.3)"
```

---

## Task 7: Config sample, self-review, PR

**Files:**
- Modify: `config/praktor.yaml` (local sample — document the new deploy fields; server config is gitignored)

- [ ] **Step 1: Document deploy fields in the sample config**

In `config/praktor.yaml`, under the existing `projects:` block, add the deploy keys (sample/illustrative — the live server config is edited separately by Alex):

```yaml
projects:
  pdai:
    repo: Meta-Psy/pdai_calculator
    # ... existing keys ...
    deploy_workflow: deploy.yml
  gnathology:
    repo: Meta-Psy/gnathology-bot
    # ... existing keys ...
    deploy_host_dir: /opt/apps/gnathology-bot/deploy
    deploy_compose_project: gnathology-bot
```

- [ ] **Step 2: Full test sweep**

Run: `docker run --rm -e GOTOOLCHAIN=auto -v "$PWD":/src -w /src golang:1.26rc1 sh -c "go build ./... && go vet ./internal/web/... && go test ./..."`
Then: `cd ui && npm test && npm run build`
Expected: everything green.

- [ ] **Step 3: Commit + push**

```bash
git add config/praktor.yaml
git commit -m "docs(config): sample deploy fields for F.3 projects"
git push -u origin feature/f3-approve-from-ui
```

- [ ] **Step 4: Open PR (base main)**

```bash
gh pr create --repo Meta-Psy/praktor --base main --head feature/f3-approve-from-ui \
  --title "F.3: approve/merge/deploy from Mission Control" \
  --body "Implements F.3 (approve-из-UI). Adds approve/merge/deploy action endpoints + confirm modal + Telegram audit. Hybrid execution: GitHub write-client for approve/merge/pdai-dispatch; host-docker for gnathology rebuild. Token via GITHUB_WRITE_TOKEN env (not vault — Go server can't read named secrets). See _specs/2026-06-08-phase-f-stage-f3-approve-from-ui-design.md."
```

---

## [ALEX] Live gates (post-merge, prod — classifier blocks; Alex executes)

These are NOT plan tasks — they are the human gates after code review/merge:

1. **Create `GITHUB_WRITE_TOKEN`** — fine-grained PAT, both repos (`pdai_calculator` + `gnathology-bot`), scopes: `contents` + `pull_requests` + `issues` + `actions` : write → add to server `.env`.
2. **Convert gnathology deploy dir to a git working copy** — on own_landing: clone `Meta-Psy/gnathology-bot` into `/opt/apps/gnathology-bot/deploy` (or `git init` + remote) preserving `.env` + `data/`; add `.env` and `data/` to `.gitignore`. Verify `git -C … pull --ff-only` works. **Also confirm the compose file is named `compose.yml` at the repo root** (the deployer runs `docker compose -f /repo/compose.yml`); if it's `docker-compose.yml` or nested, adjust `composeFile` in `host_deploy.go` before the live gate.
   - *(Helper images `alpine/git` + `docker:cli` are auto-pulled by the deployer if absent — no manual pre-pull needed. Review fix `77a9293`.)*
3. **Rebuild `praktor:f2` image** with F.3 code + `docker restart praktor`.
4. **Add deploy fields to the server `praktor.yaml`** (`deploy_workflow` / `deploy_host_dir` + `deploy_compose_project`) — flow-style one-liner per F.2 lesson.
5. **Live tests from phone:** approve (audit issue), merge (a throwaway PR), deploy pdai (dispatch), deploy gnathology (host rebuild). Confirm TG audit line arrives for each.

---

## Self-Review

**Spec coverage:**
- approve/merge/deploy → Tasks 2 (client), 5 (handlers), 6 (UI) ✅
- single-password auth → reused (existing middleware, no change) ✅
- confirm modal → Task 6 ✅
- TG audit → Tasks 3 + 5 ✅
- hybrid execution (Go→API + host-docker) → Tasks 2 + 4 + 5 ✅
- deploy semantics (pdai dispatch / gnathology host) → Tasks 1 (config) + 5 (switch) ✅
- write-PAT from env (separate from read) → Task 5 wiring ✅
- testing (Go httptest, fake runner, React mock fetch) → every task ✅
- [ALEX] gates → documented, out of plan scope ✅
- out-of-scope (Path C, CF Access, rollback) → not in plan ✅

**Open spec questions resolved during planning:**
1. TG-audit wiring → `cfg.Telegram` threaded into `NewServer` (Task 5).
2. gnathology helper images → `alpine/git` + `docker:cli`, off-the-shelf (Task 4).
3. pdai deploy workflow → config-driven `deploy_workflow: deploy.yml` (Task 1), not hardcoded.

**Manifest tier-count parsing** dropped as YAGNI — `audit_issues` already in the F.2 aggregator gives the issue number; approve-handler computes eligibility. No `projects.go` change needed.

**Type consistency:** `ghWriter` interface (server.go) matches `WriteGitHubClient` methods (github_write.go) and `fakeGHWriter` (actions_test.go); `oneShotRunner`/`oneShotSpec` consistent across host_deploy.go, oneshot_docker.go, host_deploy_test.go, actions_test.go; `auditor.Notify` matches `tgAuditor` + `fakeAuditor`.
