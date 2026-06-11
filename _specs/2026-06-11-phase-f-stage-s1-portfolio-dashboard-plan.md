# S1 — Project Portfolio Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only Mission Control page that shows every opted-in non-PII project's planned directions, in-progress work (with progress), and done items — sourced from a structured roadmap block in local memory, published to a private data repo, read by MC, enriched client-side with live GitHub state.

**Architecture:** Three units across two repos. (1) A zero-dependency **local publisher** in `~/.claude` parses a fenced ` ```roadmap ` JSON block out of each `project_*.md`, sanitizes it, and pushes `portfolio.json` to a private repo `Meta-Psy/portfolio-data`. (2) MC **Go backend** (fork) reads that JSON via the existing F.2 GitHub read-client and serves `GET /api/portfolio` (cached, stale-tolerant). (3) MC **React page** fetches `/api/portfolio` + the existing `/api/projects`, derives percent, renders overview rows → drill-down lanes, and merges live CI/deploy chips by key.

**Tech Stack:** Node `node:test` (publisher, zero-dep), Go 1.26 + `net/http` + `net/http/httptest` (backend), React 18 + Vite + vitest (UI). Tests run in Docker `golang:1.26rc1` for Go (no native toolchain) and native Node for the rest.

**Design refinements (within approved design, flagged):**
- roadmap block is a fenced ` ```roadmap ` **JSON** block in `project_*.md` body, NOT YAML frontmatter — `~/.claude` has no `node_modules`, so `JSON.parse` keeps the publisher zero-dependency and robust.
- roadmap × live-GitHub merge happens in **React** (page fetches both endpoints), keeping the Go side a thin pass-through.
- `percent` is derived in the UI from `directions` (done/total), never stored.

---

## File structure

