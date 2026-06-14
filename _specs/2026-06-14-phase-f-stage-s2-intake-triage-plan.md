# S2 — Intake & Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Захват задач Claude'у с устройства (MC-web форма + Telegram, голос/фото/текст) → durable GitHub-очередь → триаж 3 маршрута дренируется локальным CC.

**Architecture:** Новый пакет `internal/intake` (item-схема + GitHub-очередь записи + TG-поллер) переиспользует `internal/speech` (STT). Пакет `web` получает `POST /api/intake` (захват) и `GET /api/intake` (ридер+stale-cache по образцу `portfolio.go`). React-страница Intake. Команда `/intake-drain` в `~/.claude` триажит/роутит. Исполнитель MVP — локальный CC за интерфейсом очереди (серверный — апгрейд позже).

**Tech Stack:** Go 1.26 (Docker `golang:1.26rc1` + `GOTOOLCHAIN=auto`), telego, OpenAI Whisper STT, React+Vite+vitest, GitHub Contents API, zero-dep Node для команды.

**Репозитории/ветки:**
- praktor-форк `Meta-Psy/praktor`, ветка `feature/s2-intake-triage` (design+plan уже там).
- `~/.claude` (локальный no-remote config-репо), текущая ветка — точечный commit команды.

**Очередь (формат):** приватный репо `Meta-Psy/intake-queue`, один item = файл `items/<id>.json`; медиа = `items/<id>/<name>`. Create-файлы не конфликтуют (без SHA); update — по SHA. Reader листает `items/`. Дренаж архивирует done → `items/` мал.

---

## Файловая структура

**Создать:**
- `internal/intake/item.go` — тип `Item`, `Assemble`, статус-константы, `ValidTransition`.
- `internal/intake/item_test.go`
- `internal/intake/queue.go` — `Queue` (GitHub-запись `items/<id>.json` + медиа).
- `internal/intake/queue_test.go`
- `internal/intake/telegram.go` — `Poller` (telego long-poll → `Item` → `Queue`).
- `internal/intake/telegram_test.go`
- `internal/web/intake.go` — read-ридер + `intakeCache` + `GET /api/intake` + `POST /api/intake`.
- `internal/web/intake_test.go`
- `ui/src/pages/intakeStatus.ts` — типы + хелперы.
- `ui/src/pages/__tests__/intakeStatus.test.ts`
- `ui/src/pages/Intake.tsx` — форма захвата + список.
- `~/.claude/commands/intake-drain.md` — команда дренажа/триажа.

**Изменить:**
- `internal/web/github.go` — добавить `ListDir`.
- `internal/web/server.go:44-71,73-113` — поля Server + проводка `INTAKE_QUEUE_REPO`.
- `internal/web/api.go:79-80` — маршруты `POST/GET /api/intake`.
- `internal/config/config.go:12-24,54-58,198-228` — `IntakeConfig` + env `INTAKE_TELEGRAM_TOKEN`.
- `cmd/praktor/main.go` — старт TG-поллера (gated `cfg.Intake.TelegramToken`; большой бот off).
- `ui/src/App.tsx:13,142-161,398-408` — nav + route Intake.

---

## Task 1: intake-core — тип Item + Assemble + статус-машина

**Files:**
- Create: `internal/intake/item.go`
- Test: `internal/intake/item_test.go`

- [ ] **Step 1: Write failing test**

```go
package intake

import (
	"testing"
	"time"
)

func TestAssemble(t *testing.T) {
	now := time.Date(2026, 6, 14, 9, 30, 0, 0, time.UTC)
	it := Assemble("web", "fix typo in pdai readme", []string{"items/x/photo.jpg"}, "pdai", now, "ab12")
	if it.ID != "20260614T093000Z-ab12" {
		t.Fatalf("id = %q", it.ID)
	}
	if it.Source != "web" || it.RawText != "fix typo in pdai readme" || it.TargetProject != "pdai" {
		t.Fatalf("fields: %+v", it)
	}
	if it.Status != StatusQueued {
		t.Fatalf("status = %q, want queued", it.Status)
	}
	if len(it.Media) != 1 || it.Media[0] != "items/x/photo.jpg" {
		t.Fatalf("media = %v", it.Media)
	}
	if it.CreatedAt != "2026-06-14T09:30:00Z" || it.UpdatedAt != it.CreatedAt {
		t.Fatalf("timestamps: created=%q updated=%q", it.CreatedAt, it.UpdatedAt)
	}
}

func TestValidTransition(t *testing.T) {
	cases := []struct {
		from, to string
		want     bool
	}{
		{StatusQueued, StatusTriaged, true},
		{StatusTriaged, StatusInProgress, true},
		{StatusInProgress, StatusDone, true},
		{StatusTriaged, StatusAwaitingApproval, true},
		{StatusTriaged, StatusNeedsDesign, true},
		{StatusQueued, StatusNeedsClarification, true},
		{StatusQueued, StatusError, true},
		{StatusDone, StatusQueued, false},
		{StatusDone, StatusInProgress, false},
		{"bogus", StatusDone, false},
	}
	for _, c := range cases {
		if got := ValidTransition(c.from, c.to); got != c.want {
			t.Errorf("ValidTransition(%q,%q) = %v, want %v", c.from, c.to, got, c.want)
		}
	}
}
```

- [ ] **Step 2: Run test — verify FAIL**

Run: `docker run --rm -v "$PWD":/src -w /src -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/intake/ -run 'TestAssemble|TestValidTransition' -v`
Expected: FAIL (package/identifiers undefined).

- [ ] **Step 3: Implement `internal/intake/item.go`**

```go
// Package intake captures device-originated tasks for Claude and queues them
// for triage. It is transport-agnostic: web and Telegram adapters both produce
// the same Item, persisted to a GitHub queue repo.
package intake

import "time"

// Status values for an intake Item through its lifecycle.
const (
	StatusQueued             = "queued"
	StatusTriaged            = "triaged"
	StatusInProgress         = "in_progress"
	StatusDone               = "done"
	StatusAwaitingApproval   = "awaiting-approval"
	StatusNeedsDesign        = "needs-design"
	StatusNeedsClarification = "needs-clarification"
	StatusError              = "error"
)

// Route values assigned by triage (reuses Auditor taxonomy).
const (
	RouteTrivial  = "trivial"  // TRIVIAL → auto-implement
	RouteStandard = "standard" // STANDARD → plan for approval
	RouteComplex  = "complex"  // COMPLEX → S3 / needs-design, never auto
)

// Item is one captured task.
type Item struct {
	ID            string   `json:"id"`
	Source        string   `json:"source"` // web|telegram
	RawText       string   `json:"raw_text"`
	Media         []string `json:"media,omitempty"`
	TargetProject string   `json:"target_project,omitempty"`
	Route         string   `json:"route,omitempty"`
	Status        string   `json:"status"`
	CreatedAt     string   `json:"created_at"`
	UpdatedAt     string   `json:"updated_at"`
}

// Assemble builds a queued Item. idSuffix is supplied by the caller (random in
// production, fixed in tests) so the function stays pure and testable.
func Assemble(source, rawText string, media []string, targetProject string, now time.Time, idSuffix string) Item {
	ts := now.UTC()
	iso := ts.Format(time.RFC3339)
	return Item{
		ID:            ts.Format("20060102T150405Z") + "-" + idSuffix,
		Source:        source,
		RawText:       rawText,
		Media:         media,
		TargetProject: targetProject,
		Status:        StatusQueued,
		CreatedAt:     iso,
		UpdatedAt:     iso,
	}
}

// transitions maps each status to the statuses it may move to.
var transitions = map[string][]string{
	StatusQueued:           {StatusTriaged, StatusNeedsClarification, StatusError},
	StatusTriaged:          {StatusInProgress, StatusAwaitingApproval, StatusNeedsDesign, StatusError},
	StatusInProgress:       {StatusDone, StatusError},
	StatusAwaitingApproval: {StatusInProgress, StatusDone, StatusError},
	StatusNeedsDesign:      {StatusInProgress, StatusError},
}

// ValidTransition reports whether status may move from → to.
func ValidTransition(from, to string) bool {
	for _, allowed := range transitions[from] {
		if allowed == to {
			return true
		}
	}
	return false
}
```

