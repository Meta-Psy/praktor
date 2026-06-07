# F.2 — MC cross-project observability roll-up — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only, phone-accessible "Projects" screen to the Praktor Mission Control that shows, for every project in the autonomous stack (pdai, gnathology), its open PRs / audit issues / latest CI / deploy health / agent liveness — at a glance.

**Architecture:** Extend the Praktor fork (`Meta-Psy/praktor`). New declarative `projects:` config section → `/api/projects` Go aggregator (GitHub read API + deploy probe + orchestrator liveness, dependency-injected for tests) → new read-only React `Projects` page. Exposed off-box via Cloudflare Tunnel. New code lives in NEW files to minimize fork divergence.

**Tech Stack:** Go 1.x (stdlib `net/http`, `gopkg.in/yaml.v3`, stdlib `testing`/`httptest`), React + TypeScript + Vite + Vitest, Cloudflare Tunnel (`cloudflared`).

**Design:** `_specs/2026-06-07-phase-f-stage-f2-mc-observability-rollup-design.md`. **Phase memory:** `project_claude_optimization`.

**Conventions discovered (use verbatim):**
- Web handlers register in `internal/web/api.go` `registerAPI(mux)`; respond via `jsonResponse(w, data)` / `jsonError(w, msg, status)`.
- Config: add field to `config.Config`, parsed automatically by `yaml.Unmarshal` in `config.Load()`.
- Running agents: `s.orch.ListRunning(ctx) ([]container.ContainerInfo, error)`; `ContainerInfo{ID, AgentID, Name, Status, StartedAt, SessionID}`.
- React page = `ui/src/pages/X.tsx`, fetched via `fetch('/api/...')`; register in `ui/src/App.tsx` `navItems` + `<Routes>`.
- Server gets its GitHub token from **env `GITHUB_READ_TOKEN`** (vault exposes only Encrypt/Decrypt → reading a named secret from the server is out of scope; env is the chosen source per design §2).

**Commit discipline:** small commits per task; branch `feature/f2-mc-rollup` (already created, holds the design+plan).

**Build/test commands:**
- Go: `cd C:/Users/Alex/10_Projects/praktor && go test ./internal/...`
- UI: `cd ui && npm test` (vitest), `npm run build`

---

## STAGE 1 — Config + Aggregator + Endpoint (Go, TDD)

### Task 1: `projects:` config model

**Files:**
- Modify: `internal/config/config.go` (add `Projects` field to `Config`, add `ProjectDefinition` type)
- Test: `internal/config/config_test.go` (append)

- [ ] **Step 1: Write the failing test**

Append to `internal/config/config_test.go`:

```go
func TestProjectsParse(t *testing.T) {
	yaml := `
projects:
  pdai:
    repo: Meta-Psy/pdai_calculator
    agents: [coder, notifier]
    deploy_url: https://skinlabpro.uz
  gnathology:
    repo: Meta-Psy/gnathology-bot
    agents: [gnatho-coder]
    health: http://gnathology-bot:8099/health
`
	dir := t.TempDir()
	path := filepath.Join(dir, "praktor.yaml")
	if err := os.WriteFile(path, []byte(yaml), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PRAKTOR_CONFIG", path)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(cfg.Projects) != 2 {
		t.Fatalf("expected 2 projects, got %d", len(cfg.Projects))
	}
	p := cfg.Projects["pdai"]
	if p.Repo != "Meta-Psy/pdai_calculator" {
		t.Errorf("pdai repo = %q", p.Repo)
	}
	if p.DeployURL != "https://skinlabpro.uz" {
		t.Errorf("pdai deploy_url = %q", p.DeployURL)
	}
	if len(p.Agents) != 2 || p.Agents[0] != "coder" {
		t.Errorf("pdai agents = %v", p.Agents)
	}
	if cfg.Projects["gnathology"].Health != "http://gnathology-bot:8099/health" {
		t.Errorf("gnathology health = %q", cfg.Projects["gnathology"].Health)
	}
}
```

> NOTE: confirm `Load()` honors `PRAKTOR_CONFIG` env for the config path. Read `config.Load()` (around line 131). If it uses a different mechanism (fixed path / flag), adapt the test to that mechanism — do NOT invent one. If `Load()` cannot be pointed at a temp file, instead unit-test by calling the lower-level `yaml.Unmarshal` into `Config` directly with the YAML above.

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/config/ -run TestProjectsParse -v`
Expected: FAIL — `cfg.Projects` undefined (compile error).

- [ ] **Step 3: Add the types**

In `internal/config/config.go`, add to the `Config` struct (after the `Speech` field):

```go
	Projects  map[string]ProjectDefinition `yaml:"projects"`