**Repo A — `~/.claude` (local, no git remote; commit locally, Alex approves diff per process rule #2):**
- Create: `hooks/portfolio-publish.cjs` — pure `buildPortfolio(memoryDir)` + thin CLI (co-located with hooks for the shared `node --test` runner; NOT wired as a hook).
- Create: `hooks/portfolio-publish.test.cjs` — unit tests.
- Create: `commands/publish-portfolio.md` — `/publish-portfolio` command that runs the CLI, copies `portfolio.json` into a local clone of the data repo, commits + pushes.

**Repo B — `Meta-Psy/praktor` fork, branch `feature/s1-portfolio-dashboard` (already created):**
- Modify: `internal/web/github.go` — add `GetFileContent`.
- Modify: `internal/web/github_test.go` — test `GetFileContent`.
- Create: `internal/web/portfolio.go` — Portfolio types, reader, cache, `handlePortfolio`.
- Create: `internal/web/portfolio_test.go` — backend tests.
- Modify: `internal/web/server.go` — wire portfolio reader from env in `NewServer`.
- Modify: `internal/web/api.go` — register `GET /api/portfolio`.
- Create: `ui/src/pages/portfolioStatus.ts` — types + `percent` + `laneFor` helpers.
- Create: `ui/src/pages/Portfolio.tsx` — the page.
- Create: `ui/src/__tests__/portfolioStatus.test.ts` — UI helper tests.
- Modify: `ui/src/App.tsx` — lazy import + nav item + route.

**Repo C — `Meta-Psy/portfolio-data`:** created by Alex ([ALEX] gate), holds only `portfolio.json`.

---

## roadmap block contract

A fenced block inside any `project_*.md` (body, not frontmatter):

````markdown
```roadmap
{
  "name": "Autonomous CC Stack",
  "status": "active",
  "next_action": "S1: writing-plans → реализация",
  "mc_key": "praktor",
  "directions": [
    { "title": "E.1 own_landing + Praktor", "state": "done" },
    { "title": "F.3 approve-from-UI",       "state": "done" },
    { "title": "S1 portfolio dashboard",    "state": "doing" },
    { "title": "S2 intake + triage",        "state": "planned" }
  ]
}
```
````

- `key` is **derived from filename**: `project_claude_optimization.md` → `claude_optimization`.
- `status` ∈ `active|paused|done`. `state` ∈ `planned|doing|done`.
- `mc_key` is optional — when present it matches a `/api/projects` entry `name` for the live chip.
- `name`, `status`, `directions` are required; a block missing any of them is skipped with a warning.

---

## Task 1: Publisher — `buildPortfolio` pure function

**Files:**
- Create: `~/.claude/hooks/portfolio-publish.cjs`
- Test: `~/.claude/hooks/portfolio-publish.test.cjs`

- [ ] **Step 1: Write the failing tests**

```javascript
'use strict';
// Tests for portfolio-publish.cjs — pure buildPortfolio over a memory dir.
// Run: node --test hooks/portfolio-publish.test.cjs
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildPortfolio } = require('./portfolio-publish.cjs');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-'));
}

const BLOCK = (obj) => '# notes\n\n```roadmap\n' + JSON.stringify(obj, null, 2) + '\n```\n\nmore prose with SECRET=abc123\n';

const valid = {
  name: 'Autonomous CC Stack', status: 'active', next_action: 'do S1', mc_key: 'praktor',
  directions: [{ title: 'A', state: 'done' }, { title: 'B', state: 'doing' }, { title: 'C', state: 'planned' }],
};

test('parses a valid roadmap block and derives key from filename', () => {
  const dir = mkTmp();
  fs.writeFileSync(path.join(dir, 'project_claude_optimization.md'), BLOCK(valid));
  const { projects, warnings } = buildPortfolio(dir);
  assert.equal(warnings.length, 0);
  assert.equal(projects.length, 1);
  const p = projects[0];
  assert.equal(p.key, 'claude_optimization');
  assert.equal(p.name, 'Autonomous CC Stack');
  assert.equal(p.status, 'active');
  assert.equal(p.mc_key, 'praktor');
  assert.equal(p.directions.length, 3);
});

test('sanitizes — only whitelisted keys leak; no body prose, no extra fields', () => {
  const dir = mkTmp();
  const dirty = { ...valid, evil: 'rm -rf', token: 'ghp_secret' };
  fs.writeFileSync(path.join(dir, 'project_x.md'), BLOCK(dirty));
  const p = buildPortfolio(dir).projects[0];
  assert.deepEqual(Object.keys(p).sort(), ['directions', 'key', 'mc_key', 'name', 'next_action', 'status']);
  for (const d of p.directions) {
    assert.deepEqual(Object.keys(d).sort(), ['state', 'title']);
  }
  assert.ok(!JSON.stringify(p).includes('ghp_secret'));
  assert.ok(!JSON.stringify(p).includes('SECRET=abc123'));
});

test('skips files without a roadmap block', () => {
  const dir = mkTmp();
  fs.writeFileSync(path.join(dir, 'project_plain.md'), '# just prose, no block\n');
  assert.equal(buildPortfolio(dir).projects.length, 0);
});

test('PII files are skipped entirely even with a valid block', () => {
  const dir = mkTmp();
  fs.writeFileSync(path.join(dir, 'project_histology_db.md'), BLOCK(valid));
  fs.writeFileSync(path.join(dir, 'project_pemphigus_db.md'), BLOCK(valid));
  const { projects, warnings } = buildPortfolio(dir);
  assert.equal(projects.length, 0);
  assert.equal(warnings.filter((w) => w.includes('PII')).length, 2);
});

test('malformed block (missing required field) is skipped with a warning', () => {
  const dir = mkTmp();
  fs.writeFileSync(path.join(dir, 'project_bad.md'), BLOCK({ name: 'x', status: 'active' })); // no directions
  const { projects, warnings } = buildPortfolio(dir);
  assert.equal(projects.length, 0);
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes('project_bad.md'));
});

test('invalid status / state values are rejected', () => {
  const dir = mkTmp();
  fs.writeFileSync(path.join(dir, 'project_bad2.md'), BLOCK({ ...valid, status: 'wat' }));
  assert.equal(buildPortfolio(dir).projects.length, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/.claude && node --test hooks/portfolio-publish.test.cjs`
Expected: FAIL — `Cannot find module './portfolio-publish.cjs'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
'use strict';
// portfolio-publish.cjs — zero-dependency publisher for the S1 portfolio dashboard.
// buildPortfolio(memoryDir) parses a fenced ```roadmap JSON block out of each
// project_*.md, sanitizes it to a whitelist, and returns { projects, warnings }.
// CLI: node portfolio-publish.cjs <memoryDir> <outFile> [--now=<iso>]
const fs = require('fs');
const path = require('path');

const PII = /histology|hystology|pemphigus/i;
const STATUS = new Set(['active', 'paused', 'done']);
const STATE = new Set(['planned', 'doing', 'done']);
const BLOCK_RE = /```roadmap\s*\n([\s\S]*?)\n```/;

function keyFromFilename(file) {
  return path.basename(file).replace(/^project_/, '').replace(/\.md$/, '');
}

function sanitize(key, raw) {
  if (!raw || typeof raw !== 'object') throw new Error('not an object');
  if (typeof raw.name !== 'string' || !raw.name) throw new Error('missing name');
  if (!STATUS.has(raw.status)) throw new Error('bad status');
  if (!Array.isArray(raw.directions) || raw.directions.length === 0) throw new Error('missing directions');
  const directions = raw.directions.map((d) => {
    if (!d || typeof d.title !== 'string' || !STATE.has(d.state)) throw new Error('bad direction');
    return { title: d.title, state: d.state };
  });
  const out = { key, name: raw.name, status: raw.status, directions };
  if (typeof raw.next_action === 'string') out.next_action = raw.next_action;
  if (typeof raw.mc_key === 'string') out.mc_key = raw.mc_key;
  return out;
}

function buildPortfolio(memoryDir) {
  const projects = [];
  const warnings = [];
  const files = fs.readdirSync(memoryDir).filter((f) => /^project_.*\.md$/.test(f));
  for (const file of files) {
    if (PII.test(file)) { warnings.push(`skipped PII file: ${file}`); continue; }
    const text = fs.readFileSync(path.join(memoryDir, file), 'utf8');
    const m = BLOCK_RE.exec(text);
    if (!m) continue; // no block → not on the dashboard
    let raw;
    try { raw = JSON.parse(m[1]); } catch (e) { warnings.push(`${file}: invalid JSON in roadmap block: ${e.message}`); continue; }
    try { projects.push(sanitize(keyFromFilename(file), raw)); }
    catch (e) { warnings.push(`${file}: ${e.message}`); }
  }
  projects.sort((a, b) => a.key.localeCompare(b.key));
  return { projects, warnings };
}

module.exports = { buildPortfolio };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/.claude && node --test hooks/portfolio-publish.test.cjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/.claude
git checkout -b feature/s1-portfolio-publisher
git add hooks/portfolio-publish.cjs hooks/portfolio-publish.test.cjs
git commit -m "feat(portfolio): zero-dep buildPortfolio parser + sanitizer (S1)"
```

---

## Task 2: Publisher — CLI wrapper

**Files:**
- Modify: `~/.claude/hooks/portfolio-publish.cjs` (append CLI + `assemble`)
- Test: `~/.claude/hooks/portfolio-publish.test.cjs` (append)

- [ ] **Step 1: Write the failing test**

```javascript
const { assemble } = require('./portfolio-publish.cjs');

test('assemble stamps generated_at from injected clock and wraps projects', () => {
  const dir = mkTmp();
  fs.writeFileSync(path.join(dir, 'project_x.md'), BLOCK(valid));
  const doc = assemble(dir, '2026-06-11T10:00:00Z');
  assert.equal(doc.generated_at, '2026-06-11T10:00:00Z');
  assert.equal(doc.projects.length, 1);
  assert.ok(!('warnings' in doc)); // warnings are logged, not published
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/.claude && node --test hooks/portfolio-publish.test.cjs`
Expected: FAIL — `assemble is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `portfolio-publish.cjs` before `module.exports`:

```javascript
// assemble wraps buildPortfolio output into the published document. The clock
// is injected (nowISO) so the function is testable and resume-safe.
function assemble(memoryDir, nowISO) {
  const { projects, warnings } = buildPortfolio(memoryDir);
  for (const w of warnings) process.stderr.write(`[portfolio] WARN ${w}\n`);
  return { generated_at: nowISO, projects };
}
```

Update exports and add the CLI:

```javascript
module.exports = { buildPortfolio, assemble };

if (require.main === module) {
  const [memoryDir, outFile] = process.argv.slice(2);
  if (!memoryDir || !outFile) {
    process.stderr.write('usage: portfolio-publish.cjs <memoryDir> <outFile> [--now=<iso>]\n');
    process.exit(2);
  }
  const nowArg = process.argv.find((a) => a.startsWith('--now='));
  const nowISO = nowArg ? nowArg.slice('--now='.length) : new Date().toISOString();
  const doc = assemble(memoryDir, nowISO);
  fs.writeFileSync(outFile, JSON.stringify(doc, null, 2) + '\n');
  process.stderr.write(`[portfolio] wrote ${doc.projects.length} projects to ${outFile}\n`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/.claude && node --test hooks/portfolio-publish.test.cjs`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/.claude
git add hooks/portfolio-publish.cjs hooks/portfolio-publish.test.cjs
git commit -m "feat(portfolio): assemble + CLI (writes portfolio.json) (S1)"
```

---

## Task 3: Publisher — `/publish-portfolio` command

**Files:**
- Create: `~/.claude/commands/publish-portfolio.md`

- [ ] **Step 1: Write the command doc**

```markdown
---
description: Regenerate portfolio.json from memory roadmap blocks and push it to Meta-Psy/portfolio-data.
---

Publish the project portfolio for the S1 Mission Control dashboard.

Steps:
1. Ensure a local clone of the data repo exists at `~/.claude/.cache/portfolio-data`
   (clone `https://github.com/Meta-Psy/portfolio-data.git` there if missing; otherwise `git -C` pull).
2. Run the publisher:
   `node ~/.claude/hooks/portfolio-publish.cjs ~/.claude/projects/C--Users-Alex/memory ~/.claude/.cache/portfolio-data/portfolio.json`
3. Review the diff: `git -C ~/.claude/.cache/portfolio-data diff`. Confirm NO secrets or body prose leaked (only roadmap fields).
4. Commit + push from inside the clone:
   `git -C ~/.claude/.cache/portfolio-data add portfolio.json`
   `git -C ~/.claude/.cache/portfolio-data commit -m "chore: refresh portfolio $(date -u +%FT%TZ)"`
   `git -C ~/.claude/.cache/portfolio-data push origin main`
5. Report the project count and any `[portfolio] WARN` lines from stderr.

Notes:
- `.cache/` is gitignored in `~/.claude` (verify it is; add if not). The clone is operational, not tracked.
- The push target repo and the read-PAT scope are [ALEX] gates — if the clone/push fails on auth, stop and tell Alex.
```

- [ ] **Step 2: Verify gitignore for the cache clone**

Run: `cd ~/.claude && grep -q '.cache' .gitignore && echo OK || echo "ADD .cache/ to .gitignore"`
Expected: `OK`. If not, add `.cache/` to `~/.claude/.gitignore` in this commit.

- [ ] **Step 3: Commit**

```bash
cd ~/.claude
git add commands/publish-portfolio.md .gitignore
git commit -m "feat(portfolio): /publish-portfolio command (S1)"
```

> **[ALEX] gate before this command can run end-to-end:** create private repo `Meta-Psy/portfolio-data` with a `main` branch and an initial empty `portfolio.json` (`{"generated_at":"","projects":[]}`).

---

## Task 4: Backend — `GitHubClient.GetFileContent`

**Files:**
- Modify: `internal/web/github.go`
- Test: `internal/web/github_test.go`

- [ ] **Step 1: Write the failing test**

```go
func TestGetFileContent(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/repos/o/data/contents/portfolio.json" {
			t.Errorf("path = %s", r.URL.Path)
		}
		// GitHub returns base64 with embedded newlines.
		b64 := base64.StdEncoding.EncodeToString([]byte(`{"hello":"world"}`))
		half := len(b64) / 2
		w.Write([]byte(`{"encoding":"base64","content":"` + b64[:half] + "\\n" + b64[half:] + `"}`))
	}))
	defer srv.Close()

	c := &GitHubClient{BaseURL: srv.URL, HTTP: srv.Client()}
	got, err := c.GetFileContent(context.Background(), "o/data", "portfolio.json")
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if string(got) != `{"hello":"world"}` {
		t.Errorf("content = %q", got)
	}
}
```

Add `"encoding/base64"` to the test imports if missing.

- [ ] **Step 2: Run test to verify it fails**

Run (Docker, no native Go):
```bash
cd /c/Users/Alex/10_Projects/praktor
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src \
  -v praktor-gocache:/root/.cache/go-build -v praktor-gomod:/go/pkg/mod \
  golang:1.26rc1 go test ./internal/web -run TestGetFileContent