- [ ] **Step 4: Run test — verify PASS**

Run: same as Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/intake/item.go internal/intake/item_test.go
git commit -m "feat(intake): Item schema, Assemble, status machine (S2)"
```

---

## Task 2: intake-core — GitHub queue writer

**Files:**
- Create: `internal/intake/queue.go`
- Test: `internal/intake/queue_test.go`

**Context:** Mirrors `internal/web/github_write.go` `do()` (status-aware error surfacing). Create-file (no sha) accepts 201; update (with sha) accepts 200.

- [ ] **Step 1: Write failing test**

```go
package intake

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestQueuePut(t *testing.T) {
	var gotPath, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			t.Errorf("method = %s", r.Method)
		}
		gotPath = r.URL.Path
		b := make([]byte, r.ContentLength)
		_, _ = r.Body.Read(b)
		gotBody = string(b)
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	q := &Queue{Token: "t", Repo: "Meta-Psy/intake-queue", BaseURL: srv.URL, HTTP: srv.Client()}
	it := Assemble("web", "hello", nil, "", time.Unix(0, 0).UTC(), "zz")
	if err := q.Put(context.Background(), it); err != nil {
		t.Fatalf("Put: %v", err)
	}
	if gotPath != "/repos/Meta-Psy/intake-queue/contents/items/"+it.ID+".json" {
		t.Fatalf("path = %s", gotPath)
	}
	var body struct {
		Message string `json:"message"`
		Content string `json:"content"`
	}
	if err := json.Unmarshal([]byte(gotBody), &body); err != nil {
		t.Fatalf("body not json: %v", err)
	}
	if !strings.Contains(body.Message, it.ID) || body.Content == "" {
		t.Fatalf("body = %+v", body)
	}
}

func TestQueuePutMedia(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()
	q := &Queue{Token: "t", Repo: "r/q", BaseURL: srv.URL, HTTP: srv.Client()}
	path, err := q.PutMedia(context.Background(), "id1", "photo.jpg", []byte{1, 2, 3})
	if err != nil {
		t.Fatalf("PutMedia: %v", err)
	}
	if path != "items/id1/photo.jpg" {
		t.Fatalf("path = %s", path)
	}
}
```

- [ ] **Step 2: Run test — verify FAIL**

Run: `docker run --rm -v "$PWD":/src -w /src -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/intake/ -run 'TestQueue' -v`
Expected: FAIL (`Queue` undefined).

- [ ] **Step 3: Implement `internal/intake/queue.go`**

```go
package intake

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Queue writes intake Items and media to a GitHub data repo via the Contents API.
// Token comes from GITHUB_WRITE_TOKEN (same write-PAT as Mission Control actions).
type Queue struct {
	Token   string
	Repo    string // owner/name
	BaseURL string // default https://api.github.com
	HTTP    *http.Client
}

func (q *Queue) base() string {
	if q.BaseURL != "" {
		return q.BaseURL
	}
	return "https://api.github.com"
}

func (q *Queue) httpClient() *http.Client {
	if q.HTTP != nil {
		return q.HTTP
	}
	return &http.Client{Timeout: 15 * time.Second}
}

// putFile creates or updates a file. sha empty = create (expects 201);
// sha set = update (expects 200).
func (q *Queue) putFile(ctx context.Context, path string, content []byte, message, sha string) error {
	body := map[string]string{
		"message": message,
		"content": base64.StdEncoding.EncodeToString(content),
	}
	if sha != "" {
		body["sha"] = sha
	}
	b, err := json.Marshal(body)
	if err != nil {
		return err
	}
	url := fmt.Sprintf("%s/repos/%s/contents/%s", q.base(), q.Repo, path)
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, url, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Content-Type", "application/json")
	if q.Token != "" {
		req.Header.Set("Authorization", "Bearer "+q.Token)
	}
	resp, err := q.httpClient().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		var ge struct {
			Message string `json:"message"`
		}
		_ = json.Unmarshal(raw, &ge)
		if ge.Message != "" {
			return fmt.Errorf("github put %s: %s (%s)", path, ge.Message, resp.Status)
		}
		return fmt.Errorf("github put %s: %s", path, resp.Status)
	}
	return nil
}

// Put writes items/<id>.json (create).
func (q *Queue) Put(ctx context.Context, it Item) error {
	data, err := json.MarshalIndent(it, "", "  ")
	if err != nil {
		return err
	}
	return q.putFile(ctx, "items/"+it.ID+".json", data, "intake: queue "+it.ID, "")
}

// PutMedia writes items/<id>/<name> and returns its repo-relative path.
func (q *Queue) PutMedia(ctx context.Context, id, name string, data []byte) (string, error) {
	path := fmt.Sprintf("items/%s/%s", id, name)
	if err := q.putFile(ctx, path, data, "intake: media "+id+"/"+name, ""); err != nil {
		return "", err
	}
	return path, nil
}
```

- [ ] **Step 4: Run test — verify PASS**

Run: same as Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/intake/queue.go internal/intake/queue_test.go
git commit -m "feat(intake): GitHub queue writer (items + media)"
```

---

## Task 3: web — ListDir on read client

**Files:**
- Modify: `internal/web/github.go` (add method after `GetFileContent`, ~line 90)
- Test: `internal/web/github_test.go` (add test)

- [ ] **Step 1: Write failing test (append to `github_test.go`)**

```go
func TestListDir(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/repos/r/q/contents/items" {
			t.Errorf("path = %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`[
			{"name":"a.json","path":"items/a.json","type":"file"},
			{"name":"b.json","path":"items/b.json","type":"file"},
			{"name":"sub","path":"items/sub","type":"dir"}
		]`))
	}))
	defer srv.Close()
	c := &GitHubClient{Token: "t", BaseURL: srv.URL, HTTP: srv.Client()}
	paths, err := c.ListDir(context.Background(), "r/q", "items")
	if err != nil {
		t.Fatalf("ListDir: %v", err)
	}
	if len(paths) != 2 || paths[0] != "items/a.json" || paths[1] != "items/b.json" {
		t.Fatalf("paths = %v", paths)
	}
}

func TestListDirMissingIsEmpty(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	c := &GitHubClient{Token: "t", BaseURL: srv.URL, HTTP: srv.Client()}
	paths, err := c.ListDir(context.Background(), "r/q", "items")
	if err != nil {
		t.Fatalf("ListDir on 404 should be empty, got err: %v", err)
	}
	if len(paths) != 0 {
		t.Fatalf("paths = %v, want empty", paths)
	}
}
```

> Note: `github_test.go` already imports `context`, `net/http`, `net/http/httptest`, `testing` (used by existing tests). If not, add them.

- [ ] **Step 2: Run test — verify FAIL**

Run: `docker run --rm -v "$PWD":/src -w /src -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/web/ -run TestListDir -v`
Expected: FAIL (`ListDir` undefined).

- [ ] **Step 3: Implement `ListDir` (add to `internal/web/github.go`)**

