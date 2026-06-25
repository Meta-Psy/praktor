# S5 — радар экосистемы Claude Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read-only страница Radar в Mission Control: Go-сборщик периодически сканирует GitHub topic-search на Claude-тулинг → `radar_items` → MC; опциональный LLM-дайджест в Telegram.

**Architecture:** Два слабосвязанных хост-компонента. Сборщик (`internal/radar`) — горутина-ticker: GitHub topic-search → фильтр → upsert в SQLite. MC-хендлер читает локальный store. Дайджест — отдельная горутина: новые items → промпт → дефолт-агент через `orch.HandleMessage` → Telegram. Импорт-граф `store ← radar ← web ← main`; radar изолирован интерфейсами (`RepoSearcher`/`RadarStore`/`MessageHandler`).

**Tech Stack:** Go 1.26 (stdlib `net/http`, `modernc.org/sqlite`), React 19 + Vite + vitest.

**Spec:** `_specs/2026-06-24-phase-f-stage-s5-ecosystem-radar-design.md`

**Ветка:** `feature/s5-ecosystem-radar` (форк `Meta-Psy/praktor`, от `origin/main` = `342776b`).

**Verification env (Go):** все Go-проверки в Docker. `MSYS_NO_PATHCONV=1` — ВНЕШНИЙ префикс шелла:
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src \
  -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build \
  -e GOTOOLCHAIN=auto golang:1.26rc1 <cmd>
```
gofmt по git-блобам: `git show :path/file.go | docker run --rm -i golang:1.26rc1 gofmt -d` (пусто = ок). UI — `npm`/`npx` на хосте.

**ВАЖНО:** S5 трогает только gateway (НЕ `agent-runner/`) → деплой = `redeploy.sh`, отдельный agent-build НЕ нужен.

---

### Task 1: radar-пакет — типы + фильтр `keepRepo`

**Files:**
- Create: `internal/radar/radar.go` (типы `RadarRepo`, интерфейсы)
- Create: `internal/radar/filter.go` (`keepRepo`)
- Test: `internal/radar/filter_test.go`

- [ ] **Step 1: Написать падающий тест** — создать `internal/radar/filter_test.go`:
```go
package radar

import (
	"testing"
	"time"
)

func TestKeepRepo(t *testing.T) {
	now := time.Date(2026, 6, 24, 12, 0, 0, 0, time.UTC)
	fresh := now.Add(-5 * 24 * time.Hour).Format(time.RFC3339)
	stale := now.Add(-90 * 24 * time.Hour).Format(time.RFC3339)

	cases := []struct {
		name string
		r    RadarRepo
		want bool
	}{
		{"good", RadarRepo{Stars: 50, PushedAt: fresh}, true},
		{"too few stars", RadarRepo{Stars: 3, PushedAt: fresh}, false},
		{"archived", RadarRepo{Stars: 50, PushedAt: fresh, Archived: true}, false},
		{"fork", RadarRepo{Stars: 50, PushedAt: fresh, Fork: true}, false},
		{"stale push", RadarRepo{Stars: 50, PushedAt: stale}, false},
		{"empty push", RadarRepo{Stars: 50, PushedAt: ""}, false},
		{"bad push", RadarRepo{Stars: 50, PushedAt: "not-a-date"}, false},
	}
	for _, c := range cases {
		if got := keepRepo(c.r, 10, 30, now); got != c.want {
			t.Errorf("%s: keepRepo = %v, want %v", c.name, got, c.want)
		}
	}
}
```

- [ ] **Step 2: Запустить — убедиться, что падает**
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/radar/ -v
```
Expected: FAIL — пакет/`RadarRepo`/`keepRepo` не существуют.

- [ ] **Step 3: Реализовать** — создать `internal/radar/radar.go`:
```go
// Package radar discovers new Claude-ecosystem tooling on GitHub (topic search)
// and surfaces it read-only in Mission Control (S5). It is isolated from the web
// and agent packages via the RepoSearcher / RadarStore / MessageHandler interfaces.
package radar

import (
	"context"

	"github.com/mtzanidakis/praktor/internal/store"
)

// RadarRepo is a single GitHub search result (transient DTO, pre-persistence).
type RadarRepo struct {
	FullName    string
	Name        string
	Description string
	HTMLURL     string
	Stars       int
	PushedAt    string // RFC3339 from GitHub
	Archived    bool
	Fork        bool
}

// RepoSearcher runs a GitHub repository search. Satisfied by *web.GitHubClient.
type RepoSearcher interface {
	SearchRepos(ctx context.Context, query string) ([]RadarRepo, error)
}

// RadarStore is the persistence the collector needs. Satisfied by *store.Store.
type RadarStore interface {
	UpsertRadarItem(item store.RadarItem) error
	ListRadarItems() ([]store.RadarItem, error)
	GetRadarMeta(key string) (string, error)
	SetRadarMeta(key, value string) error
}

// MessageHandler dispatches a prompt to an agent. Satisfied by *agent.Orchestrator.
type MessageHandler interface {
	HandleMessage(ctx context.Context, agentID, text string, meta map[string]string) error
}
```

Создать `internal/radar/filter.go`:
```go
package radar

import "time"

// keepRepo reports whether a search result passes the radar's quality bar:
// not archived, not a fork, at least minStars, and pushed within freshnessDays.
func keepRepo(r RadarRepo, minStars, freshnessDays int, now time.Time) bool {
	if r.Archived || r.Fork || r.Stars < minStars {
		return false
	}
	if r.PushedAt == "" {
		return false
	}
	t, err := time.Parse(time.RFC3339, r.PushedAt)
	if err != nil {
		return false
	}
	return now.Sub(t) <= time.Duration(freshnessDays)*24*time.Hour
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит** (тот же `go test ./internal/radar/ -v`). NOTE: пакет ссылается на `store.RadarItem`, который появится в Task 2 — поэтому до Task 2 пакет НЕ скомпилируется. Чтобы Task 1 был самодостаточным, **временно** в `radar.go` закомментируй методы `RadarStore`, использующие `store.RadarItem`, ИЛИ выполни Task 2 первым. РЕКОМЕНДАЦИЯ: реализуй Task 1 и Task 2 как одну логическую пару, коммить раздельно — сначала Task 2 (store), затем Task 1. **Если делаешь по порядку — сделай Task 2 ПЕРЕД Task 1.** (Контроллер: дай Task 2 первым.)

Для самодостаточности здесь предполагается, что Task 2 уже сделан. Тогда:
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/radar/ -v
```
Expected: PASS.