```

Add a new type (near the other `*Config` type declarations):

```go
// ProjectDefinition is one project surfaced in the Mission Control roll-up.
type ProjectDefinition struct {
	Repo      string   `yaml:"repo"`       // owner/name on GitHub
	Agents    []string `yaml:"agents"`     // Praktor agent ids associated with this project
	DeployURL string   `yaml:"deploy_url"` // public URL to probe (HTTP 200 = healthy)
	Health    string   `yaml:"health"`     // internal health URL (praktor-net), used if DeployURL empty
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/config/ -run TestProjectsParse -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/config/config.go internal/config/config_test.go
git commit -m "feat(config): projects section for MC roll-up (F.2)"
```

---

### Task 2: Minimal GitHub read client

**Files:**
- Create: `internal/web/github.go`
- Test: `internal/web/github_test.go`

Read-only client over `net/http`, base URL injectable so tests point at `httptest`.

- [ ] **Step 1: Write the failing test**

Create `internal/web/github_test.go`:

```go
package web

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGitHubOpenPRs(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/repos/o/r/pulls" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer tok" {
			t.Errorf("missing auth header")
		}
		_, _ = w.Write([]byte(`[{"number":2,"title":"fix x","html_url":"http://gh/2","draft":false}]`))
	}))
	defer srv.Close()

	gh := &GitHubClient{Token: "tok", BaseURL: srv.URL, HTTP: srv.Client()}
	prs, err := gh.OpenPRs(context.Background(), "o/r")
	if err != nil {
		t.Fatalf("OpenPRs: %v", err)
	}
	if len(prs) != 1 || prs[0].Number != 2 || prs[0].Title != "fix x" || prs[0].URL != "http://gh/2" {
		t.Fatalf("got %+v", prs)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/web/ -run TestGitHubOpenPRs -v`
Expected: FAIL — `GitHubClient` undefined.

- [ ] **Step 3: Implement the client**

Create `internal/web/github.go`:

```go
package web

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

// GitHubClient is a minimal read-only GitHub REST client for the MC roll-up.
type GitHubClient struct {
	Token   string
	BaseURL string // default https://api.github.com
	HTTP    *http.Client
}

// PRInfo is a single open pull request.
type PRInfo struct {
	Number int    `json:"number"`
	Title  string `json:"title"`
	URL    string `json:"url"`
	Draft  bool   `json:"draft"`
}

// IssueInfo is a single open issue.
type IssueInfo struct {
	Number int    `json:"number"`
	Title  string `json:"title"`
	URL    string `json:"url"`
}

// CIStatus is the latest workflow run on the default branch.
type CIStatus struct {
	Status     string `json:"status"`     // queued|in_progress|completed
	Conclusion string `json:"conclusion"` // success|failure|...
	URL        string `json:"url"`
}

func (c *GitHubClient) base() string {
	if c.BaseURL != "" {
		return c.BaseURL
	}
	return "https://api.github.com"
}

func (c *GitHubClient) httpClient() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return &http.Client{Timeout: 8 * time.Second}
}

func (c *GitHubClient) get(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base()+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	resp, err := c.httpClient().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("github %s: %s", path, resp.Status)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// OpenPRs returns open pull requests for owner/name.
func (c *GitHubClient) OpenPRs(ctx context.Context, repo string) ([]PRInfo, error) {
	var raw []struct {
		Number  int    `json:"number"`
		Title   string `json:"title"`
		HTMLURL string `json:"html_url"`
		Draft   bool   `json:"draft"`
	}
	if err := c.get(ctx, "/repos/"+repo+"/pulls", &raw); err != nil {
		return nil, err
	}
	out := make([]PRInfo, 0, len(raw))
	for _, p := range raw {
		out = append(out, PRInfo{Number: p.Number, Title: p.Title, URL: p.HTMLURL, Draft: p.Draft})
	}
	return out, nil
}

// AuditIssues returns open issues with the given label (e.g. "audit-report").
// The GitHub issues endpoint also returns PRs; entries with a pull_request field are skipped.
func (c *GitHubClient) AuditIssues(ctx context.Context, repo, label string) ([]IssueInfo, error) {
	var raw []struct {
		Number      int             `json:"number"`
		Title       string          `json:"title"`
		HTMLURL     string          `json:"html_url"`
		PullRequest json.RawMessage `json:"pull_request"`
	}
	q := url.Values{"state": {"open"}, "labels": {label}}
	if err := c.get(ctx, "/repos/"+repo+"/issues?"+q.Encode(), &raw); err != nil {
		return nil, err
	}
	out := make([]IssueInfo, 0, len(raw))
	for _, i := range raw {
		if len(i.PullRequest) > 0 {
			continue // it's a PR, not an issue
		}
		out = append(out, IssueInfo{Number: i.Number, Title: i.Title, URL: i.HTMLURL})
	}
	return out, nil
}

// LatestCI returns the most recent workflow run on the repo's default branch.
func (c *GitHubClient) LatestCI(ctx context.Context, repo string) (CIStatus, error) {
	var meta struct {
		DefaultBranch string `json:"default_branch"`
	}
	if err := c.get(ctx, "/repos/"+repo, &meta); err != nil {
		return CIStatus{}, err
	}
	var runs struct {
		WorkflowRuns []struct {
			Status     string `json:"status"`
			Conclusion string `json:"conclusion"`
			HTMLURL    string `json:"html_url"`
		} `json:"workflow_runs"`
	}
	q := url.Values{"branch": {meta.DefaultBranch}, "per_page": {"1"}}
	if err := c.get(ctx, "/repos/"+repo+"/actions/runs?"+q.Encode(), &runs); err != nil {
		return CIStatus{}, err
	}
	if len(runs.WorkflowRuns) == 0 {
		return CIStatus{Status: "none"}, nil
	}
	r := runs.WorkflowRuns[0]
	return CIStatus{Status: r.Status, Conclusion: r.Conclusion, URL: r.HTMLURL}, nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/web/ -run TestGitHubOpenPRs -v`
Expected: PASS.

- [ ] **Step 5: Add tests for AuditIssues (PR-skip) and LatestCI, run, then commit**

Append to `internal/web/github_test.go`:

```go
func TestGitHubAuditIssuesSkipsPRs(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`[
			{"number":13,"title":"audit","html_url":"http://gh/13"},
			{"number":9,"title":"a pr","html_url":"http://gh/9","pull_request":{"url":"x"}}
		]`))
	}))
	defer srv.Close()
	gh := &GitHubClient{BaseURL: srv.URL, HTTP: srv.Client()}
	issues, err := gh.AuditIssues(context.Background(), "o/r", "audit-report")
	if err != nil {
		t.Fatal(err)
	}
	if len(issues) != 1 || issues[0].Number != 13 {
		t.Fatalf("expected only issue #13, got %+v", issues)
	}
}