```go
// ListDir returns repo-relative paths of files (type=="file") directly under
// dir via the contents API. A missing directory (404) yields an empty slice,
// not an error, so an empty queue is not a failure.
func (c *GitHubClient) ListDir(ctx context.Context, repo, dir string) ([]string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base()+"/repos/"+repo+"/contents/"+dir, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	resp, err := c.httpClient().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("github listdir %s: %s", dir, resp.Status)
	}
	var entries []struct {
		Path string `json:"path"`
		Type string `json:"type"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&entries); err != nil {
		return nil, err
	}
	out := make([]string, 0, len(entries))
	for _, e := range entries {
		if e.Type == "file" {
			out = append(out, e.Path)
		}
	}
	return out, nil
}
```

- [ ] **Step 4: Run test — verify PASS**

Run: same as Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/web/github.go internal/web/github_test.go
git commit -m "feat(web): GitHubClient.ListDir for intake queue reader (S2)"
```

---

## Task 4: web — intake reader + stale-tolerant cache + GET handler

**Files:**
- Create: `internal/web/intake.go`
- Test: `internal/web/intake_test.go`

**Context:** Mirrors `internal/web/portfolio.go` (reader + cache + handler), reading `intake.Item` files listed by `ListDir`, newest first.

- [ ] **Step 1: Write failing test**

```go
package web

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/mtzanidakis/praktor/internal/intake"
)

type fakeIntakeFetcher struct {
	paths map[string][]string
	files map[string][]byte
	err   error
}

func (f *fakeIntakeFetcher) ListDir(_ context.Context, _, dir string) ([]string, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.paths[dir], nil
}
func (f *fakeIntakeFetcher) GetFileContent(_ context.Context, _, path string) ([]byte, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.files[path], nil
}

func TestIntakeReaderSortsNewestFirst(t *testing.T) {
	f := &fakeIntakeFetcher{
		paths: map[string][]string{"items": {"items/a.json", "items/b.json"}},
		files: map[string][]byte{
			"items/a.json": []byte(`{"id":"a","status":"queued","created_at":"2026-06-14T08:00:00Z"}`),
			"items/b.json": []byte(`{"id":"b","status":"done","created_at":"2026-06-14T10:00:00Z"}`),
		},
	}
	r := &intakeReader{gh: f, repo: "r/q"}
	items, err := r.list(context.Background())
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(items) != 2 || items[0].ID != "b" || items[1].ID != "a" {
		t.Fatalf("order = %v", items)
	}
}

func TestIntakeCacheServesStaleOnError(t *testing.T) {
	good := &fakeIntakeFetcher{
		paths: map[string][]string{"items": {"items/a.json"}},
		files: map[string][]byte{"items/a.json": []byte(`{"id":"a","status":"queued","created_at":"2026-06-14T08:00:00Z"}`)},
	}
	r := &intakeReader{gh: good, repo: "r/q"}
	now := time.Now()
	c := &intakeCache{ttl: time.Minute, now: func() time.Time { return now }}

	first := c.get(r.list)
	if first.Stale || len(first.Items) != 1 {
		t.Fatalf("first = %+v", first)
	}
	// Force expiry + failing fetch → stale served from cache.
	good.err = errors.New("boom")
	now = now.Add(2 * time.Minute)
	second := c.get(r.list)
	if !second.Stale || len(second.Items) != 1 || second.FetchError == "" {
		t.Fatalf("second = %+v", second)
	}
}

func TestHandleIntakeListUnconfigured(t *testing.T) {
	s := &Server{}
	rec := httptest.NewRecorder()
	s.handleIntakeList(rec, httptest.NewRequest(http.MethodGet, "/api/intake", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("code = %d", rec.Code)
	}
}

var _ = intake.Item{}
```

- [ ] **Step 2: Run test — verify FAIL**

Run: `docker run --rm -v "$PWD":/src -w /src -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/web/ -run TestIntake -v`
Expected: FAIL (`intakeReader` undefined).

- [ ] **Step 3: Implement `internal/web/intake.go` (reader + cache + GET handler; POST added in Task 5)**

```go
package web

import (
	"context"
	"encoding/json"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/mtzanidakis/praktor/internal/intake"
)

// intakeFetcher is the read surface the reader needs (mockable in tests).
type intakeFetcher interface {
	ListDir(ctx context.Context, repo, dir string) ([]string, error)
	GetFileContent(ctx context.Context, repo, path string) ([]byte, error)
}

type intakeReader struct {
	gh   intakeFetcher
	repo string
}

// list fetches all queue items, newest CreatedAt first.
func (r *intakeReader) list(ctx context.Context) ([]intake.Item, error) {
	paths, err := r.gh.ListDir(ctx, r.repo, "items")
	if err != nil {
		return nil, err
	}
	items := make([]intake.Item, 0, len(paths))
	for _, p := range paths {
		raw, err := r.gh.GetFileContent(ctx, r.repo, p)
		if err != nil {
			return nil, err
		}
		var it intake.Item
		if err := json.Unmarshal(raw, &it); err != nil {
			return nil, err
		}
		items = append(items, it)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].CreatedAt > items[j].CreatedAt })
	return items, nil
}

type intakeResponse struct {
	Items      []intake.Item `json:"items"`
	Stale      bool          `json:"stale,omitempty"`
	FetchError string        `json:"fetch_error,omitempty"`
}

// intakeCache memoizes the last good list and serves it (flagged stale) on a
// failed refetch, so a transient outage doesn't blank the page.
type intakeCache struct {
	ttl  time.Duration
	now  func() time.Time
	mu   sync.Mutex
	at   time.Time
	last []intake.Item
	has  bool
}

func (c *intakeCache) get(read func(context.Context) ([]intake.Item, error)) intakeResponse {
	nowFn := time.Now
	if c.now != nil {
		nowFn = c.now
	}
	c.mu.Lock()
	if c.has && nowFn().Sub(c.at) < c.ttl {
		resp := intakeResponse{Items: c.last}
		c.mu.Unlock()
		return resp
	}
	c.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	items, err := read(ctx)
	if err != nil {
		c.mu.Lock()
		defer c.mu.Unlock()
		if c.has {
			return intakeResponse{Items: c.last, Stale: true, FetchError: err.Error()}
		}
		return intakeResponse{Stale: true, FetchError: err.Error()}
	}
	c.mu.Lock()
	c.last = items
	c.has = true
	c.at = nowFn()
	c.mu.Unlock()
	return intakeResponse{Items: items}
}

// handleIntakeList is GET /api/intake.
func (s *Server) handleIntakeList(w http.ResponseWriter, r *http.Request) {
	if s.intake == nil || s.intakeCache == nil {
		jsonError(w, "intake not configured", http.StatusServiceUnavailable)
		return
	}
	jsonResponse(w, s.intakeCache.get(s.intake.list))
}
```

- [ ] **Step 4: Run test — verify PASS**

Run: same as Step 2. Expected: PASS. (Will not compile until `Server` has `intake`/`intakeCache` fields — add them now in Step 5 of this task, see below, OR jump to Task 6 wiring. To keep this task self-contained, add the two fields here.)

- [ ] **Step 4b: Add Server fields (`internal/web/server.go`, in the struct ~line 69-70, alongside portfolio fields)**

```go
	intake      *intakeReader     // S2 intake queue reader
	intakeCache *intakeCache      // S2 intake cache
	intakeQueue *intake.Queue     // S2 queue writer (web POST)
	transcriber transcriber       // S2 STT (web POST), see Task 5
	intakeRepo  string            // S2 INTAKE_QUEUE_REPO
```

Add import `"github.com/mtzanidakis/praktor/internal/intake"` to `server.go`. (The `transcriber` interface is defined in Task 5; if implementing strictly in order, temporarily omit the `transcriber` field and add it in Task 5.)