- [ ] **Step 5: gofmt + commit**
```bash
git add internal/radar/radar.go internal/radar/filter.go internal/radar/filter_test.go
for f in internal/radar/radar.go internal/radar/filter.go internal/radar/filter_test.go; do git show ":$f" | docker run --rm -i golang:1.26rc1 gofmt -d; done
git commit -m "feat(radar): RadarRepo/interfaces + keepRepo filter (S5)"
```

---

### Task 2: store — `radar_items` + `radar_meta` + CRUD

> **Делать ПЕРЕД Task 1** (Task 1 ссылается на `store.RadarItem`).

**Files:**
- Modify: `internal/store/store.go` (две таблицы в slice `migrations`)
- Create: `internal/store/radar.go`
- Test: `internal/store/radar_test.go`

- [ ] **Step 1: Написать падающий тест** — создать `internal/store/radar_test.go`:
```go
package store

import "testing"

func TestUpsertRadarItemPreservesFirstSeen(t *testing.T) {
	s := newTestStore(t)

	first := RadarItem{
		FullName: "owner/mcp-tool", Name: "mcp-tool", Description: "a tool",
		HTMLURL: "https://github.com/owner/mcp-tool", Stars: 10, Topic: "mcp",
		PushedAt: "2026-06-20T08:00:00Z", FirstSeen: "2026-06-22T00:00:00Z",
		LastUpdated: "2026-06-22T00:00:00Z",
	}
	if err := s.UpsertRadarItem(first); err != nil {
		t.Fatal(err)
	}
	// Re-see with more stars + later timestamps; first_seen must NOT change.
	second := first
	second.Stars = 42
	second.FirstSeen = "2026-06-24T00:00:00Z" // should be ignored
	second.LastUpdated = "2026-06-24T00:00:00Z"
	if err := s.UpsertRadarItem(second); err != nil {
		t.Fatal(err)
	}

	items, err := s.ListRadarItems()
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("len = %d, want 1", len(items))
	}
	if items[0].Stars != 42 {
		t.Errorf("stars = %d, want 42 (updated)", items[0].Stars)
	}
	if items[0].FirstSeen != "2026-06-22T00:00:00Z" {
		t.Errorf("first_seen = %q, want preserved 2026-06-22", items[0].FirstSeen)
	}
}

func TestListRadarItemsSortsByStars(t *testing.T) {
	s := newTestStore(t)
	for _, it := range []RadarItem{
		{FullName: "a/low", Name: "low", HTMLURL: "u", Stars: 5, Topic: "mcp", FirstSeen: "t", LastUpdated: "t"},
		{FullName: "a/high", Name: "high", HTMLURL: "u", Stars: 99, Topic: "mcp", FirstSeen: "t", LastUpdated: "t"},
	} {
		if err := s.UpsertRadarItem(it); err != nil {
			t.Fatal(err)
		}
	}
	items, _ := s.ListRadarItems()
	if items[0].FullName != "a/high" {
		t.Fatalf("order = %v, want high first", items)
	}
}

func TestRadarMeta(t *testing.T) {
	s := newTestStore(t)
	v, err := s.GetRadarMeta("last_digest_at")
	if err != nil {
		t.Fatal(err)
	}
	if v != "" {
		t.Fatalf("absent key = %q, want empty", v)
	}
	if err := s.SetRadarMeta("last_digest_at", "2026-06-24T00:00:00Z"); err != nil {
		t.Fatal(err)
	}
	v, _ = s.GetRadarMeta("last_digest_at")
	if v != "2026-06-24T00:00:00Z" {
		t.Fatalf("got %q", v)
	}
}
```