func TestGitHubLatestCI(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/o/r":
			_, _ = w.Write([]byte(`{"default_branch":"main"}`))
		case "/repos/o/r/actions/runs":
			if r.URL.Query().Get("branch") != "main" {
				t.Errorf("branch = %s", r.URL.Query().Get("branch"))
			}
			_, _ = w.Write([]byte(`{"workflow_runs":[{"status":"completed","conclusion":"success","html_url":"http://gh/run"}]}`))
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
		}
	}))
	defer srv.Close()
	gh := &GitHubClient{BaseURL: srv.URL, HTTP: srv.Client()}
	ci, err := gh.LatestCI(context.Background(), "o/r")
	if err != nil {
		t.Fatal(err)
	}
	if ci.Conclusion != "success" || ci.URL != "http://gh/run" {
		t.Fatalf("got %+v", ci)
	}
}
```

Run: `go test ./internal/web/ -run TestGitHub -v`
Expected: PASS (all three).

```bash
git add internal/web/github.go internal/web/github_test.go
git commit -m "feat(web): minimal read-only GitHub client for MC roll-up (F.2)"
```

---

### Task 3: Aggregator — build ProjectStatus

**Files:**
- Create: `internal/web/projects.go` (types + aggregator; handler added in Task 4)
- Test: `internal/web/projects_test.go`

Aggregator combines GitHub (interface, mockable) + deploy probe + agent liveness, with **partial degradation**: a failing source sets an `*_error` field, never drops the whole project.

- [ ] **Step 1: Write the failing test**

Create `internal/web/projects_test.go`:

```go
package web

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mtzanidakis/praktor/internal/config"
	"github.com/mtzanidakis/praktor/internal/container"
)

type fakeGH struct {
	prs    []PRInfo
	issues []IssueInfo
	ci     CIStatus
	err    error
}

func (f *fakeGH) OpenPRs(ctx context.Context, repo string) ([]PRInfo, error) {
	return f.prs, f.err
}
func (f *fakeGH) AuditIssues(ctx context.Context, repo, label string) ([]IssueInfo, error) {
	return f.issues, f.err
}
func (f *fakeGH) LatestCI(ctx context.Context, repo string) (CIStatus, error) {
	return f.ci, f.err
}

func TestBuildProjectStatus_OK(t *testing.T) {
	deploy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer deploy.Close()

	agg := &Aggregator{
		gh:   &fakeGH{prs: []PRInfo{{Number: 2}}, issues: []IssueInfo{{Number: 13}}, ci: CIStatus{Conclusion: "success"}},
		http: deploy.Client(),
	}
	def := config.ProjectDefinition{Repo: "o/r", Agents: []string{"coder", "ghost"}, DeployURL: deploy.URL}
	running := []container.ContainerInfo{{AgentID: "coder", Status: "running"}}

	st := agg.BuildProjectStatus(context.Background(), "pdai", def, running)

	if st.Name != "pdai" || st.Repo != "o/r" {
		t.Errorf("identity: %+v", st)
	}
	if len(st.PRs) != 1 || len(st.AuditIssues) != 1 || st.CI.Conclusion != "success" {
		t.Errorf("github: %+v", st)
	}
	if !st.Deploy.OK || st.Deploy.Code != 200 {
		t.Errorf("deploy: %+v", st.Deploy)
	}
	// agent liveness: coder running, ghost not
	live := map[string]bool{}
	for _, a := range st.Agents {
		live[a.ID] = a.Running
	}
	if !live["coder"] || live["ghost"] {
		t.Errorf("agents: %+v", st.Agents)
	}
}