- [ ] **Step 5: Commit**

```bash
git add internal/web/intake.go internal/web/intake_test.go internal/web/server.go
git commit -m "feat(web): intake queue reader + stale cache + GET /api/intake (S2)"
```

---

## Task 5: web — POST /api/intake capture handler

**Files:**
- Modify: `internal/web/intake.go` (add handler + `transcriber` interface)
- Test: `internal/web/intake_test.go` (add)

**Context:** multipart form: `text` (string), `project` (string, optional), `audio` (file, optional → STT), `photo` (file, optional → media). Needs `text` OR `audio`. `intake.Item` assembled and queued. Injected `intakeQueue` (write) + `transcriber` (STT) for testability.

- [ ] **Step 1: Write failing test (append to `intake_test.go`)**

```go
type fakeQueue struct {
	put    *intake.Item
	media  []string
}

func (f *fakeQueue) Put(_ context.Context, it intake.Item) error {
	f.put = &it
	return nil
}
func (f *fakeQueue) PutMedia(_ context.Context, id, name string, _ []byte) (string, error) {
	p := "items/" + id + "/" + name
	f.media = append(f.media, p)
	return p, nil
}

type fakeTranscriber struct{ text string }

func (f *fakeTranscriber) Transcribe(_ context.Context, _ []byte, _ string) (string, error) {
	return f.text, nil
}

func multipartBody(t *testing.T, fields map[string]string, files map[string]struct {
	name string
	data []byte
}) (string, *bytes.Buffer) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for k, v := range fields {
		_ = mw.WriteField(k, v)
	}
	for field, f := range files {
		fw, _ := mw.CreateFormFile(field, f.name)
		_, _ = fw.Write(f.data)
	}
	_ = mw.Close()
	return mw.FormDataContentType(), &buf
}

func newIntakeServer(q intakeWriter, tr transcriber) *Server {
	return &Server{intakeQueue2: q, transcriber: tr, intakeRepo: "r/q"}
}

func TestHandleIntakeCreateText(t *testing.T) {
	q := &fakeQueue{}
	s := newIntakeServer(q, &fakeTranscriber{})
	ct, body := multipartBody(t, map[string]string{"text": "fix readme", "project": "pdai"}, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/intake", body)
	req.Header.Set("Content-Type", ct)
	rec := httptest.NewRecorder()
	s.handleIntakeCreate(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("code = %d (%s)", rec.Code, rec.Body)
	}
	if q.put == nil || q.put.RawText != "fix readme" || q.put.TargetProject != "pdai" {
		t.Fatalf("queued = %+v", q.put)
	}
}

func TestHandleIntakeCreateVoiceTranscribed(t *testing.T) {
	q := &fakeQueue{}
	s := newIntakeServer(q, &fakeTranscriber{text: "dictated task"})
	ct, body := multipartBody(t, nil, map[string]struct {
		name string
		data []byte
	}{"audio": {"voice.ogg", []byte{1, 2}}})
	req := httptest.NewRequest(http.MethodPost, "/api/intake", body)
	req.Header.Set("Content-Type", ct)
	rec := httptest.NewRecorder()
	s.handleIntakeCreate(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("code = %d (%s)", rec.Code, rec.Body)
	}
	if q.put.RawText != "dictated task" {
		t.Fatalf("raw = %q", q.put.RawText)
	}
}

func TestHandleIntakeCreateEmpty400(t *testing.T) {
	s := newIntakeServer(&fakeQueue{}, &fakeTranscriber{})
	ct, body := multipartBody(t, map[string]string{}, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/intake", body)
	req.Header.Set("Content-Type", ct)
	rec := httptest.NewRecorder()
	s.handleIntakeCreate(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("code = %d", rec.Code)
	}
}
```

> Add imports to `intake_test.go`: `"bytes"`, `"mime/multipart"`.
> NOTE: the test uses `intakeWriter` and a field `intakeQueue2`. To keep types clean, define the `intakeWriter` interface (Step 3) and rename the Task-4 field `intakeQueue *intake.Queue` → `intakeQueue intakeWriter` (interface). Update Step 4b accordingly: `intakeQueue intakeWriter`. The test helper `newIntakeServer` then sets `intakeQueue: q`. (Replace `intakeQueue2` with `intakeQueue` in the test — `intakeQueue2` is a typo guard; use `intakeQueue`.)

- [ ] **Step 2: Run test — verify FAIL**

Run: `docker run --rm -v "$PWD":/src -w /src -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/web/ -run TestHandleIntakeCreate -v`
Expected: FAIL (`handleIntakeCreate`/`transcriber`/`intakeWriter` undefined).

- [ ] **Step 3: Implement (add to `internal/web/intake.go`)**

```go
// transcriber is the STT surface (satisfied by *speech.Client).
type transcriber interface {
	Transcribe(ctx context.Context, audio []byte, filename string) (string, error)
}

// intakeWriter is the queue write surface (satisfied by *intake.Queue).
type intakeWriter interface {
	Put(ctx context.Context, it intake.Item) error
	PutMedia(ctx context.Context, id, name string, data []byte) (string, error)
}

const intakeMaxUpload = 12 << 20 // 12 MiB

// handleIntakeCreate is POST /api/intake (multipart: text, project, audio, photo).
func (s *Server) handleIntakeCreate(w http.ResponseWriter, r *http.Request) {
	if s.intakeQueue == nil {
		jsonError(w, "intake not configured", http.StatusServiceUnavailable)
		return
	}
	if err := r.ParseMultipartForm(intakeMaxUpload); err != nil {
		jsonError(w, "invalid multipart form", http.StatusBadRequest)
		return
	}
	text := strings.TrimSpace(r.FormValue("text"))
	project := strings.TrimSpace(r.FormValue("project"))

	// Optional voice → STT.
	if file, hdr, err := r.FormFile("audio"); err == nil {
		defer file.Close()
		audio, err := io.ReadAll(io.LimitReader(file, intakeMaxUpload))
		if err != nil {
			jsonError(w, "read audio failed", http.StatusBadRequest)
			return
		}
		if s.transcriber == nil {
			jsonError(w, "voice intake not configured (no STT key)", http.StatusServiceUnavailable)
			return
		}
		spoken, err := s.transcriber.Transcribe(r.Context(), audio, baseName(hdr.Filename, "voice.ogg"))
		if err != nil {
			jsonError(w, "transcription failed: "+err.Error(), http.StatusBadGateway)
			return
		}
		spoken = strings.TrimSpace(spoken)
		if text == "" {
			text = spoken
		} else if spoken != "" {
			text = text + "\n\n" + spoken
		}
	}

	if text == "" {
		jsonError(w, "text or audio is required", http.StatusBadRequest)
		return
	}

	id := newIntakeID(time.Now())
	var media []string
	if file, hdr, err := r.FormFile("photo"); err == nil {
		defer file.Close()
		data, err := io.ReadAll(io.LimitReader(file, intakeMaxUpload))
		if err != nil {
			jsonError(w, "read photo failed", http.StatusBadRequest)
			return
		}
		path, err := s.intakeQueue.PutMedia(r.Context(), id, baseName(hdr.Filename, "photo.jpg"), data)
		if err != nil {
			jsonError(w, "store photo failed: "+err.Error(), http.StatusBadGateway)
			return
		}
		media = append(media, path)
	}

	it := intake.Assemble("web", text, media, project, time.Now(), id[len(id)-4:])
	it.ID = id // keep the id used for media paths
	if err := s.intakeQueue.Put(r.Context(), it); err != nil {
		jsonError(w, "queue write failed: "+err.Error(), http.StatusBadGateway)
		return
	}
	w.WriteHeader(http.StatusCreated)
	jsonResponse(w, it)
}

// newIntakeID returns a timestamp id with a short random suffix.
func newIntakeID(now time.Time) string {
	b := make([]byte, 2)
	_, _ = rand.Read(b)
	return now.UTC().Format("20060102T150405Z") + "-" + hex.EncodeToString(b)
}

// baseName returns the file's base name, or fallback if empty.
func baseName(name, fallback string) string {
	name = pathpkg.Base(strings.TrimSpace(name))
	if name == "" || name == "." || name == "/" {
		return fallback
	}
	return name
}
```