- [ ] **Step 2: Запустить — убедиться, что падает**
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/store/ -run 'TestUpsertRadarItem|TestListRadarItems|TestRadarMeta' -v
```
Expected: FAIL — методы/таблицы не определены.

- [ ] **Step 3: Реализовать таблицы.** В `internal/store/store.go` в slice `migrations := []string{` (после блока `agent_memory_stats` или `agents`) добавить две записи:
```go
		`CREATE TABLE IF NOT EXISTS radar_items (
			full_name    TEXT PRIMARY KEY,
			name         TEXT NOT NULL,
			description  TEXT,
			html_url     TEXT NOT NULL,
			stars        INTEGER NOT NULL DEFAULT 0,
			topic        TEXT NOT NULL,
			pushed_at    TEXT,
			first_seen   TEXT NOT NULL,
			last_updated TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS radar_meta (
			key   TEXT PRIMARY KEY,
			value TEXT NOT NULL
		)`,
```

- [ ] **Step 4: Реализовать CRUD** — создать `internal/store/radar.go`:
```go
package store

import (
	"database/sql"
	"errors"
	"fmt"
)

// RadarItem is a discovered ecosystem repo persisted by the S5 radar.
type RadarItem struct {
	FullName    string
	Name        string
	Description string
	HTMLURL     string
	Stars       int
	Topic       string
	PushedAt    string
	FirstSeen   string
	LastUpdated string
}

// UpsertRadarItem inserts a discovered repo or refreshes a known one. first_seen
// is preserved on conflict (only set on first insert).
func (s *Store) UpsertRadarItem(item RadarItem) error {
	_, err := s.db.Exec(`
		INSERT INTO radar_items (full_name, name, description, html_url, stars, topic, pushed_at, first_seen, last_updated)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(full_name) DO UPDATE SET
			name = excluded.name,
			description = excluded.description,
			html_url = excluded.html_url,
			stars = excluded.stars,
			topic = excluded.topic,
			pushed_at = excluded.pushed_at,
			last_updated = excluded.last_updated`,
		item.FullName, item.Name, item.Description, item.HTMLURL, item.Stars,
		item.Topic, item.PushedAt, item.FirstSeen, item.LastUpdated)
	if err != nil {
		return fmt.Errorf("upsert radar item: %w", err)
	}
	return nil
}

// ListRadarItems returns all discovered repos, most-starred first.
func (s *Store) ListRadarItems() ([]RadarItem, error) {
	rows, err := s.db.Query(`
		SELECT full_name, name, COALESCE(description, ''), html_url, stars, topic,
		       COALESCE(pushed_at, ''), first_seen, last_updated
		FROM radar_items ORDER BY stars DESC, full_name ASC`)
	if err != nil {
		return nil, fmt.Errorf("list radar items: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var out []RadarItem
	for rows.Next() {
		var it RadarItem
		if err := rows.Scan(&it.FullName, &it.Name, &it.Description, &it.HTMLURL,
			&it.Stars, &it.Topic, &it.PushedAt, &it.FirstSeen, &it.LastUpdated); err != nil {
			return nil, fmt.Errorf("scan radar item: %w", err)
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

// GetRadarMeta reads a radar_meta value; returns "" if the key is absent.
func (s *Store) GetRadarMeta(key string) (string, error) {
	var v string
	err := s.db.QueryRow(`SELECT value FROM radar_meta WHERE key = ?`, key).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("get radar meta: %w", err)
	}
	return v, nil
}

// SetRadarMeta writes a radar_meta key/value (upsert).
func (s *Store) SetRadarMeta(key, value string) error {
	_, err := s.db.Exec(`
		INSERT INTO radar_meta (key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value)
	if err != nil {
		return fmt.Errorf("set radar meta: %w", err)
	}
	return nil
}
```

- [ ] **Step 5: Запустить — убедиться, что проходит** (весь store-пакет):
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/store/ -v
```
Expected: PASS.

- [ ] **Step 6: gofmt + commit**
```bash
git add internal/store/store.go internal/store/radar.go internal/store/radar_test.go
for f in internal/store/radar.go internal/store/radar_test.go; do git show ":$f" | docker run --rm -i golang:1.26rc1 gofmt -d; done
git commit -m "feat(store): radar_items + radar_meta tables + CRUD (S5)"
```

---

### Task 3: `GitHubClient.SearchRepos`

**Files:**
- Modify: `internal/web/github.go` (метод `SearchRepos`)
- Test: `internal/web/github_test.go` (добавить тест; если файла нет — создать)

- [ ] **Step 1: Написать падающий тест.** Добавить в `internal/web/github_test.go` (package `web`):
```go
func TestSearchRepos(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/search/repositories" {
			t.Errorf("path = %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"items":[
			{"full_name":"o/mcp-x","name":"mcp-x","description":"d","html_url":"https://github.com/o/mcp-x","stargazers_count":12,"pushed_at":"2026-06-20T08:00:00Z","archived":false,"fork":false}
		]}`))
	}))
	defer srv.Close()

	c := &GitHubClient{BaseURL: srv.URL}
	repos, err := c.SearchRepos(context.Background(), "q=topic:mcp")
	if err != nil {
		t.Fatal(err)
	}
	if len(repos) != 1 {
		t.Fatalf("len = %d", len(repos))
	}
	r := repos[0]
	if r.FullName != "o/mcp-x" || r.Stars != 12 || r.HTMLURL == "" || r.PushedAt == "" {
		t.Fatalf("repo = %+v", r)
	}
}
```
Убедись, что в начале `github_test.go` импортированы `context`, `net/http`, `net/http/httptest`, `testing` (добавь недостающие).

- [ ] **Step 2: Запустить — убедиться, что падает**
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/web/ -run TestSearchRepos -v
```
Expected: FAIL — `SearchRepos` не определён.

- [ ] **Step 3: Реализовать.** В `internal/web/github.go` добавить импорт `"github.com/mtzanidakis/praktor/internal/radar"` (если его нет) и метод (после `GetFileContent` или рядом с прочими):
```go
// SearchRepos runs a GitHub repository search. The caller builds the query
// string (e.g. "q=topic:mcp+stars:>=10&sort=stars"). Returns radar DTOs.
func (c *GitHubClient) SearchRepos(ctx context.Context, query string) ([]radar.RadarRepo, error) {
	var raw struct {
		Items []struct {
			FullName    string `json:"full_name"`
			Name        string `json:"name"`
			Description string `json:"description"`
			HTMLURL     string `json:"html_url"`
			Stars       int    `json:"stargazers_count"`
			PushedAt    string `json:"pushed_at"`
			Archived    bool   `json:"archived"`
			Fork        bool   `json:"fork"`
		} `json:"items"`
	}
	if err := c.get(ctx, "/search/repositories?"+query, &raw); err != nil {
		return nil, err
	}
	out := make([]radar.RadarRepo, 0, len(raw.Items))
	for _, it := range raw.Items {
		out = append(out, radar.RadarRepo{
			FullName: it.FullName, Name: it.Name, Description: it.Description,
			HTMLURL: it.HTMLURL, Stars: it.Stars, PushedAt: it.PushedAt,
			Archived: it.Archived, Fork: it.Fork,
		})
	}
	return out, nil
}
```
Note: `internal/web` импортирует `internal/radar` — это ацикл (radar НЕ импортирует web). Убедись, что `*GitHubClient` теперь удовлетворяет `radar.RepoSearcher`.

- [ ] **Step 4: Запустить — убедиться, что проходит** (весь web-пакет):
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/web/ -run TestSearchRepos -v
```
Expected: PASS.

- [ ] **Step 5: gofmt + commit**
```bash
git add internal/web/github.go internal/web/github_test.go
for f in internal/web/github.go internal/web/github_test.go; do git show ":$f" | docker run --rm -i golang:1.26rc1 gofmt -d; done
git commit -m "feat(web): GitHubClient.SearchRepos for radar topic search (S5)"
```

---

### Task 4: Сборщик `Collector`

**Files:**
- Create: `internal/radar/collector.go`
- Test: `internal/radar/collector_test.go`

- [ ] **Step 1: Написать падающий тест** — создать `internal/radar/collector_test.go`:
```go
package radar

import (
	"context"
	"testing"
	"time"

	"github.com/mtzanidakis/praktor/internal/config"
	"github.com/mtzanidakis/praktor/internal/store"
)

type fakeSearcher struct {
	byQuery map[string][]RadarRepo
	calls   []string
}

func (f *fakeSearcher) SearchRepos(_ context.Context, query string) ([]RadarRepo, error) {
	f.calls = append(f.calls, query)
	return f.byQuery[query], nil
}

type fakeStore struct {
	items map[string]store.RadarItem
	meta  map[string]string
}

func newFakeStore() *fakeStore {
	return &fakeStore{items: map[string]store.RadarItem{}, meta: map[string]string{}}
}
func (f *fakeStore) UpsertRadarItem(it store.RadarItem) error {
	if existing, ok := f.items[it.FullName]; ok {
		it.FirstSeen = existing.FirstSeen // mimic the real preserve-first_seen
	}
	f.items[it.FullName] = it
	return nil
}
func (f *fakeStore) ListRadarItems() ([]store.RadarItem, error) {
	out := make([]store.RadarItem, 0, len(f.items))
	for _, v := range f.items {
		out = append(out, v)
	}
	return out, nil
}
func (f *fakeStore) GetRadarMeta(k string) (string, error) { return f.meta[k], nil }
func (f *fakeStore) SetRadarMeta(k, v string) error        { f.meta[k] = v; return nil }

func TestCollectOnceUpsertsAndFilters(t *testing.T) {
	now := time.Date(2026, 6, 24, 12, 0, 0, 0, time.UTC)
	fresh := now.Add(-2 * 24 * time.Hour).Format(time.RFC3339)
	cfg := config.RadarConfig{MinStars: 10, FreshnessDays: 30, Topics: []string{"mcp"}}

	search := &fakeSearcher{byQuery: map[string][]RadarRepo{}}
	// The collector builds the query; capture whatever it asks and return repos.
	// We register results under the exact query the collector will produce.
	q := buildSearchQuery("mcp", cfg.MinStars, cfg.FreshnessDays, now)
	search.byQuery[q] = []RadarRepo{
		{FullName: "o/good", Name: "good", HTMLURL: "u", Stars: 50, PushedAt: fresh},
		{FullName: "o/lowstars", Name: "low", HTMLURL: "u", Stars: 1, PushedAt: fresh},
	}
	st := newFakeStore()

	c := &Collector{Search: search, Store: st, Cfg: cfg, now: func() time.Time { return now }}
	if err := c.collectOnce(context.Background()); err != nil {
		t.Fatal(err)
	}

	items, _ := st.ListRadarItems()
	if len(items) != 1 || items[0].FullName != "o/good" {
		t.Fatalf("items = %+v, want only o/good (low stars filtered)", items)
	}
	if items[0].FirstSeen == "" || items[0].Topic != "mcp" {
		t.Fatalf("item not stamped: %+v", items[0])
	}
}
```

- [ ] **Step 2: Запустить — убедиться, что падает**
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/radar/ -run TestCollectOnce -v
```
Expected: FAIL — `Collector`/`buildSearchQuery` не определены.

- [ ] **Step 3: Реализовать** — создать `internal/radar/collector.go`:
```go
package radar

import (
	"context"
	"fmt"
	"log/slog"
	"net/url"
	"time"

	"github.com/mtzanidakis/praktor/internal/config"
	"github.com/mtzanidakis/praktor/internal/store"
)

// Collector periodically searches GitHub for ecosystem tooling and upserts hits.
type Collector struct {
	Search RepoSearcher
	Store  RadarStore
	Cfg    config.RadarConfig
	now    func() time.Time // injectable clock; nil → time.Now
}

// NewCollector builds a Collector with the real clock.
func NewCollector(search RepoSearcher, st RadarStore, cfg config.RadarConfig) *Collector {
	return &Collector{Search: search, Store: st, Cfg: cfg}
}

func (c *Collector) clock() time.Time {
	if c.now != nil {
		return c.now()
	}
	return time.Now().UTC()
}

// buildSearchQuery builds the GitHub repository-search query string for one topic.
func buildSearchQuery(topic string, minStars, freshnessDays int, now time.Time) string {
	since := now.Add(-time.Duration(freshnessDays) * 24 * time.Hour).Format("2006-01-02")
	q := fmt.Sprintf("topic:%s stars:>=%d pushed:>=%s archived:false fork:false", topic, minStars, since)
	return "q=" + url.QueryEscape(q) + "&sort=stars&order=desc&per_page=50"
}

// Run ticks every poll_interval until ctx is cancelled.
func (c *Collector) Run(ctx context.Context) {
	interval := c.Cfg.PollInterval
	if interval <= 0 {
		interval = 6 * time.Hour
	}
	c.collectOnce(ctx) // first pass immediately on startup
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := c.collectOnce(ctx); err != nil {
				slog.Error("radar collect failed", "error", err)
			}
		}
	}
}

// collectOnce runs one search-filter-upsert pass across all configured topics.
func (c *Collector) collectOnce(ctx context.Context) error {
	now := c.clock()
	stamp := now.Format(time.RFC3339)
	for _, topic := range c.Cfg.Topics {
		q := buildSearchQuery(topic, c.Cfg.MinStars, c.Cfg.FreshnessDays, now)
		repos, err := c.Search.SearchRepos(ctx, q)
		if err != nil {
			slog.Warn("radar search failed for topic", "topic", topic, "error", err)
			continue // a single topic failing must not abort the whole pass
		}
		for _, r := range repos {
			if !keepRepo(r, c.Cfg.MinStars, c.Cfg.FreshnessDays, now) {
				continue
			}
			c.Store.UpsertRadarItem(store.RadarItem{
				FullName: r.FullName, Name: r.Name, Description: r.Description,
				HTMLURL: r.HTMLURL, Stars: r.Stars, Topic: topic, PushedAt: r.PushedAt,
				FirstSeen: stamp, LastUpdated: stamp,
			})
		}
	}
	return nil
}
```
Note: `FirstSeen: stamp` ставится всегда, но `UpsertRadarItem` (Task 2) на конфликте first_seen НЕ перезаписывает — так что для известных repo он сохраняется.

- [ ] **Step 4: Запустить — убедиться, что проходит**
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/radar/ -v
```
Expected: PASS.

- [ ] **Step 5: gofmt + commit**
```bash
git add internal/radar/collector.go internal/radar/collector_test.go
for f in internal/radar/collector.go internal/radar/collector_test.go; do git show ":$f" | docker run --rm -i golang:1.26rc1 gofmt -d; done
git commit -m "feat(radar): Collector — topic search → filter → upsert (S5)"
```

---

### Task 5: Дайджест

**Files:**
- Create: `internal/radar/digest.go`
- Test: `internal/radar/digest_test.go`

- [ ] **Step 1: Написать падающий тест** — создать `internal/radar/digest_test.go`:
```go
package radar

import (
	"strings"
	"testing"

	"github.com/mtzanidakis/praktor/internal/store"
)

func TestBuildDigestPrompt(t *testing.T) {
	items := []store.RadarItem{
		{FullName: "o/alpha", Name: "alpha", Description: "an mcp server", Stars: 120, HTMLURL: "https://github.com/o/alpha"},
		{FullName: "o/beta", Name: "beta", Description: "a skill", Stars: 30, HTMLURL: "https://github.com/o/beta"},
	}
	p := buildDigestPrompt(items)
	for _, want := range []string{"o/alpha", "120", "o/beta", "an mcp server"} {
		if !strings.Contains(p, want) {
			t.Errorf("prompt missing %q\n%s", want, p)
		}
	}
}

func TestBuildDigestPromptEmpty(t *testing.T) {
	if buildDigestPrompt(nil) != "" {
		t.Error("empty items should yield empty prompt")
	}
}
```

- [ ] **Step 2: Запустить — убедиться, что падает**
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/radar/ -run TestBuildDigest -v
```
Expected: FAIL — `buildDigestPrompt` не определён.

- [ ] **Step 3: Реализовать** — создать `internal/radar/digest.go`:
```go
package radar

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/mtzanidakis/praktor/internal/config"
	"github.com/mtzanidakis/praktor/internal/store"
)

const lastDigestKey = "last_digest_at"

// buildDigestPrompt composes a human-facing digest prompt from new items.
// Returns "" when there is nothing to summarise.
func buildDigestPrompt(items []store.RadarItem) string {
	if len(items) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("Радар экосистемы Claude нашёл новые инструменты на GitHub с прошлого дайджеста. ")
	b.WriteString("Дай краткую сводку (2-4 предложения): что появилось интересного, на что обратить внимание.\n\n")
	for _, it := range items {
		fmt.Fprintf(&b, "- %s (%s★) — %s\n  %s\n", it.FullName, strconv.Itoa(it.Stars), it.Description, it.HTMLURL)
	}
	return b.String()
}

// Digest periodically summarises newly-seen radar items to Telegram via an agent.
type Digest struct {
	Store        RadarStore
	Handler      MessageHandler
	Cfg          config.RadarConfig
	DefaultAgent string
	MainChatID   int64
	now          func() time.Time
}

// NewDigest builds a Digest with the real clock.
func NewDigest(st RadarStore, h MessageHandler, cfg config.RadarConfig, defaultAgent string, mainChatID int64) *Digest {
	return &Digest{Store: st, Handler: h, Cfg: cfg, DefaultAgent: defaultAgent, MainChatID: mainChatID}
}

func (d *Digest) clock() time.Time {
	if d.now != nil {
		return d.now()
	}
	return time.Now().UTC()
}

// Run ticks every digest_interval until ctx is cancelled.
func (d *Digest) Run(ctx context.Context) {
	interval := d.Cfg.DigestInterval
	if interval <= 0 {
		interval = 168 * time.Hour
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := d.runOnce(ctx); err != nil {
				slog.Error("radar digest failed", "error", err)
			}
		}
	}
}

// runOnce sends one digest of items first-seen after the last digest timestamp.
func (d *Digest) runOnce(ctx context.Context) error {
	last, err := d.Store.GetRadarMeta(lastDigestKey)
	if err != nil {
		return err
	}
	items, err := d.Store.ListRadarItems()
	if err != nil {
		return err
	}
	var fresh []store.RadarItem
	for _, it := range items {
		if last == "" || it.FirstSeen > last {
			fresh = append(fresh, it)
		}
	}
	now := d.clock().Format(time.RFC3339)
	prompt := buildDigestPrompt(fresh)
	if prompt == "" {
		return d.Store.SetRadarMeta(lastDigestKey, now) // nothing new; advance watermark
	}
	meta := map[string]string{"sender": "radar"}
	if d.MainChatID != 0 {
		meta["chat_id"] = strconv.FormatInt(d.MainChatID, 10)
	}
	if err := d.Handler.HandleMessage(ctx, d.DefaultAgent, prompt, meta); err != nil {
		return err // leave the watermark so the next tick retries
	}
	return d.Store.SetRadarMeta(lastDigestKey, now)
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/radar/ -v
```
Expected: PASS.

- [ ] **Step 5: gofmt + commit**
```bash
git add internal/radar/digest.go internal/radar/digest_test.go
for f in internal/radar/digest.go internal/radar/digest_test.go; do git show ":$f" | docker run --rm -i golang:1.26rc1 gofmt -d; done
git commit -m "feat(radar): digest — summarise new items to Telegram via agent (S5)"
```

---

### Task 6: MC — `GET /api/radar`

**Files:**
- Create: `internal/web/radar.go`
- Modify: `internal/web/api.go` (маршрут)
- Test: `internal/web/radar_test.go`

- [ ] **Step 1: Написать падающий тест** — создать `internal/web/radar_test.go`:
```go
package web

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestHandleRadarEmpty(t *testing.T) {
	st := newTestStoreForWeb(t) // helper from capabilities_handler_test.go
	s := &Server{store: st, radarFreshnessDays: 30}
	rec := httptest.NewRecorder()
	s.handleRadar(rec, httptest.NewRequest(http.MethodGet, "/api/radar", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d", rec.Code)
	}
	var got radarResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Items == nil {
		t.Error("items should be non-nil empty slice, not null")
	}
	if len(got.Items) != 0 {
		t.Errorf("len = %d, want 0", len(got.Items))
	}
}

func TestHandleRadarIsNew(t *testing.T) {
	st := newTestStoreForWeb(t)
	now := time.Now().UTC()
	recent := now.Add(-2 * 24 * time.Hour).Format(time.RFC3339)
	old := now.Add(-100 * 24 * time.Hour).Format(time.RFC3339)
	_ = st.UpsertRadarItem(storeRadarItem("o/new", 50, recent))
	_ = st.UpsertRadarItem(storeRadarItem("o/old", 80, old))

	s := &Server{store: st, radarFreshnessDays: 30}
	rec := httptest.NewRecorder()
	s.handleRadar(rec, httptest.NewRequest(http.MethodGet, "/api/radar", nil))

	var got radarResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	byName := map[string]radarItem{}
	for _, it := range got.Items {
		byName[it.FullName] = it
	}
	if !byName["o/new"].IsNew {
		t.Error("o/new should be is_new=true")
	}
	if byName["o/old"].IsNew {
		t.Error("o/old should be is_new=false")
	}
}
```
Добавь хелпер в этот же файл (импортируй `store`):
```go
func storeRadarItem(fullName string, stars int, firstSeen string) store.RadarItem {
	return store.RadarItem{
		FullName: fullName, Name: fullName, HTMLURL: "https://github.com/" + fullName,
		Stars: stars, Topic: "mcp", PushedAt: firstSeen, FirstSeen: firstSeen, LastUpdated: firstSeen,
	}
}
```
И импорт `"github.com/mtzanidakis/praktor/internal/store"`.

- [ ] **Step 2: Запустить — убедиться, что падает**
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/web/ -run TestHandleRadar -v
```
Expected: FAIL — `handleRadar`/`radarResponse`/`radarItem`/`radarFreshnessDays` не определены.

- [ ] **Step 3: Реализовать.** Сначала добавь поле в `Server` struct (`internal/web/server.go`) рядом с прочими: `radarFreshnessDays int`. В `NewServer` после создания `srv` установи его из env с дефолтом:
```go
	srv.radarFreshnessDays = 30
	if v := os.Getenv("RADAR_FRESHNESS_DAYS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			srv.radarFreshnessDays = n
		}
	}
```
(Убедись, что `strconv` импортирован в server.go; если нет — добавь.)

Создать `internal/web/radar.go`:
```go
package web

import (
	"net/http"
	"time"

	"github.com/mtzanidakis/praktor/internal/store"
)

type radarItem struct {
	FullName    string `json:"full_name"`
	Name        string `json:"name"`
	Description string `json:"description"`
	HTMLURL     string `json:"html_url"`
	Stars       int    `json:"stars"`
	Topic       string `json:"topic"`
	PushedAt    string `json:"pushed_at,omitempty"`
	FirstSeen   string `json:"first_seen"`
	IsNew       bool   `json:"is_new"`
}

type radarResponse struct {
	Items []radarItem `json:"items"`
}

// handleRadar is GET /api/radar — the read-only ecosystem radar feed. Items are
// read straight from the local store (cheap query); is_new flags items first
// seen within radarFreshnessDays.
func (s *Server) handleRadar(w http.ResponseWriter, r *http.Request) {
	rows, err := s.store.ListRadarItems()
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	cutoff := time.Now().UTC().Add(-time.Duration(s.radarFreshnessDays) * 24 * time.Hour)
	items := make([]radarItem, 0, len(rows))
	for _, it := range rows {
		items = append(items, radarItem{
			FullName: it.FullName, Name: it.Name, Description: it.Description,
			HTMLURL: it.HTMLURL, Stars: it.Stars, Topic: it.Topic, PushedAt: it.PushedAt,
			FirstSeen: it.FirstSeen, IsNew: isNewItem(it, cutoff),
		})
	}
	jsonResponse(w, radarResponse{Items: items})
}

// isNewItem reports whether the item was first seen after the cutoff.
func isNewItem(it store.RadarItem, cutoff time.Time) bool {
	t, err := time.Parse(time.RFC3339, it.FirstSeen)
	if err != nil {
		return false
	}
	return t.After(cutoff)
}
```

В `internal/web/api.go` рядом с другими `/api/agents`-маршрутами добавить:
```go
	mux.HandleFunc("GET /api/radar", s.handleRadar)
```

- [ ] **Step 4: Запустить — убедиться, что проходит** (весь web-пакет)
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/web/ -v 2>&1 | tail -20
```
Expected: PASS.

- [ ] **Step 5: gofmt + commit**
```bash
git add internal/web/radar.go internal/web/radar_test.go internal/web/api.go internal/web/server.go
for f in internal/web/radar.go internal/web/radar_test.go; do git show ":$f" | docker run --rm -i golang:1.26rc1 gofmt -d; done
git commit -m "feat(web): GET /api/radar read-only feed + is_new flag (S5)"
```

---

### Task 7: Конфиг `RadarConfig` + запуск горутин в main.go

**Files:**
- Modify: `internal/config/config.go` (`RadarConfig` + поле в `Config` + дефолты)
- Modify: `cmd/praktor/main.go` (старт `Collector` + `Digest`)
- Test: `internal/config/config_test.go` (если есть — добавить кейс дефолтов; иначе пропустить тест-степ и проверить сборкой)

- [ ] **Step 1: Реализовать конфиг.** В `internal/config/config.go` в `type Config struct` добавить поле:
```go
	Radar     RadarConfig                  `yaml:"radar"`
```
Добавить тип (рядом с `SchedulerConfig`):
```go
// RadarConfig configures the S5 ecosystem radar (GitHub topic-search feed).
type RadarConfig struct {
	Enabled        bool          `yaml:"enabled"`
	PollInterval   time.Duration `yaml:"poll_interval"`
	MinStars       int           `yaml:"min_stars"`
	FreshnessDays  int           `yaml:"freshness_days"`
	Topics         []string      `yaml:"topics"`
	DigestEnabled  bool          `yaml:"digest_enabled"`
	DigestInterval time.Duration `yaml:"digest_interval"`
}
```
Найди функцию, применяющую дефолты (там, где `SchedulerConfig.PollInterval` дефолтится в `30 * time.Second`, ~строка 135). Добавь рядом дефолты радара (только если `Enabled`):
```go
	if cfg.Radar.Enabled {
		if cfg.Radar.PollInterval == 0 {
			cfg.Radar.PollInterval = 6 * time.Hour
		}
		if cfg.Radar.MinStars == 0 {
			cfg.Radar.MinStars = 10
		}
		if cfg.Radar.FreshnessDays == 0 {
			cfg.Radar.FreshnessDays = 30
		}
		if len(cfg.Radar.Topics) == 0 {
			cfg.Radar.Topics = []string{"mcp", "model-context-protocol", "claude-code"}
		}
		if cfg.Radar.DigestInterval == 0 {
			cfg.Radar.DigestInterval = 168 * time.Hour
		}
	}
```
(Сверь точное имя функции/структуры дефолтинга, читая config.go вокруг строки 135; примени дефолты в том же стиле.)

- [ ] **Step 2: Реализовать запуск в main.go.** В `cmd/praktor/main.go` после старта планировщика (`go sched.Start(ctx)`, ~строка 136) добавить:
```go
	if cfg.Radar.Enabled {
		radarGH := &web.GitHubClient{Token: os.Getenv("GITHUB_READ_TOKEN")}
		collector := radar.NewCollector(radarGH, db, cfg.Radar)
		go collector.Run(ctx)
		if cfg.Radar.DigestEnabled {
			digest := radar.NewDigest(db, orch, cfg.Radar, cfg.Router.DefaultAgent, cfg.Telegram.MainChatID)
			go digest.Run(ctx)
		}
		slog.Info("radar started", "poll_interval", cfg.Radar.PollInterval, "digest", cfg.Radar.DigestEnabled)
	}
```
Добавь импорты `"github.com/mtzanidakis/praktor/internal/radar"` и `"github.com/mtzanidakis/praktor/internal/web"` (web уже импортирован), и `"os"`/`"log/slog"` (вероятно уже есть). `db` — это `*store.Store` (удовлетворяет `radar.RadarStore`); `orch` — `*agent.Orchestrator` (удовлетворяет `radar.MessageHandler`); `*web.GitHubClient` удовлетворяет `radar.RepoSearcher`.

Note про hot-reload: для v1 `Radar.Enabled` — стартовый гейт (горутины стартуют при запуске, если enabled). Hot-reload интервалов/enabled НЕ требуется (YAGNI; конфиг радара меняется редко). Изменение `radar:` → перезапуск процесса (как `web.port`).

- [ ] **Step 3: Проверить сборку + vet + существующие тесты конфига**
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 sh -c "go build ./... && go vet ./... && go test ./internal/config/ ./cmd/... -v 2>&1 | tail -15"
```
Expected: BUILD OK, vet clean, config/cmd тесты PASS (или «no test files»).

- [ ] **Step 4: gofmt + commit**
```bash
git add internal/config/config.go cmd/praktor/main.go
for f in internal/config/config.go cmd/praktor/main.go; do git show ":$f" | docker run --rm -i golang:1.26rc1 gofmt -d; done
git commit -m "feat: RadarConfig + start collector/digest goroutines (S5)"
```

---

### Task 8: React — страница Radar

**Files:**
- Create: `ui/src/pages/radarStatus.ts`
- Create: `ui/src/pages/__tests__/radarStatus.test.ts`
- Create: `ui/src/pages/Radar.tsx`
- Modify: `ui/src/App.tsx` (lazy route + nav + icon)

- [ ] **Step 1: Написать падающий тест** — создать `ui/src/pages/__tests__/radarStatus.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { formatStars, type RadarItem } from '../radarStatus';

describe('formatStars', () => {
  it('passes small numbers through', () => {
    expect(formatStars(42)).toBe('42');
  });
  it('abbreviates thousands', () => {
    expect(formatStars(1500)).toBe('1.5k');
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**
```bash
cd ui && npx vitest run src/pages/__tests__/radarStatus.test.ts
```
Expected: FAIL — `../radarStatus` не существует.

- [ ] **Step 3: Реализовать хелперы** — создать `ui/src/pages/radarStatus.ts`:
```ts
export interface RadarItem {
  full_name: string;
  name: string;
  description: string;
  html_url: string;
  stars: number;
  topic: string;
  pushed_at?: string;
  first_seen: string;
  is_new: boolean;
}

export interface RadarResponse {
  items: RadarItem[];
}

// formatStars renders a star count compactly (1500 → "1.5k").
export function formatStars(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**
```bash
cd ui && npx vitest run src/pages/__tests__/radarStatus.test.ts
```
Expected: PASS.

- [ ] **Step 5: Реализовать страницу** — создать `ui/src/pages/Radar.tsx`:
```tsx
import { useState, useEffect, useCallback } from 'react';
import { formatStars, type RadarResponse, type RadarItem } from './radarStatus';

const card: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: 10, padding: 16, boxShadow: 'var(--shadow)', marginBottom: 12,
};
const chip: React.CSSProperties = {
  display: 'inline-block', padding: '2px 8px', borderRadius: 6,
  border: '1px solid var(--border)', fontSize: 12, marginLeft: 8,
};

function RadarRow({ it }: { it: RadarItem }) {
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <a href={it.html_url} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>
            {it.full_name}
          </a>
          {it.is_new && <span style={{ ...chip, borderColor: 'var(--accent, #0F8B5C)', color: 'var(--accent, #0F8B5C)' }}>new</span>}
          <span style={chip}>{it.topic}</span>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
            {it.description || '—'}
          </div>
        </div>
        <div style={{ whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontSize: 13 }}>
          ★ {formatStars(it.stars)}
        </div>
      </div>
    </div>
  );
}

function Radar() {
  const [items, setItems] = useState<RadarItem[]>([]);

  const fetchData = useCallback(() => {
    fetch('/api/radar')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('load failed'))))
      .then((d: RadarResponse) => setItems(d.items || []))
      .catch(() => setItems([]));
  }, []);
  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 16 }}>Радар экосистемы</h1>
      {items.length === 0 && <div style={card}>Радар пуст или выключен.</div>}
      {items.map((it) => <RadarRow key={it.full_name} it={it} />)}
    </div>
  );
}

export default Radar;
```

- [ ] **Step 6: Подключить навигацию.** В `ui/src/App.tsx` (СНАЧАЛА прочитай файл, повтори паттерны соседних страниц Catalog/Plans):
1. Рядом с прочими `lazy(...)`:
```tsx
const Radar = lazy(() => import('./pages/Radar'));
```
2. Icon-компонент рядом с прочими `Icon*`:
```tsx
function IconRadar() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6.5" />
      <circle cx="8" cy="8" r="3" />
      <path d="M8 8l4-4" />
    </svg>
  );
}
```
3. В `navItems` (после Catalog):
```tsx
  { to: '/radar', label: 'Radar', Icon: IconRadar },
```
4. В `<Routes>`:
```tsx
            <Route path="/radar" element={<Radar />} />
```

- [ ] **Step 7: Запустить тест + build**
```bash
cd ui && npx vitest run && npm run build
```
Expected: vitest PASS (incl. radarStatus.test.ts); build OK; в выводе чанк `Radar-*.js`.

- [ ] **Step 8: Commit**
```bash
git add ui/src/pages/radarStatus.ts ui/src/pages/__tests__/radarStatus.test.ts ui/src/pages/Radar.tsx ui/src/App.tsx
git commit -m "feat(ui): Radar page — read-only ecosystem feed (S5)"
```

---

## Развёртывание и верификация (после реализации)

**Финальные гейты перед PR (всё зелёное):**
- Go: `go build ./...`, `go vet ./...`, `go test ./...` в Docker (полный прогон без `| tail` — pipe-exit маскирует FAIL). Пакеты S5: `radar`, `store`, `web`, `config` — PASS. (`natsbus TestPubSub` — известный load-флак, изолированно зелёный.)
- gofmt по git-блобам новых/изменённых `.go` — пусто.
- UI: `npx vitest run` PASS, `npm run build` (чанк `Radar-*.js`).

**PR форка:** `gh pr create --repo Meta-Psy/praktor --base main --head feature/s5-ecosystem-radar` (заголовок «feat: S5 ecosystem radar», тело — ссылки на design+plan, список изменений).

**[ALEX]-гейты (новых секретов нет — реюз `GITHUB_READ_TOKEN`):**
1. merge PR `Meta-Psy/praktor#?` (хард-правило #1).
2. добавить `radar:` блок в серверный `~/praktor` конфиг (`enabled: true`, опц. `digest_enabled`).
3. `~/praktor/redeploy.sh` (ТОЛЬКО gateway — agent-runner не трогался, отдельный agent-build НЕ нужен). Проверка: `curl -s -o /dev/null -w '%{http_code}' localhost:8080/api/radar` → 401 (за auth = маршрут жив); asset `Radar-*.js` = 200.
4. **phone-verify** `mc.alexmetapsy.com` (инкогнито/сброс PWA-SW):
   - Страница **Radar** в nav → после первого скан-тика (сразу на старте) показывает найденные репо (имя-ссылка, ⭐, топик, бейдж new).
   - (Опц.) При `digest_enabled: true` — в Telegram `main_chat_id` приходит LLM-сводка новых инструментов.

После зелёного → **S5 ЗАКРЫТ** (roadmap doing→done), остаётся S6.

---

## Self-Review

**Spec coverage:**
- D1 (осведомлённость, read-only) → Task 6 (read-only хендлер) + Task 8 (страница без мутаций) ✅
- D2 (GitHub Search topics) → Task 3 (`SearchRepos`) + Task 4 (`buildSearchQuery` по топикам) ✅
- D3 (гибрид: механическое ядро + опц. LLM) → Task 4 (механический сбор) + Task 5 (опц. дайджест) ✅
- D4 (Подход 1: Go-сборщик + MC + дайджест через агент→TG) → Task 4/6/5, дайджест через `orch.HandleMessage` (Task 5/7) ✅
- Архитектура (слабая связь, интерфейсы) → Task 1 (`RepoSearcher`/`RadarStore`/`MessageHandler`), импорт-граф store←radar←web←main ✅
- Модель данных (`radar_items`, `radar_meta`) → Task 2 ✅
- Фильтр/дедуп/новизна → Task 1 (`keepRepo`), Task 2 (upsert PK + first_seen preserve), Task 6 (`is_new`) ✅
- Конфиг (`RadarConfig`, gated `enabled`, реюз `GITHUB_READ_TOKEN`) → Task 7 ✅
- Обработка ошибок (search non-200 пропуск тика; пустой стор → `{items:[]}`; дайджест retry на ошибке) → Task 4 (`continue`), Task 6, Task 5 ✅
- Не-цели (без install/quality-score/FTS/code-search/тредов) → соблюдены ✅
- Деплой (только gateway, redeploy.sh) → раздел развёртывания ✅

**Placeholder scan:** код в каждом шаге; PR-номер `#?` — корректный pre-open плейсхолдер. Чисто. (Task 1 Step 4 содержит явную инструкцию о порядке Task2→Task1 — это указание исполнителю, не плейсхолдер.)

**Type consistency:** `RadarRepo` (Task 1) ↔ возврат `SearchRepos` (Task 3) ↔ вход `keepRepo`/`collectOnce` (Task 1/4); `store.RadarItem` (Task 2) ↔ `RadarStore.UpsertRadarItem`/`ListRadarItems` (Task 1 интерфейс) ↔ маппинг в `collectOnce` (Task 4) ↔ чтение в `handleRadar` (Task 6) ↔ вход `buildDigestPrompt` (Task 5); `RepoSearcher.SearchRepos(ctx, query)` (Task 1) ↔ `*GitHubClient.SearchRepos` (Task 3); `MessageHandler.HandleMessage(ctx, agentID, text, meta)` (Task 1) ↔ `*Orchestrator.HandleMessage` (существующий) ↔ вызов в `digest.runOnce` (Task 5); `config.RadarConfig` поля (Task 7) ↔ использование в `Collector`/`Digest` (Task 4/5); `buildSearchQuery(topic, minStars, freshnessDays, now)` (Task 4) ↔ вызов в тесте (Task 4); `radarItem`/`radarResponse` JSON-теги (Task 6) ↔ TS `RadarItem`/`RadarResponse` (Task 8). Согласовано.