```
Expected: FAIL — `c.GetFileContent undefined`.

- [ ] **Step 3: Write minimal implementation**

Add to `internal/web/github.go` (add `"encoding/base64"` and `"strings"` to imports):

```go
// GetFileContent fetches a file's raw bytes from repo at path via the contents API.
func (c *GitHubClient) GetFileContent(ctx context.Context, repo, path string) ([]byte, error) {
	var raw struct {
		Content  string `json:"content"`
		Encoding string `json:"encoding"`
	}
	if err := c.get(ctx, "/repos/"+repo+"/contents/"+path, &raw); err != nil {
		return nil, err
	}
	if raw.Encoding != "base64" {
		return nil, fmt.Errorf("github contents %s: unexpected encoding %q", path, raw.Encoding)
	}
	return base64.StdEncoding.DecodeString(strings.ReplaceAll(raw.Content, "\n", ""))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: same Docker command as Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Alex/10_Projects/praktor
git add internal/web/github.go internal/web/github_test.go
git commit -m "feat(web): GitHubClient.GetFileContent for portfolio data repo (S1)"
```

---

## Task 5: Backend — portfolio reader, cache, handler

**Files:**
- Create: `internal/web/portfolio.go`
- Test: `internal/web/portfolio_test.go`

- [ ] **Step 1: Write the failing tests**

```go
package web

import (
	"context"
	"errors"
	"net/http/httptest"
	"testing"
	"time"
)

type fakePortfolioGH struct {
	data []byte
	err  error
}

func (f *fakePortfolioGH) GetFileContent(ctx context.Context, repo, path string) ([]byte, error) {
	return f.data, f.err
}

func TestPortfolioReader_Parses(t *testing.T) {
	gh := &fakePortfolioGH{data: []byte(`{"generated_at":"2026-06-11T10:00:00Z","projects":[{"key":"k","name":"N","status":"active","directions":[{"title":"d","state":"done"}]}]}`)}
	r := &portfolioReader{gh: gh, repo: "o/data", path: "portfolio.json"}
	p, err := r.read(context.Background())
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if len(p.Projects) != 1 || p.Projects[0].Key != "k" || p.Projects[0].Directions[0].State != "done" {
		t.Errorf("parsed: %+v", p)
	}
}

func TestPortfolioCache_ServesStaleOnError(t *testing.T) {
	good := []byte(`{"projects":[{"key":"k","name":"N","status":"active","directions":[]}]}`)
	gh := &fakePortfolioGH{data: good}
	r := &portfolioReader{gh: gh, repo: "o/data", path: "portfolio.json"}
	c := &portfolioCache{ttl: time.Minute, now: func() time.Time { return time.Unix(0, 0) }}

	resp := c.get(r.read) // first fetch: fresh, ok
	if resp.Stale || len(resp.Projects) != 1 {
		t.Fatalf("first: %+v", resp)
	}

	gh.err = errors.New("boom") // repo now unreachable
	gh.data = nil
	c.now = func() time.Time { return time.Unix(3600, 0) } // past TTL → refetch attempted
	resp = c.get(r.read)
	if !resp.Stale || len(resp.Projects) != 1 || resp.FetchError == "" {
		t.Errorf("stale serve failed: %+v", resp)
	}
}

func TestHandlePortfolio_NotConfigured(t *testing.T) {
	s := &Server{} // no portfolio reader
	req := httptest.NewRequest("GET", "/api/portfolio", nil)
	w := httptest.NewRecorder()
	s.handlePortfolio(w, req)
	if w.Code != 503 {
		t.Errorf("code = %d, want 503", w.Code)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `... golang:1.26rc1 go test ./internal/web -run TestPortfolio`
Expected: FAIL — undefined `portfolioReader`, `portfolioCache`, `handlePortfolio`.

- [ ] **Step 3: Write minimal implementation**

```go
package web

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"
)

// Direction is one roadmap item with its lane.
type Direction struct {
	Title string `json:"title"`
	State string `json:"state"` // planned|doing|done
}

// PortfolioProject is one project's roadmap, as published to the data repo.
type PortfolioProject struct {
	Key        string      `json:"key"`
	Name       string      `json:"name"`
	Status     string      `json:"status"` // active|paused|done
	NextAction string      `json:"next_action,omitempty"`
	McKey      string      `json:"mc_key,omitempty"`
	Directions []Direction `json:"directions"`
}

// Portfolio is the published document.
type Portfolio struct {
	GeneratedAt string             `json:"generated_at"`
	Projects    []PortfolioProject `json:"projects"`
}

// portfolioResponse is what the API returns: the portfolio plus degradation flags.
type portfolioResponse struct {
	Portfolio
	Stale      bool   `json:"stale,omitempty"`
	FetchError string `json:"fetch_error,omitempty"`
}

// portfolioFetcher is the read surface the reader needs (mockable in tests).
type portfolioFetcher interface {
	GetFileContent(ctx context.Context, repo, path string) ([]byte, error)
}

type portfolioReader struct {
	gh   portfolioFetcher
	repo string
	path string
}

func (r *portfolioReader) read(ctx context.Context) (Portfolio, error) {
	raw, err := r.gh.GetFileContent(ctx, r.repo, r.path)
	if err != nil {
		return Portfolio{}, err
	}
	var p Portfolio
	if err := json.Unmarshal(raw, &p); err != nil {
		return Portfolio{}, err
	}
	return p, nil
}

// portfolioCache memoizes the last good portfolio and serves it (flagged stale)
// when a refetch fails, so a transient data-repo outage doesn't blank the page.
type portfolioCache struct {
	ttl  time.Duration
	now  func() time.Time
	mu   sync.Mutex
	at   time.Time
	last *Portfolio
}

func (c *portfolioCache) get(read func(context.Context) (Portfolio, error)) portfolioResponse {
	nowFn := time.Now
	if c.now != nil {
		nowFn = c.now
	}

	c.mu.Lock()
	if c.last != nil && nowFn().Sub(c.at) < c.ttl {
		resp := portfolioResponse{Portfolio: *c.last}
		c.mu.Unlock()
		return resp
	}
	c.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	p, err := read(ctx)
	if err != nil {
		c.mu.Lock()
		defer c.mu.Unlock()
		if c.last != nil {
			return portfolioResponse{Portfolio: *c.last, Stale: true, FetchError: err.Error()}
		}
		return portfolioResponse{Stale: true, FetchError: err.Error()}
	}

	c.mu.Lock()
	c.last = &p
	c.at = nowFn()
	c.mu.Unlock()
	return portfolioResponse{Portfolio: p}
}

// handlePortfolio is the GET /api/portfolio handler.
func (s *Server) handlePortfolio(w http.ResponseWriter, r *http.Request) {
	if s.portfolio == nil || s.portfolioCache == nil {
		jsonError(w, "portfolio not configured", http.StatusServiceUnavailable)
		return
	}
	jsonResponse(w, s.portfolioCache.get(s.portfolio.read))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `... golang:1.26rc1 go test ./internal/web -run TestPortfolio`
Expected: PASS (3 tests). (`handlePortfolio` references `s.portfolio`/`s.portfolioCache` — added in Task 6; this task compiles because those fields are added there. If running this task standalone, add the two fields to the `Server` struct first — see Task 6 Step 3.)

> **Note for executor:** add the two `Server` fields from Task 6 Step 3 together with this file so the package compiles. They are split across tasks only for narrative clarity.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Alex/10_Projects/praktor
git add internal/web/portfolio.go internal/web/portfolio_test.go
git commit -m "feat(web): portfolio reader + stale-tolerant cache + handler (S1)"
```

---

## Task 6: Backend — wire reader from env + register route

**Files:**
- Modify: `internal/web/server.go` (add fields + construct reader)
- Modify: `internal/web/api.go` (register route)

- [ ] **Step 1: Add fields to the `Server` struct**

In `internal/web/server.go`, add to the `Server` struct (after `deploys`):

```go
	portfolio      *portfolioReader // S1 portfolio data-repo reader
	portfolioCache *portfolioCache  // S1 portfolio cache
```

- [ ] **Step 2: Construct the reader in `NewServer`**

In `NewServer`, after the `if len(srv.projects) > 0 { ... }` block, add:

```go
	if repo := os.Getenv("PORTFOLIO_DATA_REPO"); repo != "" {
		srv.portfolio = &portfolioReader{
			gh:   &GitHubClient{Token: os.Getenv("GITHUB_READ_TOKEN")},
			repo: repo,
			path: "portfolio.json",
		}
		srv.portfolioCache = &portfolioCache{ttl: 60 * time.Second}
	}
```

- [ ] **Step 3: Register the route**

In `internal/web/api.go`, under the `// Projects roll-up` block, add:

```go
	// Portfolio dashboard (S1)
	mux.HandleFunc("GET /api/portfolio", s.handlePortfolio)
```

- [ ] **Step 4: Verify the package builds and all backend tests pass**

Run:
```bash
cd /c/Users/Alex/10_Projects/praktor
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src \
  -v praktor-gocache:/root/.cache/go-build -v praktor-gomod:/go/pkg/mod \
  golang:1.26rc1 sh -c "gofmt -l internal/web && go vet ./internal/web && go test ./internal/web && go build ./..."
```
Expected: no gofmt output, vet clean, tests PASS, build OK.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Alex/10_Projects/praktor
git add internal/web/server.go internal/web/api.go
git commit -m "feat(web): wire PORTFOLIO_DATA_REPO env + GET /api/portfolio route (S1)"
```

---

## Task 7: UI — `portfolioStatus.ts` helpers

**Files:**
- Create: `ui/src/pages/portfolioStatus.ts`
- Test: `ui/src/__tests__/portfolioStatus.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { percent, groupByLane, type PortfolioProject } from '../pages/portfolioStatus';

const proj: PortfolioProject = {
  key: 'k', name: 'N', status: 'active',
  directions: [
    { title: 'a', state: 'done' },
    { title: 'b', state: 'done' },
    { title: 'c', state: 'doing' },
    { title: 'd', state: 'planned' },
  ],
};

describe('percent', () => {
  it('is done / total rounded', () => {
    expect(percent(proj.directions)).toBe(50); // 2 of 4
  });
  it('is 0 for no directions', () => {
    expect(percent([])).toBe(0);
  });
});

describe('groupByLane', () => {
  it('buckets directions into planned/doing/done', () => {
    const g = groupByLane(proj.directions);
    expect(g.planned.map((d) => d.title)).toEqual(['d']);
    expect(g.doing.map((d) => d.title)).toEqual(['c']);
    expect(g.done.map((d) => d.title)).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /c/Users/Alex/10_Projects/praktor/ui && npm test -- portfolioStatus`
Expected: FAIL — cannot resolve `../pages/portfolioStatus`.

- [ ] **Step 3: Write minimal implementation**

```typescript
export type Lane = 'planned' | 'doing' | 'done';
export interface Direction { title: string; state: Lane }
export interface PortfolioProject {
  key: string; name: string; status: 'active' | 'paused' | 'done';
  next_action?: string; mc_key?: string; directions: Direction[];
}
export interface Portfolio {
  generated_at?: string; projects: PortfolioProject[];
  stale?: boolean; fetch_error?: string;
}

export function percent(directions: Direction[]): number {
  if (directions.length === 0) return 0;
  const done = directions.filter((d) => d.state === 'done').length;
  return Math.round((done / directions.length) * 100);
}

export function groupByLane(directions: Direction[]): Record<Lane, Direction[]> {
  return {
    planned: directions.filter((d) => d.state === 'planned'),
    doing: directions.filter((d) => d.state === 'doing'),
    done: directions.filter((d) => d.state === 'done'),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /c/Users/Alex/10_Projects/praktor/ui && npm test -- portfolioStatus`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Alex/10_Projects/praktor
git add ui/src/pages/portfolioStatus.ts ui/src/__tests__/portfolioStatus.test.ts
git commit -m "feat(ui): portfolioStatus helpers — percent + lane grouping (S1)"
```

---

## Task 8: UI — `Portfolio.tsx` page

**Files:**
- Create: `ui/src/pages/Portfolio.tsx`

- [ ] **Step 1: Write the page**

```tsx
import { useState, useEffect, useCallback } from 'react';
import { percent, groupByLane, type Portfolio as PortfolioDoc, type PortfolioProject } from './portfolioStatus';
import { ciLabel, deployLabel, type ProjectStatus } from './projectStatus';

const card: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: 10, padding: 16, boxShadow: 'var(--shadow)', marginBottom: 12,
};
const lane: React.CSSProperties = { flex: 1, minWidth: 0 };
const STATUS_COLOR: Record<string, string> = { active: 'var(--accent)', paused: '#b8860b', done: 'var(--text-secondary)' };

function Portfolio() {
  const [doc, setDoc] = useState<PortfolioDoc | null>(null);
  const [live, setLive] = useState<Record<string, ProjectStatus>>({});
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const fetchAll = useCallback(() => {
    fetch('/api/portfolio')
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then(setDoc)
      .catch((err) => setError(err.message));
    fetch('/api/projects')
      .then((res) => (res.ok ? res.json() : []))
      .then((arr: ProjectStatus[]) => {
        const map: Record<string, ProjectStatus> = {};
        for (const p of arr) map[p.name] = p;
        setLive(map);
      })
      .catch(() => { /* live chip is best-effort */ });
  }, []);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 60000);
    return () => clearInterval(id);
  }, [fetchAll]);

  if (error) return <div style={{ color: 'var(--danger, #c00)' }}>Error: {error}</div>;
  if (!doc) return <div>Loading…</div>;

  return (
    <div>
      <h1 style={{ marginBottom: 8 }}>Portfolio</h1>
      {doc.stale && (
        <div style={{ color: '#b8860b', marginBottom: 12 }}>
          ⚠ stale data{doc.fetch_error ? `: ${doc.fetch_error}` : ''}
        </div>
      )}
      {doc.projects.map((p: PortfolioProject) => {
        const pct = percent(p.directions);
        const lv = p.mc_key ? live[p.mc_key] : undefined;
        const isOpen = open === p.key;
        const lanes = groupByLane(p.directions);
        return (
          <div key={p.key} style={card}>
            <div
              onClick={() => setOpen(isOpen ? null : p.key)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 4, background: STATUS_COLOR[p.status] || 'var(--text-secondary)' }} />
              <strong style={{ fontSize: 16, flex: 1 }}>{p.name}</strong>
              {lv && <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>CI {ciLabel(lv.ci)} · {deployLabel(lv.deploy)}</span>}
              <span style={{ fontSize: 13, color: 'var(--text-secondary)', minWidth: 36, textAlign: 'right' }}>{pct}%</span>
            </div>
            <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, marginTop: 8 }}>
              <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', borderRadius: 2 }} />
            </div>
            {p.next_action && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6 }}>next: {p.next_action}</div>}
            {isOpen && (
              <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
                {(['planned', 'doing', 'done'] as const).map((k) => (
                  <div key={k} style={lane}>
                    <div style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 4 }}>{k}</div>
                    {lanes[k].map((d, i) => (
                      <div key={i} style={{ fontSize: 13, padding: '4px 0', borderTop: '1px solid var(--border)' }}>{d.title}</div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default Portfolio;
```

- [ ] **Step 2: Verify type-check + build**

Run: `cd /c/Users/Alex/10_Projects/praktor/ui && npm run build`
Expected: build succeeds (tsc + vite). Fix any type errors before committing.

- [ ] **Step 3: Commit**

```bash
cd /c/Users/Alex/10_Projects/praktor
git add ui/src/pages/Portfolio.tsx
git commit -m "feat(ui): Portfolio page — overview rows + drill-down lanes (S1)"
```

---

## Task 9: UI — nav + route wiring

**Files:**
- Modify: `ui/src/App.tsx`

- [ ] **Step 1: Add the lazy import**

Next to the other `lazy(() => import(...))` lines (near line 12):

```tsx
const Portfolio = lazy(() => import('./pages/Portfolio'));
```

- [ ] **Step 2: Add an icon component**

Near the other `IconXxx` components, add:

```tsx
function IconPortfolio() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="3" width="12" height="10" rx="1" />
      <path d="M2 6h12M6 3v3" />
    </svg>
  );
}
```

- [ ] **Step 3: Add the nav item**

In `navItems`, add after the `/projects` entry:

```tsx
  { to: '/portfolio', label: 'Portfolio', Icon: IconPortfolio },
```

- [ ] **Step 4: Add the route**

In `<Routes>`, add after the `/projects` route:

```tsx
            <Route path="/portfolio" element={<Portfolio />} />
```

- [ ] **Step 5: Verify build, then commit**

Run: `cd /c/Users/Alex/10_Projects/praktor/ui && npm run build`
Expected: build succeeds.

```bash
cd /c/Users/Alex/10_Projects/praktor
git add ui/src/App.tsx
git commit -m "feat(ui): Portfolio nav item + route (S1)"
```

---

## Task 10: Seed roadmap blocks into active memory files

**Files:**
- Modify: `~/.claude/projects/C--Users-Alex/memory/project_claude_optimization.md` (and 2-3 other active projects, e.g. `project_mentis_platform.md`, `project_pdai_calculator.md`)

- [ ] **Step 1: Add a ` ```roadmap ` block** to each active project file (body, after the status section), per the contract in this plan. Use `mc_key` only where a `/api/projects` entry exists (`pdai`, `gnathology`, `praktor`).

- [ ] **Step 2: Dry-run the publisher locally** (writes to a temp file, no push)

Run:
```bash
node ~/.claude/hooks/portfolio-publish.cjs ~/.claude/projects/C--Users-Alex/memory /tmp/portfolio.json --now=2026-06-11T00:00:00Z
cat /tmp/portfolio.json
```
Expected: JSON with the seeded projects, no PII files, no `[portfolio] WARN` lines for the seeded files.

- [ ] **Step 3: Commit the memory edits** (local `~/.claude`, Alex approves diff)

```bash
cd ~/.claude
git add projects/C--Users-Alex/memory/project_*.md
git commit -m "docs(memory): seed roadmap blocks for S1 portfolio dashboard"
```

---

## [ALEX] gates (prod — classifier blocks; Alex executes)

1. **Create** private repo `Meta-Psy/portfolio-data` (branch `main`, initial `portfolio.json` = `{"generated_at":"","projects":[]}`).
2. **Read-PAT scope:** add `portfolio-data` to the fine-grained `GITHUB_READ_TOKEN` already on the server (contents:read).
3. **Server env:** add `PORTFOLIO_DATA_REPO=Meta-Psy/portfolio-data` to `~/praktor/.env` + pass through in the orchestrator `environment:` (alongside `GITHUB_READ_TOKEN`).
4. **Rebuild + recreate** the orchestrator image with the S1 backend (root Dockerfile → `praktor:s1` or reuse the rolling tag) + `docker compose up -d`.
5. **Approve** the `~/.claude` publisher diff (process rule #2) and run `/publish-portfolio` once to populate the data repo.
6. **Verify** from phone: `mc.alexmetapsy.com` → Portfolio page shows seeded projects, drill-down opens lanes, live chip appears for `pdai`/`gnathology`.

---

## Self-review

- **Spec coverage:** D1 hybrid source → Tasks 1/5/8 (roadmap block + GitHub read + client merge); D2 opt-in + PII carve-out → Task 1 (skip-no-block + PII name-list, tested); D3 read-only → no action handlers added; D4 overview+drill-down → Task 8; D5 transport private repo + F.2 client → Tasks 3/4/5/6; D6 extend MC React → Tasks 8/9. All covered.
- **Placeholder scan:** every code step contains full code; no TBD/TODO.
- **Type consistency:** Go `PortfolioProject`/`Direction`/`Portfolio` used identically in `portfolio.go` and tests; TS `PortfolioProject`/`Direction`/`Lane` consistent across `portfolioStatus.ts`, `Portfolio.tsx`, tests; JSON field names (`key`,`name`,`status`,`next_action`,`mc_key`,`directions`,`title`,`state`,`generated_at`,`stale`,`fetch_error`) match between publisher output, Go structs, and TS interfaces.
- **Cross-repo note:** Task 5's `handlePortfolio` depends on the two `Server` fields added in Task 6 Step 1 — flagged inline so the executor adds them together.
```