Add imports to `intake.go`: `"crypto/rand"`, `"encoding/hex"`, `"io"`, `pathpkg "path"`, `"strings"`.

Update Task-4 Step-4b field to: `intakeQueue intakeWriter`. In `Assemble`, the `idSuffix` is overridden by `it.ID = id` so media paths and item id match.

- [ ] **Step 4: Run test — verify PASS**

Run: same as Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/web/intake.go internal/web/intake_test.go
git commit -m "feat(web): POST /api/intake capture (text/voice/photo) (S2)"
```

---

## Task 6: web — env wiring + route registration

**Files:**
- Modify: `internal/web/server.go:104-111` (NewServer, after the portfolio block)
- Modify: `internal/web/api.go:79-80` (routes)

- [ ] **Step 1: Add wiring in `NewServer` (after the `PORTFOLIO_DATA_REPO` block)**

```go
	if repo := os.Getenv("INTAKE_QUEUE_REPO"); repo != "" {
		srv.intakeRepo = repo
		srv.intake = &intakeReader{
			gh:   &GitHubClient{Token: os.Getenv("GITHUB_READ_TOKEN")},
			repo: repo,
		}
		srv.intakeCache = &intakeCache{ttl: 30 * time.Second}
		srv.intakeQueue = &intake.Queue{Token: os.Getenv("GITHUB_WRITE_TOKEN"), Repo: repo}
		if key := os.Getenv("OPENAI_API_KEY"); key != "" {
			srv.transcriber = speech.NewClient(key)
		}
	}
```

Add imports to `server.go`: `"github.com/mtzanidakis/praktor/internal/intake"` and `"github.com/mtzanidakis/praktor/internal/speech"`.

- [ ] **Step 2: Register routes in `registerAPI` (after the portfolio route, line 80)**

```go
	// Intake & triage (S2)
	mux.HandleFunc("POST /api/intake", s.handleIntakeCreate)
	mux.HandleFunc("GET /api/intake", s.handleIntakeList)
```

- [ ] **Step 3: Verify whole package compiles + tests pass**

Run: `docker run --rm -v "$PWD":/src -w /src -e GOTOOLCHAIN=auto golang:1.26rc1 sh -c "go build ./... && go test ./internal/web/ ./internal/intake/"`
Expected: build OK, tests PASS.

- [ ] **Step 4: Commit**

```bash
git add internal/web/server.go internal/web/api.go
git commit -m "feat(web): wire INTAKE_QUEUE_REPO + intake routes (S2)"
```

---

## Task 7: config — IntakeConfig + env override

**Files:**
- Modify: `internal/config/config.go:12-24` (Config struct), add struct, `:198-228` (applyEnv)
- Test: `internal/config/config_test.go` (add)

- [ ] **Step 1: Write failing test (append to `config_test.go`)**

```go
func TestApplyEnvIntakeToken(t *testing.T) {
	t.Setenv("INTAKE_TELEGRAM_TOKEN", "123:abc")
	cfg := &Config{}
	applyEnv(cfg)
	if cfg.Intake.TelegramToken != "123:abc" {
		t.Fatalf("intake token = %q", cfg.Intake.TelegramToken)
	}
}
```

- [ ] **Step 2: Run — verify FAIL**

Run: `docker run --rm -v "$PWD":/src -w /src -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/config/ -run TestApplyEnvIntake -v`
Expected: FAIL (`cfg.Intake` undefined).

- [ ] **Step 3: Implement**

Add field to `Config` struct (after `Speech` line 22):
```go
	Intake    IntakeConfig                 `yaml:"intake"`
```

Add struct (after `SpeechConfig`, ~line 48):
```go
// IntakeConfig configures the S2 intake Telegram poller. Its token is separate
// from Telegram.Token so the full orchestrator bot stays disabled.
type IntakeConfig struct {
	TelegramToken string `yaml:"telegram_token"`
}
```

Add to `applyEnv` (before the closing brace, after the OPENAI block ~line 227):
```go
	if v := os.Getenv("INTAKE_TELEGRAM_TOKEN"); v != "" {
		cfg.Intake.TelegramToken = v
	}
```

- [ ] **Step 4: Run — verify PASS**

Run: same as Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/config/config.go internal/config/config_test.go
git commit -m "feat(config): IntakeConfig + INTAKE_TELEGRAM_TOKEN env (S2)"
```

---

## Task 8: intake — Telegram poller

**Files:**
- Create: `internal/intake/telegram.go`
- Test: `internal/intake/telegram_test.go`

**Context:** Thin long-poll bot owning the intake token. Reuses `internal/speech` for voice. Builds `Item` and calls a `queuePutter`. The pure message→Item logic is unit-tested; the live `telego` loop is a thin wrapper (not unit-tested, like `bot.Start`).

- [ ] **Step 1: Write failing test**

```go
package intake

import (
	"context"
	"testing"
	"time"
)

type capturingQueue struct{ last *Item }

func (c *capturingQueue) Put(_ context.Context, it Item) error { c.last = &it; return nil }
func (c *capturingQueue) PutMedia(_ context.Context, id, name string, _ []byte) (string, error) {
	return "items/" + id + "/" + name, nil
}

func TestBuildItemTextOnly(t *testing.T) {
	q := &capturingQueue{}
	p := &Poller{queue: q, now: func() time.Time { return time.Unix(0, 0).UTC() }, idSuffix: func() string { return "tg01" }}
	if err := p.enqueue(context.Background(), "ship the thing", nil, ""); err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	if q.last == nil || q.last.Source != "telegram" || q.last.RawText != "ship the thing" {
		t.Fatalf("item = %+v", q.last)
	}
	if q.last.ID != "19700101T000000Z-tg01" {
		t.Fatalf("id = %q", q.last.ID)
	}
}

func TestBuildItemWithMedia(t *testing.T) {
	q := &capturingQueue{}
	p := &Poller{queue: q, now: func() time.Time { return time.Unix(0, 0).UTC() }, idSuffix: func() string { return "tg02" }}
	err := p.enqueue(context.Background(), "caption", []mediaBlob{{Name: "photo.jpg", Data: []byte{9}}}, "histology")
	if err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	if len(q.last.Media) != 1 || q.last.Media[0] != "items/19700101T000000Z-tg02/photo.jpg" {
		t.Fatalf("media = %v", q.last.Media)
	}
	if q.last.TargetProject != "histology" {
		t.Fatalf("project = %q", q.last.TargetProject)
	}
}
```

- [ ] **Step 2: Run — verify FAIL**

Run: `docker run --rm -v "$PWD":/src -w /src -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/intake/ -run TestBuildItem -v`
Expected: FAIL (`Poller` undefined).

- [ ] **Step 3: Implement `internal/intake/telegram.go`**