func TestBuildProjectStatus_PartialDegradation(t *testing.T) {
	agg := &Aggregator{
		gh:   &fakeGH{err: errors.New("boom")},
		http: &http.Client{},
	}
	def := config.ProjectDefinition{Repo: "o/r", DeployURL: "http://127.0.0.1:1/nope"}
	st := agg.BuildProjectStatus(context.Background(), "x", def, nil)

	if st.PRError == "" || st.AuditError == "" || st.CI.Error == "" {
		t.Errorf("expected error fields set, got %+v", st)
	}
	if st.Deploy.OK || st.Deploy.Error == "" {
		t.Errorf("expected deploy error, got %+v", st.Deploy)
	}
	// must NOT panic and must still return identity
	if st.Name != "x" {
		t.Errorf("identity lost: %+v", st)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/web/ -run TestBuildProjectStatus -v`
Expected: FAIL — `Aggregator` / `BuildProjectStatus` undefined.

- [ ] **Step 3: Implement aggregator + types**

Create `internal/web/projects.go`:

```go
package web

import (
	"context"
	"net/http"
	"time"

	"github.com/mtzanidakis/praktor/internal/config"
	"github.com/mtzanidakis/praktor/internal/container"
)

const auditLabel = "audit-report"

// ghReader is the read-only GitHub surface the aggregator needs (mockable in tests).
type ghReader interface {
	OpenPRs(ctx context.Context, repo string) ([]PRInfo, error)
	AuditIssues(ctx context.Context, repo, label string) ([]IssueInfo, error)
	LatestCI(ctx context.Context, repo string) (CIStatus, error)
}

// DeployStatus is the result of probing a project's deploy/health URL.
type DeployStatus struct {
	OK        bool   `json:"ok"`
	Code      int    `json:"code"`
	LatencyMS int64  `json:"latency_ms"`
	Error     string `json:"error,omitempty"`
}

// AgentLive is one agent's liveness within a project.
type AgentLive struct {
	ID      string `json:"id"`
	Running bool   `json:"running"`
}

// ProjectStatus is the aggregated, UI-facing status of one project.
type ProjectStatus struct {
	Name        string       `json:"name"`
	Repo        string       `json:"repo"`
	PRs         []PRInfo     `json:"prs"`
	PRError     string       `json:"pr_error,omitempty"`
	AuditIssues []IssueInfo  `json:"audit_issues"`
	AuditError  string       `json:"audit_error,omitempty"`
	CI          ciResult     `json:"ci"`
	Deploy      DeployStatus `json:"deploy"`
	Agents      []AgentLive  `json:"agents"`
}

// ciResult is CIStatus plus an error slot for partial degradation.
type ciResult struct {
	Status     string `json:"status"`
	Conclusion string `json:"conclusion"`
	URL        string `json:"url"`
	Error      string `json:"error,omitempty"`
}

// Aggregator builds ProjectStatus from GitHub + a deploy probe + orchestrator liveness.
type Aggregator struct {
	gh   ghReader
	http *http.Client
}

// BuildProjectStatus assembles one project's status. Never panics; failing
// sources surface as *_error fields rather than dropping the project.
func (a *Aggregator) BuildProjectStatus(ctx context.Context, name string, def config.ProjectDefinition, running []container.ContainerInfo) ProjectStatus {
	st := ProjectStatus{Name: name, Repo: def.Repo}

	if prs, err := a.gh.OpenPRs(ctx, def.Repo); err != nil {
		st.PRError = err.Error()
	} else {
		st.PRs = prs
	}
	if issues, err := a.gh.AuditIssues(ctx, def.Repo, auditLabel); err != nil {
		st.AuditError = err.Error()
	} else {
		st.AuditIssues = issues
	}
	if ci, err := a.gh.LatestCI(ctx, def.Repo); err != nil {
		st.CI = ciResult{Error: err.Error()}
	} else {
		st.CI = ciResult{Status: ci.Status, Conclusion: ci.Conclusion, URL: ci.URL}
	}

	st.Deploy = a.probeDeploy(ctx, def)
	st.Agents = liveness(def.Agents, running)
	return st
}

func (a *Aggregator) probeDeploy(ctx context.Context, def config.ProjectDefinition) DeployStatus {
	target := def.DeployURL
	if target == "" {
		target = def.Health
	}
	if target == "" {
		return DeployStatus{Error: "no deploy_url or health configured"}
	}
	start := time.Now()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return DeployStatus{Error: err.Error()}
	}
	resp, err := a.http.Do(req)
	if err != nil {
		return DeployStatus{Error: err.Error(), LatencyMS: time.Since(start).Milliseconds()}
	}
	defer resp.Body.Close()
	return DeployStatus{
		OK:        resp.StatusCode == http.StatusOK,
		Code:      resp.StatusCode,
		LatencyMS: time.Since(start).Milliseconds(),
	}
}

// liveness maps configured agent ids to whether a running container exists.
func liveness(agents []string, running []container.ContainerInfo) []AgentLive {
	up := make(map[string]bool, len(running))
	for _, c := range running {
		up[c.AgentID] = true
	}
	out := make([]AgentLive, 0, len(agents))
	for _, id := range agents {
		out = append(out, AgentLive{ID: id, Running: up[id]})
	}
	return out
}
```

> NOTE: `GitHubClient` (Task 2) already satisfies `ghReader` structurally (same three method signatures) — no adapter needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/web/ -run TestBuildProjectStatus -v`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add internal/web/projects.go internal/web/projects_test.go
git commit -m "feat(web): project-status aggregator with partial degradation (F.2)"
```

---

### Task 4: `/api/projects` endpoint + 30s cache

**Files:**
- Modify: `internal/web/projects.go` (add server-side handler + cached aggregator wiring)
- Modify: `internal/web/api.go:registerAPI` (register route)
- Modify: `internal/web/server.go` (construct Aggregator from env token in `NewServer`)
- Test: `internal/web/projects_test.go` (handler cache test)

- [ ] **Step 1: Write the failing test (cache behavior)**

Append to `internal/web/projects_test.go`:

```go
func TestProjectsCache(t *testing.T) {
	calls := 0
	gh := &countingGH{onCall: func() { calls++ }}
	c := &projectsCache{ttl: time.Minute, now: func() time.Time { return time.Unix(1000, 0) }}
	build := func() []ProjectStatus {
		gh.OpenPRs(context.Background(), "o/r") //nolint -- count a source hit
		return []ProjectStatus{{Name: "pdai"}}
	}
	_ = c.get(build)
	_ = c.get(build) // within TTL → must NOT rebuild
	if calls != 1 {
		t.Fatalf("expected 1 build within TTL, got %d", calls)
	}
}

type countingGH struct{ onCall func() }

func (c *countingGH) OpenPRs(ctx context.Context, repo string) ([]PRInfo, error) {
	c.onCall()
	return nil, nil
}
func (c *countingGH) AuditIssues(ctx context.Context, repo, label string) ([]IssueInfo, error) {
	return nil, nil
}
func (c *countingGH) LatestCI(ctx context.Context, repo string) (CIStatus, error) {
	return CIStatus{}, nil
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/web/ -run TestProjectsCache -v`
Expected: FAIL — `projectsCache` undefined.

- [ ] **Step 3: Add cache + handler**

Append to `internal/web/projects.go`:

```go
import "sync" // add to the existing import block (do not duplicate the block)

// projectsCache memoizes the aggregated roll-up for ttl to respect GitHub rate limits.
type projectsCache struct {
	ttl  time.Duration
	now  func() time.Time
	mu   sync.Mutex
	at   time.Time
	data []ProjectStatus
}

func (c *projectsCache) get(build func() []ProjectStatus) []ProjectStatus {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now
	if c.now != nil {
		now = c.now
	}
	if c.data != nil && now().Sub(c.at) < c.ttl {
		return c.data
	}
	c.data = build()
	c.at = now()
	return c.data
}

// handleProjects is the GET /api/projects handler.
func (s *Server) handleProjects(w http.ResponseWriter, r *http.Request) {
	if s.aggregator == nil {
		jsonError(w, "projects roll-up not configured", http.StatusServiceUnavailable)
		return
	}
	data := s.projCache.get(func() []ProjectStatus {
		running, _ := s.orch.ListRunning(r.Context())
		out := make([]ProjectStatus, 0, len(s.projects))
		for name, def := range s.projects {
			out = append(out, s.aggregator.BuildProjectStatus(r.Context(), name, def, running))
		}
		return out
	})
	jsonResponse(w, data)
}
```

> Move the `import "sync"` into the file's existing `import (...)` block rather than adding a second block (Go rejects it otherwise).

- [ ] **Step 4: Wire into Server + register route**

In `internal/web/server.go`, add fields to `Server`:

```go
	aggregator *Aggregator
	projCache  *projectsCache
	projects   map[string]config.ProjectDefinition
```

In `NewServer(...)`, after the struct is built, add (uses env token; full config passed in — see NOTE):

```go
	srv.projects = projects // map[string]config.ProjectDefinition passed into NewServer
	if tok := os.Getenv("GITHUB_READ_TOKEN"); tok != "" || len(projects) > 0 {
		srv.aggregator = &Aggregator{
			gh:   &GitHubClient{Token: os.Getenv("GITHUB_READ_TOKEN")},
			http: &http.Client{Timeout: 8 * time.Second},
		}
		srv.projCache = &projectsCache{ttl: 30 * time.Second}
	}
```

> NOTE on signature: `NewServer` currently receives `cfg config.WebConfig`, not the whole `Config`. Add a `projects map[string]config.ProjectDefinition` parameter to `NewServer` and pass `cfg.Projects` from the caller (find the single `web.NewServer(` call — likely in `cmd/praktor/main.go` — and pass `cfg.Projects`). Add imports `os` and `net/http` to server.go if not present.

In `internal/web/api.go` `registerAPI`, add near the other GET routes:

```go
	mux.HandleFunc("GET /api/projects", s.handleProjects)
```

- [ ] **Step 5: Run tests + build**

Run: `go test ./internal/web/ -run "TestProjectsCache|TestBuildProjectStatus|TestGitHub" -v`
Expected: PASS.
Run: `go build ./...`
Expected: builds clean.

- [ ] **Step 6: Commit**

```bash
git add internal/web/projects.go internal/web/api.go internal/web/server.go cmd/praktor/main.go
git commit -m "feat(web): GET /api/projects endpoint with 30s cache (F.2)"
```

---

### Task 5: Local gate — projects config + token + live curl

**Files:** (server-side, on `own_landing`; [ALEX] supplies token)

- [ ] **Step 1: [ALEX] create read-only PAT + add to server env**

Alex creates a fine-grained **read-only** PAT (Contents:read, Pull requests:read, Issues:read, Actions:read) scoped to `pdai_calculator` + `gnathology-bot`, then adds to `/opt/.../praktor` server `.env`:

```
GITHUB_READ_TOKEN=github_pat_...
```

(Claude does not create fine-grained PATs and does not edit `.env`.)

- [ ] **Step 2: Add `projects:` to the server config**

Add the `projects:` block (from Task 1) to the server `~/praktor/config/praktor.yaml` (hot-reload picks it up; the new env var needs a container/stack restart so the Go process re-reads it).

Run (on box, via `ssh own_landing`):
```bash
cd ~/praktor && docker compose up -d   # picks up new .env (GITHUB_READ_TOKEN)
```

- [ ] **Step 3: Gate — curl via SSH-forward**

From the workstation:
```bash
ssh -L 8080:localhost:8080 own_landing   # in one shell (or existing forward)
curl -s -u admin:$PRAKTOR_WEB_PASSWORD http://localhost:8080/api/projects | jq .
```
Expected: JSON array with two projects (`pdai`, `gnathology`), each showing real `prs` / `audit_issues` / `ci` / `deploy.ok` / `agents[].running`. No source should be silently empty — a failure shows as an `*_error` field.

- [ ] **Step 4: Commit (config example only — server config is gitignored)**

Add a documented example to the repo so the shape is tracked:
```bash
# add a `projects:` example block to config/praktor.example.yaml (if it exists) or README
git add config/ README.md
git commit -m "docs(config): example projects section for MC roll-up (F.2)"
```

---

## STAGE 2 — React Projects view

### Task 6: Projects page + nav + route

**Files:**
- Create: `ui/src/pages/Projects.tsx`
- Modify: `ui/src/App.tsx` (nav item + route + lazy import + icon)
- Test: `ui/src/__tests__/project-status.test.ts` (pure helper)

- [ ] **Step 1: Write the failing test (pure status→label helper)**

Create `ui/src/__tests__/project-status.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ciLabel, deployLabel } from '../pages/projectStatus';

describe('ciLabel', () => {
  it('maps success', () => expect(ciLabel({ status: 'completed', conclusion: 'success' })).toBe('✓ passing'));
  it('maps failure', () => expect(ciLabel({ status: 'completed', conclusion: 'failure' })).toBe('✗ failing'));
  it('maps running', () => expect(ciLabel({ status: 'in_progress', conclusion: '' })).toBe('… running'));
  it('maps error', () => expect(ciLabel({ error: 'boom' } as never)).toBe('error'));
});

describe('deployLabel', () => {
  it('ok', () => expect(deployLabel({ ok: true, code: 200 })).toBe('● 200'));
  it('down', () => expect(deployLabel({ ok: false, code: 500 })).toBe('● 500'));
  it('error', () => expect(deployLabel({ ok: false, error: 'x' } as never)).toBe('● down'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npm test -- project-status`
Expected: FAIL — `../pages/projectStatus` not found.

- [ ] **Step 3: Implement the pure helpers + types**

Create `ui/src/pages/projectStatus.ts`:

```ts
export interface CI { status?: string; conclusion?: string; url?: string; error?: string }
export interface Deploy { ok?: boolean; code?: number; latency_ms?: number; error?: string }
export interface PR { number: number; title: string; url: string; draft: boolean }
export interface Issue { number: number; title: string; url: string }
export interface Agent { id: string; running: boolean }
export interface ProjectStatus {
  name: string; repo: string;
  prs?: PR[]; pr_error?: string;
  audit_issues?: Issue[]; audit_error?: string;
  ci: CI; deploy: Deploy; agents?: Agent[];
}

export function ciLabel(ci: CI): string {
  if (ci.error) return 'error';
  if (ci.status === 'in_progress' || ci.status === 'queued') return '… running';
  if (ci.conclusion === 'success') return '✓ passing';
  if (ci.conclusion === 'failure') return '✗ failing';
  return ci.conclusion || ci.status || '—';
}

export function deployLabel(d: Deploy): string {
  if (d.error) return '● down';
  return `● ${d.code ?? '—'}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npm test -- project-status`
Expected: PASS.

- [ ] **Step 5: Implement the page**

Create `ui/src/pages/Projects.tsx`:

```tsx
import { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { ciLabel, deployLabel, type ProjectStatus } from './projectStatus';

const card: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: 10, padding: 20, boxShadow: 'var(--shadow)', minWidth: 280,
};

function Projects() {
  const [projects, setProjects] = useState<ProjectStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { events } = useWebSocket();

  const fetchProjects = useCallback(() => {
    fetch('/api/projects')
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then(setProjects)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);
  useEffect(() => { fetchProjects(); }, [events, fetchProjects]); // refresh on WS activity

  if (error) return <div style={{ color: 'var(--danger, #c00)' }}>Error: {error}</div>;
  if (!projects) return <div>Loading…</div>;

  return (
    <div>
      <h1 style={{ marginBottom: 20 }}>Projects</h1>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {projects.map((p) => (
          <div key={p.name} style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong style={{ fontSize: 18 }}>{p.name}</strong>
              <span title={p.deploy.error || ''} style={{ color: p.deploy.ok ? 'var(--accent)' : '#c0392b' }}>
                {deployLabel(p.deploy)}
              </span>
            </div>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{p.repo}</div>
            <div style={{ marginTop: 10, display: 'grid', gap: 4, fontSize: 14 }}>
              <div>PRs: {p.pr_error ? <span title={p.pr_error}>error</span> : (p.prs?.length ?? 0)} open</div>
              <div>CI: {ciLabel(p.ci)}</div>
              <div>audit: {p.audit_error ? <span title={p.audit_error}>error</span> : (p.audit_issues?.length ?? 0)}</div>
              <div>agents: {(p.agents ?? []).map((a) => (
                <span key={a.id} style={{ marginRight: 8 }}>{a.id} {a.running ? '●' : '○'}</span>
              ))}</div>
            </div>
            {(p.prs ?? []).length > 0 && (
              <ul style={{ marginTop: 8, paddingLeft: 16, fontSize: 13 }}>
                {p.prs!.map((pr) => (
                  <li key={pr.number}>
                    <a href={pr.url} target="_blank" rel="noopener noreferrer">#{pr.number} {pr.title}{pr.draft ? ' (draft)' : ''}</a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default Projects;
```

- [ ] **Step 6: Register nav + route in `ui/src/App.tsx`**

Add a lazy import near the others:
```tsx
const Projects = lazy(() => import('./pages/Projects'));
```
Add an icon function (reuse a simple SVG; copy the shape of `IconDashboard`, rename to `IconProjects`).
Add to `navItems` (after Dashboard):
```tsx
  { to: '/projects', label: 'Projects', Icon: IconProjects },
```
Add to `<Routes>`:
```tsx
            <Route path="/projects" element={<Projects />} />
```

- [ ] **Step 7: Build + test, then commit**

Run: `cd ui && npm test -- project-status && npm run build`
Expected: tests PASS, build succeeds.

```bash
git add ui/src/pages/Projects.tsx ui/src/pages/projectStatus.ts ui/src/__tests__/project-status.test.ts ui/src/App.tsx
git commit -m "feat(ui): read-only Projects roll-up page (F.2)"
```

---

### Task 7: Stage-2 gate — view via SSH-forward

- [ ] **Step 1: Rebuild + deploy MC on the box**

On `own_landing` (the UI is built into the Go server image — confirm the Docker build runs `npm run build`; check `Dockerfile`):
```bash
ssh own_landing 'cd ~/praktor && git fetch && git checkout feature/f2-mc-rollup && docker compose build && docker compose up -d'
```
> If MC is the main `praktor` container, this is the same stack; mind the single-instance / TG-409 rule from prior phases — bring it up, not a second copy.

- [ ] **Step 2: Gate — open the screen via SSH-forward**

With `ssh -L 8080:localhost:8080 own_landing` active, open `http://localhost:8080/projects` in a browser, log in. Confirm both project cards render with real data matching `gh pr list` / Actions / live deploy. Verify a deliberately-bad source (e.g., temporarily wrong repo) shows `error`, not a blank.

- [ ] **Step 3: Commit (nothing to commit if green; note result in memory at phase close)**

---

## STAGE 3 — Cloudflare Tunnel exposure (infra; [ALEX]-driven secrets)

> This stage has no unit tests; its gate is "the screen loads on a phone, behind auth." Claude prepares config/commands; Alex provides the Cloudflare account/tunnel token and confirms DNS.

### Task 8: Expose MC via `cloudflared`

**Files:** server-side on `own_landing`; Cloudflare dashboard (Alex).

- [ ] **Step 1: [ALEX] decide subdomain + create CF Tunnel**

Pick a Cloudflare-managed domain (e.g. an existing one). In Cloudflare Zero Trust → Networks → Tunnels: create a tunnel `praktor-mc`, copy its **tunnel token**. Decide hostname e.g. `mc.<domain>` → service `http://localhost:8080`.

- [ ] **Step 2: Run cloudflared as a container on the box (token via env, not committed)**

Add a `cloudflared` service to a NEW compose file `deploy/cloudflared.compose.yml` (kept out of the main stack to isolate):
```yaml
services:
  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    environment:
      - TUNNEL_TOKEN=${CF_TUNNEL_TOKEN}
    networks: [default]
networks:
  default:
    name: praktor-net
    external: true
```
> Joining `praktor-net` lets cloudflared reach the MC by service name if MC is on that network; otherwise point the CF tunnel public-hostname at `http://<mc-container>:8080`. Confirm MC's container name/network on the box first. `CF_TUNNEL_TOKEN` goes in the server `.env` ([ALEX]); the tunnel is **outbound** — no inbound port, ufw default-deny stays intact.

Run (on box):
```bash
cd ~/praktor && docker compose -f deploy/cloudflared.compose.yml up -d
docker logs <cloudflared-container> 2>&1 | tail -20   # expect "Registered tunnel connection"
```

- [ ] **Step 3: Confirm auth layer**

MC already requires `PRAKTOR_WEB_PASSWORD` (basic/session). Optionally add **Cloudflare Access** (Zero Trust → Access → Application) on `mc.<domain>` restricted to Alex's identity as a second factor. Recommended given this is the first public exposure of the control plane.

- [ ] **Step 4: Gate — load on phone**

From a phone (off the LAN), open `https://mc.<domain>/projects`, authenticate, confirm the roll-up renders. Confirm `https://mc.<domain>` is **not** reachable without auth (logout → blocked).

- [ ] **Step 5: Commit infra-as-code (token stays in .env)**

```bash
git add deploy/cloudflared.compose.yml
git commit -m "feat(deploy): cloudflared tunnel for MC exposure (F.2)"
```

---

## Self-Review (author checklist)

**Spec coverage:**
- Design §1 project model → Task 1 ✓
- §2 aggregator (GitHub read-PAT, deploy probe, agent liveness, cache, partial degradation, env token) → Tasks 2,3,4 ✓
- §3 React read-only Projects view → Task 6 ✓
- §4 CF Tunnel access → Task 8 ✓
- §5 fork-divergence (new files: github.go, projects.go, Projects.tsx, projectStatus.ts; minimal edits to config.go/api.go/server.go/App.tsx) → respected ✓
- §6 verification gates (SSH-forward curl/screen → phone URL) → Tasks 5,7,8 ✓

**Placeholder scan:** no TBD/"handle errors"/"similar to" — each code step shows real code. CI default-branch fetched (not hardcoded). Partial degradation explicit. ✓

**Type consistency:** `GitHubClient` methods match `ghReader` interface (OpenPRs/AuditIssues/LatestCI) ✓; `ProjectStatus`/`PRInfo`/`IssueInfo`/`CIStatus`/`DeployStatus`/`AgentLive` consistent Go↔TS (TS `ci`/`deploy` shapes mirror Go json tags) ✓; `BuildProjectStatus` signature stable across Tasks 3–4 ✓.

**Known verification points flagged inline (resolve from code at impl, not memory):** `config.Load()` config-path mechanism (Task 1 NOTE); `web.NewServer` call site + signature change (Task 4 NOTE); Dockerfile builds the UI (Task 7); MC container name/network for cloudflared (Task 8).

## Out of scope
Approve/merge/deploy actions (control), multi-agent, VPS upgrade, fork upstream-vs-self decision — separate Phase F sub-projects.