```go
package intake

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"time"

	"github.com/mtzanidakis/praktor/internal/speech"
	"github.com/mymmrac/telego"
	th "github.com/mymmrac/telego/telegohandler"
	tu "github.com/mymmrac/telego/telegoutil"
)

// queuePutter is the queue surface the poller needs (satisfied by *Queue).
type queuePutter interface {
	Put(ctx context.Context, it Item) error
	PutMedia(ctx context.Context, id, name string, data []byte) (string, error)
}

type mediaBlob struct {
	Name string
	Data []byte
}

// Poller is a minimal Telegram long-poll adapter that turns voice/photo/text
// into intake Items. It owns the intake token; the full orchestrator bot stays
// disabled (Telegram.Token empty).
type Poller struct {
	bot      *telego.Bot
	speech   *speech.Client
	queue    queuePutter
	allow    map[int64]bool
	now      func() time.Time
	idSuffix func() string
}

// NewPoller constructs a poller. allowFrom restricts who may submit (empty = any).
func NewPoller(token string, speechClient *speech.Client, queue queuePutter, allowFrom []int64) (*Poller, error) {
	bot, err := telego.NewBot(token)
	if err != nil {
		return nil, fmt.Errorf("intake telegram bot: %w", err)
	}
	allow := make(map[int64]bool, len(allowFrom))
	for _, id := range allowFrom {
		allow[id] = true
	}
	return &Poller{
		bot:      bot,
		speech:   speechClient,
		queue:    queue,
		allow:    allow,
		now:      time.Now,
		idSuffix: randSuffix,
	}, nil
}

func randSuffix() string {
	b := make([]byte, 2)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// enqueue builds an Item (writing any media first) and queues it.
func (p *Poller) enqueue(ctx context.Context, text string, blobs []mediaBlob, project string) error {
	id := p.now().UTC().Format("20060102T150405Z") + "-" + p.idSuffix()
	var media []string
	for _, b := range blobs {
		path, err := p.queue.PutMedia(ctx, id, b.Name, b.Data)
		if err != nil {
			return err
		}
		media = append(media, path)
	}
	it := Assemble("telegram", text, media, project, p.now(), "x")
	it.ID = id
	return p.queue.Put(ctx, it)
}

// downloadFile fetches a Telegram file's bytes by FileID.
func (p *Poller) downloadFile(ctx context.Context, fileID string) ([]byte, error) {
	file, err := p.bot.GetFile(ctx, &telego.GetFileParams{FileID: fileID})
	if err != nil {
		return nil, err
	}
	return tu.DownloadFile(p.bot.FileDownloadURL(file.FilePath))
}

// handle turns one message into an intake Item. Voice → STT; photo → media.
func (p *Poller) handle(ctx context.Context, msg telego.Message) {
	if len(p.allow) > 0 && msg.From != nil && !p.allow[msg.From.ID] {
		return
	}
	text := msg.Text
	if text == "" {
		text = msg.Caption
	}
	var blobs []mediaBlob

	if msg.Voice != nil {
		data, err := p.downloadFile(ctx, msg.Voice.FileID)
		if err != nil {
			slog.Error("intake voice download", "error", err)
		} else if p.speech != nil {
			if spoken, err := p.speech.Transcribe(ctx, data, "voice.ogg"); err == nil {
				if text == "" {
					text = spoken
				} else {
					text = text + "\n\n" + spoken
				}
			} else {
				slog.Error("intake transcribe", "error", err)
			}
		}
	}
	if len(msg.Photo) > 0 {
		photo := msg.Photo[len(msg.Photo)-1]
		if data, err := p.downloadFile(ctx, photo.FileID); err == nil {
			blobs = append(blobs, mediaBlob{Name: "photo.jpg", Data: data})
		} else {
			slog.Error("intake photo download", "error", err)
		}
	}
	if text == "" && len(blobs) == 0 {
		return
	}
	if err := p.enqueue(ctx, text, blobs, ""); err != nil {
		slog.Error("intake enqueue", "error", err)
		_, _ = p.bot.SendMessage(ctx, tu.Message(tu.ID(msg.Chat.ID), "⚠ intake failed: "+err.Error()))
		return
	}
	_, _ = p.bot.SendMessage(ctx, tu.Message(tu.ID(msg.Chat.ID), "✅ принято в очередь"))
}

// Start runs the long-poll loop until ctx is cancelled.
func (p *Poller) Start(ctx context.Context) error {
	updates, err := p.bot.UpdatesViaLongPolling(ctx, nil)
	if err != nil {
		return err
	}
	handler, err := th.NewBotHandler(p.bot, updates)
	if err != nil {
		return err
	}
	handler.HandleMessage(func(_ *th.Context, msg telego.Message) error {
		p.handle(context.Background(), msg)
		return nil
	})
	return handler.Start()
}
```

> If the installed telego API differs (e.g. `HandleMessage` signature, `tu.Message`/`tu.ID` helpers), adjust to match `internal/telegram/bot.go`, which uses the same library — copy its exact call shapes for `SendMessage`, `GetFile`, `FileDownloadURL`, `DownloadFile`, and handler registration.

- [ ] **Step 4: Run — verify PASS**

Run: same as Step 2. Expected: PASS (unit tests cover `enqueue`; `handle`/`Start` compile).

- [ ] **Step 5: Commit**

```bash
git add internal/intake/telegram.go internal/intake/telegram_test.go
git commit -m "feat(intake): Telegram intake poller (voice/photo/text → queue)"
```

---

## Task 9: main.go — start intake poller (gated)

**Files:**
- Modify: `cmd/praktor/main.go` (after the telegram-bot block ~line 153)

- [ ] **Step 1: Add wiring (after the `cfg.Telegram.Token` bot block)**

```go
	// S2 intake poller — separate token; the full orchestrator bot above stays
	// disabled. Requires the queue repo + write token + (for voice) OpenAI key.
	if cfg.Intake.TelegramToken != "" {
		queueRepo := os.Getenv("INTAKE_QUEUE_REPO")
		writeToken := os.Getenv("GITHUB_WRITE_TOKEN")
		if queueRepo == "" || writeToken == "" {
			slog.Warn("intake poller disabled: INTAKE_QUEUE_REPO or GITHUB_WRITE_TOKEN not set")
		} else {
			q := &intake.Queue{Token: writeToken, Repo: queueRepo}
			poller, err := intake.NewPoller(cfg.Intake.TelegramToken, speechClient, q, cfg.Telegram.AllowFrom)
			if err != nil {
				return fmt.Errorf("init intake poller: %w", err)
			}
			go func() { _ = poller.Start(ctx) }()
			slog.Info("intake poller started")
		}
	}
```

Add import `"github.com/mtzanidakis/praktor/internal/intake"` to `main.go`. (`os`, `fmt`, `slog`, `speechClient`, `ctx` are already in scope.)

- [ ] **Step 2: Build the whole binary**

Run: `docker run --rm -v "$PWD":/src -w /src -e GOTOOLCHAIN=auto golang:1.26rc1 go build ./...`
Expected: build OK.

- [ ] **Step 3: Commit**

```bash
git add cmd/praktor/main.go
git commit -m "feat: start intake poller in main (gated on INTAKE_TELEGRAM_TOKEN) (S2)"
```

---

## Task 10: UI — intakeStatus types + helpers

**Files:**
- Create: `ui/src/pages/intakeStatus.ts`
- Test: `ui/src/pages/__tests__/intakeStatus.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { routeLabel, statusLabel, type IntakeItem } from '../intakeStatus';

describe('intakeStatus', () => {
  it('labels routes', () => {
    expect(routeLabel('trivial')).toBe('auto');
    expect(routeLabel('standard')).toBe('plan→approve');
    expect(routeLabel('complex')).toBe('design (S3)');
    expect(routeLabel('')).toBe('—');
  });
  it('labels statuses human-readably', () => {
    expect(statusLabel('queued')).toBe('queued');
    expect(statusLabel('awaiting-approval')).toBe('awaiting approval');
    expect(statusLabel('needs-clarification')).toBe('needs clarification');
  });
  it('type shape', () => {
    const it: IntakeItem = { id: 'a', source: 'web', raw_text: 'x', status: 'queued', created_at: '', updated_at: '' };
    expect(it.id).toBe('a');
  });
});
```

- [ ] **Step 2: Run — verify FAIL**

Run: `cd ui && npx vitest run src/pages/__tests__/intakeStatus.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `ui/src/pages/intakeStatus.ts`**

```ts
export type Source = 'web' | 'telegram';
export type Route = 'trivial' | 'standard' | 'complex' | '';

export interface IntakeItem {
  id: string;
  source: Source;
  raw_text: string;
  media?: string[];
  target_project?: string;
  route?: Route;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface IntakeList {
  items: IntakeItem[];
  stale?: boolean;
  fetch_error?: string;
}

export function routeLabel(route?: string): string {
  switch (route) {
    case 'trivial': return 'auto';
    case 'standard': return 'plan→approve';
    case 'complex': return 'design (S3)';
    default: return '—';
  }
}

export function statusLabel(status: string): string {
  return status.replace(/-/g, ' ');
}
```

- [ ] **Step 4: Run — verify PASS**

Run: same as Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/pages/intakeStatus.ts ui/src/pages/__tests__/intakeStatus.test.ts
git commit -m "feat(ui): intakeStatus types + route/status labels (S2)"
```

---

## Task 11: UI — Intake page (capture form + list)

**Files:**
- Create: `ui/src/pages/Intake.tsx`

**Context:** Mirrors `Portfolio.tsx` shell (card styles, `fetch` + 60s poll). Form posts multipart to `/api/intake`; voice via `MediaRecorder`. No new test file (rendering parity with Portfolio, which has none; logic helpers tested in Task 10). Manual verify via build.

- [ ] **Step 1: Implement `ui/src/pages/Intake.tsx`**

```tsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { routeLabel, statusLabel, type IntakeItem, type IntakeList } from './intakeStatus';

const card: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: 10, padding: 16, boxShadow: 'var(--shadow)', marginBottom: 12,
};
const input: React.CSSProperties = {
  width: '100%', padding: 10, borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 15, marginBottom: 8,
};

function Intake() {
  const [doc, setDoc] = useState<IntakeList | null>(null);
  const [text, setText] = useState('');
  const [project, setProject] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const audio = useRef<Blob | null>(null);

  const fetchList = useCallback(() => {
    fetch('/api/intake')
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then(setDoc)
      .catch(() => setDoc({ items: [] }));
  }, []);

  useEffect(() => {
    fetchList();
    const id = setInterval(fetchList, 60000);
    return () => clearInterval(id);
  }, [fetchList]);

  const startRec = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream);
    chunks.current = [];
    mr.ondataavailable = (e) => chunks.current.push(e.data);
    mr.onstop = () => {
      audio.current = new Blob(chunks.current, { type: 'audio/ogg' });
      stream.getTracks().forEach((t) => t.stop());
    };
    recorder.current = mr;
    mr.start();
    setRecording(true);
  }, []);

  const stopRec = useCallback(() => {
    recorder.current?.stop();
    setRecording(false);
  }, []);

  const submit = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    const fd = new FormData();
    if (text.trim()) fd.append('text', text.trim());
    if (project.trim()) fd.append('project', project.trim());
    if (photo) fd.append('photo', photo);
    if (audio.current) fd.append('audio', audio.current, 'voice.ogg');
    try {
      const res = await fetch('/api/intake', { method: 'POST', body: fd });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setText(''); setProject(''); setPhoto(null); audio.current = null;
      setMsg('✅ queued');
      fetchList();
    } catch (e) {
      setMsg(`⚠ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [text, project, photo, fetchList]);

  return (
    <div>
      <h1 style={{ marginBottom: 8 }}>Intake</h1>
      <div style={card}>
        <textarea style={{ ...input, minHeight: 70 }} placeholder="Задача Claude'у…" value={text} onChange={(e) => setText(e.target.value)} />
        <input style={input} placeholder="проект (опц.) — пусто = триаж определит" value={project} onChange={(e) => setProject(e.target.value)} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          {!recording
            ? <button onClick={startRec} style={{ padding: '6px 12px' }}>🎙 запись</button>
            : <button onClick={stopRec} style={{ padding: '6px 12px', color: '#c00' }}>⏹ стоп</button>}
          {audio.current && <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>голос готов</span>}
          <button onClick={submit} disabled={busy} style={{ padding: '6px 16px', marginLeft: 'auto', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8 }}>
            {busy ? '…' : 'Отправить'}
          </button>
        </div>
        {msg && <div style={{ marginTop: 8, fontSize: 13 }}>{msg}</div>}
      </div>

      {doc?.stale && <div style={{ color: '#b8860b', marginBottom: 12 }}>⚠ stale{doc.fetch_error ? `: ${doc.fetch_error}` : ''}</div>}
      {(doc?.items ?? []).map((it: IntakeItem) => (
        <div key={it.id} style={card}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{it.source === 'telegram' ? '✈' : '🌐'}</span>
            <strong style={{ flex: 1, fontSize: 15 }}>{it.raw_text.slice(0, 120) || '(media)'}</strong>
            {it.target_project && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{it.target_project}</span>}
            <span style={{ fontSize: 12, color: 'var(--accent)' }}>{routeLabel(it.route)}</span>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 110, textAlign: 'right' }}>{statusLabel(it.status)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default Intake;
```

- [ ] **Step 2: Type-check + build**

Run: `cd ui && npx tsc --noEmit && npm run build`
Expected: no type errors; build succeeds (Intake chunk emitted).

- [ ] **Step 3: Commit**

```bash
git add ui/src/pages/Intake.tsx
git commit -m "feat(ui): Intake capture form + queue list (S2)"
```

---

## Task 12: UI — nav + route

**Files:**
- Modify: `ui/src/App.tsx:13` (lazy import), `:142-161` (icon + navItems), `:398-408` (route)

- [ ] **Step 1: Add lazy import (after line 13, the Portfolio import)**

```tsx
const Intake = lazy(() => import('./pages/Intake'));
```

- [ ] **Step 2: Add icon component (after `IconPortfolio`, ~line 149)**

```tsx
function IconIntake() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1v9" />
      <path d="M5 7l3 3 3-3" />
      <path d="M2 11v2a1 1 0 001 1h10a1 1 0 001-1v-2" />
    </svg>
  );
}
```

- [ ] **Step 3: Add nav item (in `navItems`, after the portfolio entry, line 154)**

```tsx
  { to: '/intake', label: 'Intake', Icon: IconIntake },
```

- [ ] **Step 4: Add route (in `<Routes>`, after the portfolio route, line 401)**

```tsx
            <Route path="/intake" element={<Intake />} />
```

- [ ] **Step 5: Build + full UI test suite**

Run: `cd ui && npx tsc --noEmit && npx vitest run && npm run build`
Expected: type-check clean, all vitest pass, build OK.

- [ ] **Step 6: Commit**

```bash
git add ui/src/App.tsx
git commit -m "feat(ui): Intake nav item + route (S2)"
```

---

## Task 13: `~/.claude` — /intake-drain command

**Files:**
- Create: `~/.claude/commands/intake-drain.md`

**Context:** Like `/self-improve` and `/publish-portfolio` — a prose command the local CC session executes. Triage is LLM judgement (same as the Auditor's TRIVIAL/STANDARD/COMPLEX classification — no deterministic code). The command reads the queue via `gh`, classifies, routes, and updates each item's status back to the queue. This is the MVP executor (local CC); the queue interface is unchanged when a server executor is added later.

- [ ] **Step 1: Write the command file**

````markdown
---
description: Drain the S2 intake queue — triage each captured task into a route and act (or hand off).
---

Drain and triage the Mission Control intake queue (`Meta-Psy/intake-queue`).

For each queued item, classify it (reusing the Auditor's TRIVIAL/STANDARD/COMPLEX taxonomy) and route it. The local Claude Code session IS the MVP executor.

Steps:

1. **Fetch queued items.** List `items/*.json` in the queue repo and read each whose `status` is `queued`:
   `gh api repos/Meta-Psy/intake-queue/contents/items --jq '.[].path'`
   then `gh api repos/Meta-Psy/intake-queue/contents/<path> --jq '.content' | base64 -d` per file.
   If the queue is empty, report "queue empty" and stop.

2. **Resolve target project (hybrid, D5).** If `target_project` is empty, infer it from `raw_text` by matching against the roadmap-block catalog in `~/.claude/projects/C--Users-Alex/memory/project_*.md` (each has a `name` and optional `mc_key`/repo). If the match is ambiguous, set status `needs-clarification` and write a one-line question into the item's `raw_text` history — do NOT guess silently (Core Principle #1).

3. **Triage into a route:**
   - **TRIVIAL** (single-file, mechanical, low-risk, "fix typo / bump / rename") → route `trivial`.
   - **STANDARD** (1–5 files, testable, contained) → route `standard`.
   - **COMPLEX** (new abstraction, external API, DB migration, cross-cutting) → route `complex`. **Never auto-implement** (process rule).

4. **Act per route:**
   - **trivial:** set status `triaged`→`in_progress`; dispatch the `implementer-trivial` subagent against the task in the resolved project repo; on PR opened set status `done` and record the PR URL.
   - **standard:** generate a short plan; open a `/approve`-style issue in the target repo carrying an `AUDIT-MANIFEST` (reuse the approve-handler format) OR, once S3 ships, hand the plan to the S3 UI; set status `awaiting-approval`.
   - **complex:** set status `needs-design`; open a `needs-design` issue summarizing why it needs a brainstorm. Do not implement.

5. **Write status back.** For each item, PUT the updated JSON to `items/<id>.json` with its current blob SHA:
   `gh api -X PUT repos/Meta-Psy/intake-queue/contents/items/<id>.json -f message="intake: <id> → <status>" -f content="$(base64 -w0 item.json)" -f sha="<sha>"`
   (Get the SHA from the listing in step 1.)

6. **Archive done items** (keep `items/` small): move `done` items older than today to `archive/` (PUT to new path, then DELETE the old path via `gh api -X DELETE`).

7. **Report:** per item — id, resolved project, route, final status, and any PR/issue URL.

Notes:
- The queue repo, the read+write PAT scope, and the `implementer-trivial`/`implementer-standard` agents are existing infra (Phase E.0-A). If `gh` auth or repo access fails, stop and tell Alex — do not work around.
- COMPLEX is never auto-implemented. STANDARD always goes through an approval gate. Only TRIVIAL is full-trust auto.
- Media: items may reference `items/<id>/photo.jpg`; fetch and inspect via the contents API when the task needs the image.
````

- [ ] **Step 2: Verify the command registers**

Run: confirm the file exists and front-matter parses (no body code to test). The command appears as `/intake-drain` in a fresh session.

- [ ] **Step 3: Commit (point-add in `~/.claude`, current branch — no PR, review = Alex diff)**

```bash
cd ~/.claude && git add commands/intake-drain.md
git commit -m "feat(commands): /intake-drain — triage + route the S2 intake queue"
```

---

## Task 14: Full verification + PR

**Files:** none (verification + PR).

- [ ] **Step 1: Go — full build + test + gofmt**

```bash
cd /c/Users/Alex/10_Projects/praktor
docker run --rm -v "$PWD":/src -w /src -e GOTOOLCHAIN=auto golang:1.26rc1 sh -c \
  "go build ./... && go test ./internal/intake/ ./internal/web/ ./internal/config/ && gofmt -l internal/intake internal/web/intake.go cmd/praktor/main.go"
```
Expected: build OK; tests PASS; `gofmt -l` prints nothing.
> Windows CRLF caveat (durable S1/F.4 lesson): if `gofmt -l` flags files, verify against the git blob — `git show HEAD:internal/intake/item.go | docker run --rm -i -e GOTOOLCHAIN=auto golang:1.26rc1 gofmt -d` — CRLF in the working copy gives false positives.

- [ ] **Step 2: UI — type-check + tests + build**

```bash
cd ui && npx tsc --noEmit && npx vitest run && npm run build
```
Expected: clean; all pass; Intake chunk in build output.

- [ ] **Step 3: Push branch + open PR**

```bash
cd /c/Users/Alex/10_Projects/praktor
git push -u origin feature/s2-intake-triage
gh pr create --repo Meta-Psy/praktor --base main --head feature/s2-intake-triage \
  --title "feat: S2 intake & triage — capture (web+TG) → queue → drain" \
  --body "See _specs/2026-06-14-phase-f-stage-s2-intake-triage-{design,plan}.md. Capture from MC-web + Telegram → GitHub queue (Meta-Psy/intake-queue) → /intake-drain triages (TRIVIAL/STANDARD/COMPLEX). Local-CC executor for MVP behind queue interface. [ALEX] gates in design-doc."
```
Expected: PR opened. **Do NOT merge — Alex is the gate.**

- [ ] **Step 4: Report [ALEX] gates** (from design-doc): create `Meta-Psy/intake-queue` (+ read+write PAT scope), `INTAKE_QUEUE_REPO` env, OpenAI key (STT), `INTAKE_TELEGRAM_TOKEN`, image rebuild (`redeploy.sh`), approve `/intake-drain` diff, phone-verify.

---

## Self-Review

**Spec coverage:**
- D1 задачи Claude'у → captured as free text/voice/photo, routed (Tasks 1,5,8,13). ✓
- D2 оба канала → web POST (Task 5) + TG poller (Tasks 8-9). ✓
- D3 локальный CC за интерфейсом → queue is the interface (Tasks 2,4); `/intake-drain` = executor (Task 13); server executor later swaps drain side. ✓
- D4 GitHub queue → `intake.Queue` (Task 2), reader (Task 4). ✓
- D5 гибрид-таргет → `/intake-drain` step 2 (Task 13). ✓
- D6 TRIVIAL/STANDARD/COMPLEX → `Route*` consts (Task 1) + drain step 3-4 (Task 13). ✓
- D7 TG мини-поллер, не форк bot.go → `internal/intake/telegram.go` (Task 8), separate token (Task 7), gated wiring (Task 9). ✓
- Видимость → `GET /api/intake` (Task 4) + Intake page (Tasks 11-12) + TG "принято" ack (Task 8); status-change TG audit beyond ack is handled by `/intake-drain` reporting (MVP) — full server-side TG audit on each transition is a fast-follow (noted, not a silent gap).
- Ошибки → STT 502 + `error` status, ambiguous → `needs-clarification`, durable queue (Tasks 5,13,1). ✓

**Placeholder scan:** no TBD/TODO; all code blocks complete. ✓
**Type consistency:** `Item`/`intake.Item`, `Queue.Put`/`PutMedia`, `intakeWriter`/`intakeFetcher`/`transcriber`, `routeLabel`/`statusLabel` consistent across tasks. Field rename note (`intakeQueue intakeWriter`) reconciled in Tasks 4-6. ✓

**Known follow-ups (not MVP-blocking):** server-side TG audit on every status transition (currently ack-on-capture + drain report); capture-time triage (MVP triages at drain); polished Intake styling.
