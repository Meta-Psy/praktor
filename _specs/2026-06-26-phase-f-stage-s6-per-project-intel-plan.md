# S6 — Per-project periodic intel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read-only "Intel" page in Mission Control: a Go collector periodically asks a Claude agent to scrape per-project sources described in YAML, stores each structured snapshot with an agent-written `change_note`, and surfaces the history.

**Architecture:** One loosely-coupled host component. `internal/intel.Collector` runs a per-source goroutine; on each cron tick it loads the previous snapshot, builds a prompt, asks an agent via a new synchronous `Orchestrator.RunCapture` (request→reply, **not** delivered to Telegram), parses the fenced-JSON response, and inserts a snapshot row. The MC handler reads the local store. Import graph `store ← intel ← web ← main`; `intel` is isolated behind `SnapshotStore` / `AgentRunner` interfaces, mirroring how S5 isolated `radar`.

**Tech Stack:** Go 1.26 (`modernc.org/sqlite`, `github.com/adhocore/gronx`), React 19 + Vite + vitest.

**Spec:** `_specs/2026-06-26-phase-f-stage-s6-per-project-intel-design.md`

**Ветка:** `feature/s6-per-project-intel` (форк `Meta-Psy/praktor`, от `origin/main` = `c2dc751` = S5 merge).

**Verification env (Go):** все Go-проверки в Docker. `MSYS_NO_PATHCONV=1` — ВНЕШНИЙ префикс шелла:
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src \
  -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build \
  -e GOTOOLCHAIN=auto golang:1.26rc1 <cmd>
```
gofmt по git-блобам: `git show :path/file.go | docker run --rm -i golang:1.26rc1 gofmt -d` (пусто = ок). UI — `npm`/`npx` на хосте (`cd ui`).

**ВАЖНО:** S6 трогает только gateway (НЕ `agent-runner/`) → деплой = `redeploy.sh`, отдельный agent-build НЕ нужен.

**Структура файлов:**
| Файл | Ответственность |
|------|-----------------|
| `internal/store/intel.go` | таблица `intel_snapshots` + `IntelSnapshot` + Insert/Latest/List |
| `internal/store/store.go` | миграция `intel_snapshots` (+ индекс) |
| `internal/config/config.go` | `IntelConfig`, `IntelSource`, `applyIntelDefaults` |
| `internal/intel/intel.go` | `Snapshot` + интерфейсы `SnapshotStore`, `AgentRunner` |
| `internal/intel/prompt.go` | `buildPrompt`, `parseSnapshot` |
| `internal/intel/collector.go` | `Collector`, `collectOnce`, `Run` (gronx per source) |
| `internal/agent/orchestrator.go` | `RunCapture` + ранний `return` для intel-meta в `handleAgentOutput` |
| `internal/web/intel.go` | `GET /api/intel` (группировка project→source + история) |
| `internal/web/api.go` | регистрация маршрута |
| `cmd/praktor/main.go` | старт горутины (gated `intel.enabled`) |
| `ui/src/pages/Intel.tsx`, `intelStatus.ts`, nav | страница MC |

---

### Task 1: store — таблица `intel_snapshots` + CRUD

**Files:**
- Create: `internal/store/intel.go`
- Modify: `internal/store/store.go` (добавить миграцию в срез `migrations`)
- Test: `internal/store/intel_test.go`

- [ ] **Step 1: Написать падающий тест** — создать `internal/store/intel_test.go`:
```go
package store

import "testing"

func TestIntelSnapshotInsertLatestList(t *testing.T) {
	s := newTestStore(t)

	if _, err := s.LatestSnapshot("mentis-centers"); err != nil {
		t.Fatalf("LatestSnapshot on empty: %v", err)
	}
	if latest, _ := s.LatestSnapshot("mentis-centers"); latest != nil {
		t.Fatalf("expected nil latest on empty, got %+v", latest)
	}

	first := IntelSnapshot{
		SourceKey: "mentis-centers", Project: "mentis", CapturedAt: 1000,
		Payload: `{"summary":"40 centers"}`, ChangeNote: "first snapshot", OK: true,
	}
	if err := s.InsertIntelSnapshot(first); err != nil {
		t.Fatalf("insert first: %v", err)
	}
	second := IntelSnapshot{
		SourceKey: "mentis-centers", Project: "mentis", CapturedAt: 2000,
		Payload: `{"summary":"42 centers"}`, ChangeNote: "+2 centers", OK: true,
	}
	if err := s.InsertIntelSnapshot(second); err != nil {
		t.Fatalf("insert second: %v", err)
	}

	latest, err := s.LatestSnapshot("mentis-centers")
	if err != nil || latest == nil {
		t.Fatalf("LatestSnapshot: %v, %+v", err, latest)
	}
	if latest.CapturedAt != 2000 || latest.ChangeNote != "+2 centers" {
		t.Errorf("latest = %+v, want CapturedAt=2000", latest)
	}

	all, err := s.ListIntelSnapshots()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(all) != 2 {
		t.Fatalf("len = %d, want 2", len(all))
	}
	if all[0].CapturedAt != 2000 {
		t.Errorf("list not newest-first: %+v", all[0])
	}
}
```

> **Note:** `newTestStore(t)` — существующий хелпер в `internal/store` (используется radar_test.go). Если его сигнатура иная, скопируй из `radar_test.go`.

- [ ] **Step 2: Запустить — убедиться, что падает**
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/store/ -run TestIntelSnapshot -v
```
Expected: FAIL — `IntelSnapshot`/`InsertIntelSnapshot`/`LatestSnapshot`/`ListIntelSnapshots` не существуют, таблицы нет.

- [ ] **Step 3: Добавить миграцию** — в `internal/store/store.go`, в срез `migrations` (после блока `radar_meta`, перед закрывающей `}` среза на строке ~155), добавить:
```go
		`CREATE TABLE IF NOT EXISTS intel_snapshots (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			source_key  TEXT NOT NULL,
			project     TEXT NOT NULL,
			captured_at INTEGER NOT NULL,
			payload     TEXT NOT NULL DEFAULT '',
			change_note TEXT NOT NULL DEFAULT '',
			ok          INTEGER NOT NULL DEFAULT 1,
			error       TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE INDEX IF NOT EXISTS idx_intel_source_captured
			ON intel_snapshots (source_key, captured_at DESC)`,
```

- [ ] **Step 4: Реализовать CRUD** — создать `internal/store/intel.go`:
```go
package store

import "fmt"

// IntelSnapshot is one periodic collection result for a configured S6 source.
type IntelSnapshot struct {
	ID         int64
	SourceKey  string
	Project    string
	CapturedAt int64 // unix epoch seconds
	Payload    string // agent JSON: {summary, metrics, items}
	ChangeNote string // agent-written diff vs the previous snapshot
	OK         bool
	Error      string
}

// InsertIntelSnapshot appends one snapshot row (history is append-only).
func (s *Store) InsertIntelSnapshot(snap IntelSnapshot) error {
	ok := 0
	if snap.OK {
		ok = 1
	}
	_, err := s.db.Exec(`
		INSERT INTO intel_snapshots (source_key, project, captured_at, payload, change_note, ok, error)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		snap.SourceKey, snap.Project, snap.CapturedAt, snap.Payload, snap.ChangeNote, ok, snap.Error)
	if err != nil {
		return fmt.Errorf("insert intel snapshot: %w", err)
	}
	return nil
}

// LatestSnapshot returns the newest snapshot for a source key, or nil if none.
func (s *Store) LatestSnapshot(sourceKey string) (*IntelSnapshot, error) {
	row := s.db.QueryRow(`
		SELECT id, source_key, project, captured_at, payload, change_note, ok, error
		FROM intel_snapshots WHERE source_key = ?
		ORDER BY captured_at DESC, id DESC LIMIT 1`, sourceKey)
	snap, err := scanIntelSnapshot(row)
	if err == errNoIntelRow {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("latest snapshot: %w", err)
	}
	return snap, nil
}

// ListIntelSnapshots returns all snapshots, newest first.
func (s *Store) ListIntelSnapshots() ([]IntelSnapshot, error) {
	rows, err := s.db.Query(`
		SELECT id, source_key, project, captured_at, payload, change_note, ok, error
		FROM intel_snapshots ORDER BY captured_at DESC, id DESC`)
	if err != nil {
		return nil, fmt.Errorf("list intel snapshots: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var out []IntelSnapshot
	for rows.Next() {
		var snap IntelSnapshot
		var ok int
		if err := rows.Scan(&snap.ID, &snap.SourceKey, &snap.Project, &snap.CapturedAt,
			&snap.Payload, &snap.ChangeNote, &ok, &snap.Error); err != nil {
			return nil, fmt.Errorf("scan intel snapshot: %w", err)
		}
		snap.OK = ok == 1
		out = append(out, snap)
	}
	return out, rows.Err()
}

var errNoIntelRow = fmt.Errorf("no intel row")

type rowScanner interface{ Scan(dest ...any) error }

func scanIntelSnapshot(row rowScanner) (*IntelSnapshot, error) {
	var snap IntelSnapshot
	var ok int
	err := row.Scan(&snap.ID, &snap.SourceKey, &snap.Project, &snap.CapturedAt,
		&snap.Payload, &snap.ChangeNote, &ok, &snap.Error)
	if err != nil {
		// database/sql returns sql.ErrNoRows; normalize to sentinel.
		if err.Error() == "sql: no rows in result set" {
			return nil, errNoIntelRow
		}
		return nil, err
	}
	snap.OK = ok == 1
	return &snap, nil
}
```

> **Note (DRY):** если в `internal/store` уже есть тип-сканер или хелпер `sql.ErrNoRows`-нормализации (см. `radar.go` использует `errors.Is(err, sql.ErrNoRows)`), используй `errors.Is` напрямую вместо строкового сравнения. Предпочтительно:
> ```go
> import ("database/sql"; "errors")
> // в LatestSnapshot: if errors.Is(err, sql.ErrNoRows) { return nil, nil }
> ```
> и сделать `LatestSnapshot` через `QueryRow(...).Scan(...)` без `scanIntelSnapshot`. Выбери вариант, согласованный с `radar.go`.

- [ ] **Step 5: Запустить — убедиться, что проходит**
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/store/ -run TestIntelSnapshot -v
```
Expected: PASS.

- [ ] **Step 6: gofmt + commit**
```bash
git show :internal/store/intel.go | docker run --rm -i golang:1.26rc1 gofmt -d   # пусто = ок
git add internal/store/intel.go internal/store/intel_test.go internal/store/store.go
git commit -m "feat(store): intel_snapshots table + Insert/Latest/List (S6)"
```

---

### Task 2: config — `IntelConfig` + `applyIntelDefaults`

**Files:**
- Modify: `internal/config/config.go` (тип + поле в `Config` + дефолты)
- Test: `internal/config/config_test.go` (добавить тест)

- [ ] **Step 1: Написать падающий тест** — добавить в `internal/config/config_test.go`:
```go
func TestApplyIntelDefaults(t *testing.T) {
	cfg := Config{
		Router: RouterConfig{DefaultAgent: "general"},
		Intel: IntelConfig{
			Enabled: true,
			Sources: []IntelSource{
				{Key: "a", Project: "p", Name: "A", Instruction: "do x"},                          // no cron, no agent
				{Key: "b", Project: "p", Name: "B", Instruction: "do y", Cron: "0 0 * * *", Agent: "researcher"},
			},
		},
	}
	applyIntelDefaults(&cfg)

	if cfg.Intel.Sources[0].Cron == "" {
		t.Error("source[0] cron not defaulted")
	}
	if cfg.Intel.Sources[0].Agent != "general" {
		t.Errorf("source[0] agent = %q, want general", cfg.Intel.Sources[0].Agent)
	}
	if cfg.Intel.Sources[1].Cron != "0 0 * * *" {
		t.Error("source[1] cron overwritten")
	}
	if cfg.Intel.Sources[1].Agent != "researcher" {
		t.Error("source[1] agent overwritten")
	}
}
```

- [ ] **Step 2: Запустить — убедиться, что падает**
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/config/ -run TestApplyIntelDefaults -v
```
Expected: FAIL — `IntelConfig`/`IntelSource`/`applyIntelDefaults` не существуют.

- [ ] **Step 3: Реализовать** — в `internal/config/config.go`:

(a) добавить поле в структуру `Config` (рядом с `Radar`):
```go
	Intel     IntelConfig                  `yaml:"intel"`
```

(b) добавить типы (рядом с `RadarConfig`):
```go
// IntelConfig configures the S6 per-project periodic intel collector.
type IntelConfig struct {
	Enabled bool          `yaml:"enabled"`
	Sources []IntelSource `yaml:"sources"`
}

// IntelSource is one pre-described source the collector scrapes on a schedule.
type IntelSource struct {
	Key         string `yaml:"key"`         // stable id, snapshot grouping key
	Project     string `yaml:"project"`     // ties to projects: map / portfolio
	Name        string `yaml:"name"`        // human label
	Instruction string `yaml:"instruction"` // NL scrape instruction for the agent
	Cron        string `yaml:"cron"`        // gronx expression; default weekly
	Agent       string `yaml:"agent"`       // agent id; default router.default_agent
}
```

(c) добавить функцию дефолтов:
```go
// applyIntelDefaults fills per-source cron/agent fallbacks. Mirrors applyRadarDefaults.
func applyIntelDefaults(cfg *Config) {
	for i := range cfg.Intel.Sources {
		if cfg.Intel.Sources[i].Cron == "" {
			cfg.Intel.Sources[i].Cron = "0 9 * * 1" // weekly, Mon 09:00
		}
		if cfg.Intel.Sources[i].Agent == "" {
			cfg.Intel.Sources[i].Agent = cfg.Router.DefaultAgent
		}
	}
}
```

(d) вызвать в `Load` рядом с `applyRadarDefaults(&cfg)` (строка ~198):
```go
	applyRadarDefaults(&cfg)
	applyIntelDefaults(&cfg)
```

- [ ] **Step 4: Запустить — убедиться, что проходит**
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/config/ -run TestApplyIntelDefaults -v
```
Expected: PASS.

- [ ] **Step 5: gofmt + commit**
```bash
git show :internal/config/config.go | docker run --rm -i golang:1.26rc1 gofmt -d
git add internal/config/config.go internal/config/config_test.go
git commit -m "feat(config): IntelConfig + applyIntelDefaults (S6)"
```

---

### Task 3: intel — типы + интерфейсы

**Files:**
- Create: `internal/intel/intel.go`

(Тест отдельный не нужен — типы покрываются тестами Task 4/5. Сборка пакета проверяется в Task 4.)

- [ ] **Step 1: Реализовать** — создать `internal/intel/intel.go`:
```go
// Package intel runs the S6 per-project periodic intel collector: on a per-source
// schedule it asks an agent to scrape a pre-described source, stores a structured
// snapshot with an agent-written change note, and surfaces history read-only in
// Mission Control. It is isolated from the agent and store packages via the
// SnapshotStore / AgentRunner interfaces.
package intel

import (
	"context"

	"github.com/mtzanidakis/praktor/internal/store"
)

// Snapshot is the parsed agent response (transient DTO, pre-persistence).
type Snapshot struct {
	Summary    string           `json:"summary"`
	Metrics    map[string]any   `json:"metrics"`
	Items      []map[string]any `json:"items"`
	ChangeNote string           `json:"change_note"`
}

// SnapshotStore is the persistence the collector needs. Satisfied by *store.Store.
type SnapshotStore interface {
	InsertIntelSnapshot(snap store.IntelSnapshot) error
	LatestSnapshot(sourceKey string) (*store.IntelSnapshot, error)
}

// AgentRunner dispatches a prompt to an agent and returns its text response
// synchronously (no Telegram delivery). Satisfied by *agent.Orchestrator.
type AgentRunner interface {
	RunCapture(ctx context.Context, agentID, prompt string) (string, error)
}
```

- [ ] **Step 2: Сборка**
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 go build ./internal/intel/
```
Expected: успешная сборка (no output).

- [ ] **Step 3: gofmt + commit**
```bash
git show :internal/intel/intel.go | docker run --rm -i golang:1.26rc1 gofmt -d
git add internal/intel/intel.go
git commit -m "feat(intel): Snapshot + SnapshotStore/AgentRunner interfaces (S6)"
```

---

### Task 4: intel — `buildPrompt` + `parseSnapshot`

**Files:**
- Create: `internal/intel/prompt.go`
- Test: `internal/intel/prompt_test.go`

- [ ] **Step 1: Написать падающий тест** — создать `internal/intel/prompt_test.go`:
```go
package intel

import (
	"strings"
	"testing"

	"github.com/mtzanidakis/praktor/internal/store"
)

func TestBuildPrompt(t *testing.T) {
	// no previous snapshot
	p := buildPrompt("Count centers", nil)
	if !strings.Contains(p, "Count centers") {
		t.Error("prompt missing instruction")
	}
	if !strings.Contains(p, "change_note") {
		t.Error("prompt missing output contract")
	}
	if !strings.Contains(p, "first snapshot") {
		t.Error("prompt should note this is the first snapshot")
	}

	// with previous snapshot
	prev := &store.IntelSnapshot{Payload: `{"summary":"40 centers"}`}
	p2 := buildPrompt("Count centers", prev)
	if !strings.Contains(p2, "40 centers") {
		t.Error("prompt should embed previous snapshot payload")
	}
}

func TestParseSnapshot(t *testing.T) {
	cases := []struct {
		name    string
		in      string
		wantErr bool
		summary string
		note    string
	}{
		{
			name:    "fenced json",
			in:      "Here is the result:\n```json\n{\"summary\":\"42 centers\",\"change_note\":\"+2\"}\n```\nDone.",
			summary: "42 centers", note: "+2",
		},
		{
			name:    "bare json",
			in:      `{"summary":"x","metrics":{"n":5},"change_note":"first snapshot"}`,
			summary: "x", note: "first snapshot",
		},
		{name: "garbage", in: "no json here", wantErr: true},
		{name: "empty", in: "", wantErr: true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			snap, err := parseSnapshot(c.in)
			if c.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if snap.Summary != c.summary {
				t.Errorf("summary = %q, want %q", snap.Summary, c.summary)
			}
			if snap.ChangeNote != c.note {
				t.Errorf("change_note = %q, want %q", snap.ChangeNote, c.note)
			}
		})
	}
}
```

- [ ] **Step 2: Запустить — убедиться, что падает**
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/intel/ -v
```
Expected: FAIL — `buildPrompt`/`parseSnapshot` не существуют.

- [ ] **Step 3: Реализовать** — создать `internal/intel/prompt.go`:
```go
package intel

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/mtzanidakis/praktor/internal/store"
)

const outputContract = `Return ONLY a single JSON object in a fenced code block, with this shape:
{
  "summary": "1-2 sentences on the current state",
  "metrics": { "<name>": <number> },
  "items": [ { "name": "...", "note": "..." } ],
  "change_note": "what changed vs the previous snapshot"
}`

// buildPrompt assembles the scrape instruction, the previous snapshot (if any),
// and the structured-output contract into one agent prompt.
func buildPrompt(instruction string, prev *store.IntelSnapshot) string {
	var b strings.Builder
	b.WriteString(instruction)
	b.WriteString("\n\n")
	if prev != nil && prev.Payload != "" {
		b.WriteString("Previous snapshot (compare against it for change_note):\n")
		b.WriteString(prev.Payload)
		b.WriteString("\n\n")
	} else {
		b.WriteString("There is no previous snapshot — set change_note to \"first snapshot\".\n\n")
	}
	b.WriteString(outputContract)
	return b.String()
}

// parseSnapshot extracts the JSON object from an agent response. It tolerates a
// fenced ```json block or a bare object embedded in prose.
func parseSnapshot(text string) (Snapshot, error) {
	raw := extractJSON(text)
	if raw == "" {
		return Snapshot{}, fmt.Errorf("no JSON object found in agent response")
	}
	var snap Snapshot
	if err := json.Unmarshal([]byte(raw), &snap); err != nil {
		return Snapshot{}, fmt.Errorf("unmarshal snapshot: %w", err)
	}
	return snap, nil
}

// extractJSON returns the first balanced {...} region of s, or "".
func extractJSON(s string) string {
	start := strings.Index(s, "{")
	if start < 0 {
		return ""
	}
	depth := 0
	for i := start; i < len(s); i++ {
		switch s[i] {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return s[start : i+1]
			}
		}
	}
	return ""
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/intel/ -v
```
Expected: PASS (TestBuildPrompt, TestParseSnapshot).

- [ ] **Step 5: gofmt + commit**
```bash
git show :internal/intel/prompt.go | docker run --rm -i golang:1.26rc1 gofmt -d
git add internal/intel/prompt.go internal/intel/prompt_test.go
git commit -m "feat(intel): buildPrompt + parseSnapshot with JSON extraction (S6)"
```

---

### Task 5: intel — `Collector` + `collectOnce` + `Run`

**Files:**
- Create: `internal/intel/collector.go`
- Test: `internal/intel/collector_test.go`

- [ ] **Step 1: Написать падающий тест** — создать `internal/intel/collector_test.go`:
```go
package intel

import (
	"context"
	"errors"
	"testing"

	"github.com/mtzanidakis/praktor/internal/config"
	"github.com/mtzanidakis/praktor/internal/store"
)

type fakeRunner struct {
	resp string
	err  error
	gotPrompt string
}

func (f *fakeRunner) RunCapture(_ context.Context, _, prompt string) (string, error) {
	f.gotPrompt = prompt
	return f.resp, f.err
}

type fakeStore struct {
	latest    *store.IntelSnapshot
	inserted  []store.IntelSnapshot
}

func (f *fakeStore) InsertIntelSnapshot(snap store.IntelSnapshot) error {
	f.inserted = append(f.inserted, snap)
	return nil
}
func (f *fakeStore) LatestSnapshot(string) (*store.IntelSnapshot, error) { return f.latest, nil }

func TestCollectOnceSuccess(t *testing.T) {
	r := &fakeRunner{resp: "```json\n{\"summary\":\"42 centers\",\"change_note\":\"+2\"}\n```"}
	st := &fakeStore{}
	c := NewCollector(r, st, config.IntelConfig{})
	c.now = func() int64 { return 12345 }

	src := config.IntelSource{Key: "k", Project: "p", Instruction: "count", Agent: "general"}
	if err := c.collectOnce(context.Background(), src); err != nil {
		t.Fatalf("collectOnce: %v", err)
	}
	if len(st.inserted) != 1 {
		t.Fatalf("inserted = %d, want 1", len(st.inserted))
	}
	got := st.inserted[0]
	if !got.OK || got.SourceKey != "k" || got.Project != "p" || got.CapturedAt != 12345 {
		t.Errorf("snapshot = %+v", got)
	}
	if got.ChangeNote != "+2" {
		t.Errorf("change_note = %q, want +2", got.ChangeNote)
	}
}

func TestCollectOnceAgentError(t *testing.T) {
	r := &fakeRunner{err: errors.New("agent down")}
	st := &fakeStore{}
	c := NewCollector(r, st, config.IntelConfig{})
	c.now = func() int64 { return 7 }

	src := config.IntelSource{Key: "k", Project: "p", Instruction: "count", Agent: "general"}
	if err := c.collectOnce(context.Background(), src); err != nil {
		t.Fatalf("collectOnce should swallow agent error into a failure snapshot: %v", err)
	}
	if len(st.inserted) != 1 || st.inserted[0].OK {
		t.Fatalf("expected one ok=false snapshot, got %+v", st.inserted)
	}
	if st.inserted[0].Error == "" {
		t.Error("failure snapshot missing error text")
	}
}

func TestCollectOnceBadJSON(t *testing.T) {
	r := &fakeRunner{resp: "sorry, no data"}
	st := &fakeStore{}
	c := NewCollector(r, st, config.IntelConfig{})
	c.now = func() int64 { return 1 }

	src := config.IntelSource{Key: "k", Project: "p", Instruction: "count", Agent: "general"}
	_ = c.collectOnce(context.Background(), src)
	if len(st.inserted) != 1 || st.inserted[0].OK {
		t.Fatalf("expected one ok=false snapshot, got %+v", st.inserted)
	}
}
```

- [ ] **Step 2: Запустить — убедиться, что падает**
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/intel/ -run TestCollectOnce -v
```
Expected: FAIL — `NewCollector`/`collectOnce`/поле `now` не существуют.

- [ ] **Step 3: Реализовать** — создать `internal/intel/collector.go`:
```go
package intel

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/adhocore/gronx"
	"github.com/mtzanidakis/praktor/internal/config"
	"github.com/mtzanidakis/praktor/internal/store"
)

// Collector runs per-source scrape cycles on a cron schedule.
type Collector struct {
	runner AgentRunner
	store  SnapshotStore
	cfg    config.IntelConfig
	now    func() int64 // unix seconds; injectable for tests
}

// NewCollector builds a collector. Sources come from cfg.Sources.
func NewCollector(r AgentRunner, st SnapshotStore, cfg config.IntelConfig) *Collector {
	return &Collector{
		runner: r, store: st, cfg: cfg,
		now: func() int64 { return time.Now().Unix() },
	}
}

// Run starts one goroutine per source; each sleeps until its next cron tick,
// runs collectOnce, and repeats until ctx is cancelled.
func (c *Collector) Run(ctx context.Context) {
	for _, src := range c.cfg.Sources {
		go c.runSource(ctx, src)
	}
	<-ctx.Done()
}

func (c *Collector) runSource(ctx context.Context, src config.IntelSource) {
	for {
		next, err := gronx.NextTick(src.Cron, false)
		if err != nil {
			slog.Error("intel: bad cron, source disabled", "source", src.Key, "cron", src.Cron, "error", err)
			return
		}
		wait := time.Until(next)
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
			if err := c.collectOnce(ctx, src); err != nil {
				slog.Error("intel: collectOnce failed", "source", src.Key, "error", err)
			}
		}
	}
}

// collectOnce runs one scrape cycle: load previous snapshot, ask the agent,
// parse, and insert a snapshot row. Agent/parse failures are recorded as a
// failure snapshot (ok=false) rather than returned as errors, so history is
// never broken.
func (c *Collector) collectOnce(ctx context.Context, src config.IntelSource) error {
	prev, err := c.store.LatestSnapshot(src.Key)
	if err != nil {
		return err
	}
	prompt := buildPrompt(src.Instruction, prev)

	resp, runErr := c.runner.RunCapture(ctx, src.Agent, prompt)
	captured := c.now()
	if runErr != nil {
		return c.store.InsertIntelSnapshot(store.IntelSnapshot{
			SourceKey: src.Key, Project: src.Project, CapturedAt: captured,
			OK: false, Error: runErr.Error(),
		})
	}

	snap, perr := parseSnapshot(resp)
	if perr != nil {
		return c.store.InsertIntelSnapshot(store.IntelSnapshot{
			SourceKey: src.Key, Project: src.Project, CapturedAt: captured,
			OK: false, Error: perr.Error(),
		})
	}

	payload, _ := json.Marshal(map[string]any{
		"summary": snap.Summary, "metrics": snap.Metrics, "items": snap.Items,
	})
	return c.store.InsertIntelSnapshot(store.IntelSnapshot{
		SourceKey: src.Key, Project: src.Project, CapturedAt: captured,
		Payload: string(payload), ChangeNote: snap.ChangeNote, OK: true,
	})
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/intel/ -v
```
Expected: PASS (все тесты пакета intel).

- [ ] **Step 5: gofmt + commit**
```bash
git show :internal/intel/collector.go | docker run --rm -i golang:1.26rc1 gofmt -d
git add internal/intel/collector.go internal/intel/collector_test.go
git commit -m "feat(intel): Collector + collectOnce + per-source cron Run (S6)"
```

---

### Task 6: agent — `RunCapture` (синхронный захват, без TG-доставки)

**Files:**
- Modify: `internal/agent/orchestrator.go` (новое поле `pendingReplies`, инициализация, метод `RunCapture`, ранний `return` в `handleAgentOutput`)
- Test: `internal/agent/orchestrator_capture_test.go` (юнит на мету/ранний-return без NATS — см. ниже)

> **Контекст для исполнителя (прочитать перед правкой):** `executeMessage` (orchestrator.go:190) генерит `msgID` ВНУТРИ себя и кладёт `meta` в `o.pendingMeta[msgID]`. Когда агент завершает, `handleAgentOutput` (:358) на `type=="result"` достаёт `meta` через `popPendingMeta(output.MsgID)` и вызывает всех листенеров `o.listeners` (один из них — Telegram-доставка). Идея захвата: `RunCapture` кладёт в `meta` уникальный `intel_reply=<reqID>` и канал в `o.pendingReplies[reqID]`; в `handleAgentOutput`, ПОСЛЕ получения `meta`, если `meta["intel_reply"]` задан — отправляем контент в канал и **делаем `return` ДО** цикла листенеров (это и захват, и подавление TG за один приём). `chat_id` в meta не кладём.

- [ ] **Step 1: Написать падающий тест** — создать `internal/agent/orchestrator_capture_test.go`. Тест проверяет deliverCapture-механику без NATS/контейнеров:
```go
package agent

import "testing"

func TestDeliverCaptureRoutesAndReports(t *testing.T) {
	o := &Orchestrator{pendingReplies: map[string]chan captureResult{}}

	ch := make(chan captureResult, 1)
	o.mu.Lock()
	o.pendingReplies["req1"] = ch
	o.mu.Unlock()

	// matching reply id -> delivered, returns true (caller must skip listeners)
	if !o.deliverCapture(map[string]string{"intel_reply": "req1"}, "hello") {
		t.Fatal("deliverCapture should report handled=true for a known reply id")
	}
	select {
	case res := <-ch:
		if res.content != "hello" {
			t.Errorf("content = %q, want hello", res.content)
		}
	default:
		t.Fatal("expected content on channel")
	}

	// no reply id -> not handled (normal listener path proceeds)
	if o.deliverCapture(map[string]string{}, "x") {
		t.Error("deliverCapture should report handled=false when no intel_reply")
	}
	if o.deliverCapture(nil, "x") {
		t.Error("deliverCapture(nil) should report handled=false")
	}
}
```

> **Note:** этот тест требует, чтобы поля `Orchestrator.pendingReplies map[string]chan captureResult` и `Orchestrator.mu` были доступны в пакете (они уже в том же пакете `agent`). Если `mu` — это `sync.Mutex` уже используемый для `pendingMeta`, переиспользуй его.

- [ ] **Step 2: Запустить — убедиться, что падает**
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/agent/ -run TestDeliverCapture -v
```
Expected: FAIL — `pendingReplies`/`captureResult`/`deliverCapture` не существуют.

- [ ] **Step 3: Реализовать**

(a) В объявление структуры `Orchestrator` добавить поле (рядом с `pendingMeta`):
```go
	pendingReplies map[string]chan captureResult
```
и тип:
```go
type captureResult struct {
	content string
}
```

(b) В конструкторе оркестратора (там, где инициализируются `pendingMeta`/`pendingMsgID` — найди `pendingMeta: map[string]...`) добавить:
```go
		pendingReplies: map[string]chan captureResult{},
```

(c) Добавить хелпер `deliverCapture` и метод `RunCapture`:
```go
// deliverCapture routes an agent result to a waiting RunCapture call when meta
// carries an intel_reply id. Returns true when handled — the caller must then
// skip the normal (e.g. Telegram) listeners. This is how S6 intel scrapes get
// their response back WITHOUT delivering it to a chat.
func (o *Orchestrator) deliverCapture(meta map[string]string, content string) bool {
	if meta == nil {
		return false
	}
	reqID := meta["intel_reply"]
	if reqID == "" {
		return false
	}
	o.mu.Lock()
	ch, ok := o.pendingReplies[reqID]
	if ok {
		delete(o.pendingReplies, reqID)
	}
	o.mu.Unlock()
	if ok {
		ch <- captureResult{content: content}
	}
	return true // intel-marked: suppress listeners regardless of whether a waiter remained
}

// RunCapture dispatches a prompt to an agent and returns its text response
// synchronously, without delivering it to Telegram. Used by the S6 intel collector.
func (o *Orchestrator) RunCapture(ctx context.Context, agentID, prompt string) (string, error) {
	reqID := uuid.New().String()
	ch := make(chan captureResult, 1)
	o.mu.Lock()
	o.pendingReplies[reqID] = ch
	o.mu.Unlock()

	meta := map[string]string{"intel_reply": reqID, "sender": "intel"}
	if err := o.HandleMessage(ctx, agentID, prompt, meta); err != nil {
		o.mu.Lock()
		delete(o.pendingReplies, reqID)
		o.mu.Unlock()
		return "", err
	}

	select {
	case <-ctx.Done():
		o.mu.Lock()
		delete(o.pendingReplies, reqID)
		o.mu.Unlock()
		return "", ctx.Err()
	case <-time.After(5 * time.Minute):
		o.mu.Lock()
		delete(o.pendingReplies, reqID)
		o.mu.Unlock()
		return "", fmt.Errorf("intel capture timed out for agent %s", agentID)
	case res := <-ch:
		return res.content, nil
	}
}
```

(d) В `handleAgentOutput`, в блоке `if output.Type == "result"`, СРАЗУ ПОСЛЕ строки, где получена `meta` (после `meta := o.popPendingMeta(...)` / fallback `getLastMeta`, ~строка 408) и ПЕРЕД формированием `listenerContent`, вставить:
```go
		// S6 intel: capture the response and suppress chat delivery.
		if o.deliverCapture(meta, content) {
			return
		}
```

> **Важно:** `return` здесь корректен — сообщение агента уже сохранено в БД выше (строки ~391-402); мы лишь пропускаем доставку листенерам.

- [ ] **Step 4: Запустить — убедиться, что проходит (+ сборка пакета)**
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 sh -c "go build ./internal/agent/ && go test ./internal/agent/ -run TestDeliverCapture -v"
```
Expected: PASS.

- [ ] **Step 5: gofmt + commit**
```bash
git show :internal/agent/orchestrator.go | docker run --rm -i golang:1.26rc1 gofmt -d
git add internal/agent/orchestrator.go internal/agent/orchestrator_capture_test.go
git commit -m "feat(agent): Orchestrator.RunCapture — sync agent reply, no TG delivery (S6)"
```

---

### Task 7: web — `GET /api/intel` (группировка project→source + история)

**Files:**
- Create: `internal/web/intel.go`
- Modify: `internal/web/api.go` (регистрация маршрута)
- Test: `internal/web/intel_test.go`

- [ ] **Step 1: Написать падающий тест** — создать `internal/web/intel_test.go`:
```go
package web

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mtzanidakis/praktor/internal/store"
)

func TestHandleIntelGrouping(t *testing.T) {
	st := newTestStoreForWeb(t) // existing web test helper (capabilities_handler_test.go)
	_ = st.InsertIntelSnapshot(store.IntelSnapshot{SourceKey: "a", Project: "mentis", CapturedAt: 10, Payload: `{"summary":"v1"}`, ChangeNote: "first snapshot", OK: true})
	_ = st.InsertIntelSnapshot(store.IntelSnapshot{SourceKey: "a", Project: "mentis", CapturedAt: 20, Payload: `{"summary":"v2"}`, ChangeNote: "+2", OK: true})
	_ = st.InsertIntelSnapshot(store.IntelSnapshot{SourceKey: "b", Project: "dimed", CapturedAt: 15, OK: false, Error: "unreachable"})

	srv := &Server{store: st}

	req := httptest.NewRequest(http.MethodGet, "/api/intel", nil)
	rec := httptest.NewRecorder()
	srv.handleIntel(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var resp intelResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Sources) != 2 {
		t.Fatalf("sources = %d, want 2", len(resp.Sources))
	}
	// find source "a": latest must be v2 (newest), history length 2
	var a *intelSource
	for i := range resp.Sources {
		if resp.Sources[i].Key == "a" {
			a = &resp.Sources[i]
		}
	}
	if a == nil {
		t.Fatal("source a missing")
	}
	if a.Latest == nil || a.Latest.ChangeNote != "+2" {
		t.Errorf("latest = %+v, want change_note=+2", a.Latest)
	}
	if len(a.History) != 2 {
		t.Errorf("history = %d, want 2", len(a.History))
	}
}
```

> **Note:** проверь, как другие тесты в `internal/web` конструируют `*Server` и стор (`newTestStore`/`&Server{store, registry}` — см. radar_test.go). Подгони под существующий хелпер.

- [ ] **Step 2: Запустить — убедиться, что падает**
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/web/ -run TestHandleIntel -v
```
Expected: FAIL — `handleIntel`/`intelResponse`/`intelSource` не существуют.

- [ ] **Step 3: Реализовать** — создать `internal/web/intel.go`:
```go
package web

import (
	"net/http"

	"github.com/mtzanidakis/praktor/internal/store"
)

type intelSnapshot struct {
	CapturedAt int64  `json:"captured_at"`
	Payload    string `json:"payload,omitempty"`
	ChangeNote string `json:"change_note,omitempty"`
	OK         bool   `json:"ok"`
	Error      string `json:"error,omitempty"`
}

type intelSource struct {
	Key     string          `json:"key"`
	Project string          `json:"project"`
	Latest  *intelSnapshot  `json:"latest"`
	History []intelSnapshot `json:"history"`
}

type intelResponse struct {
	Sources []intelSource `json:"sources"`
}

// handleIntel is GET /api/intel — read-only per-source intel feed. Snapshots are
// grouped by source_key; within each source they are newest-first, so the first
// is the latest.
func (s *Server) handleIntel(w http.ResponseWriter, r *http.Request) {
	rows, err := s.store.ListIntelSnapshots() // newest-first overall
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	order := []string{}                       // preserve first-seen (newest) order of keys
	byKey := map[string]*intelSource{}
	for _, row := range rows {
		src, ok := byKey[row.SourceKey]
		if !ok {
			src = &intelSource{Key: row.SourceKey, Project: row.Project}
			byKey[row.SourceKey] = src
			order = append(order, row.SourceKey)
		}
		src.History = append(src.History, toIntelSnapshot(row))
	}
	resp := intelResponse{Sources: make([]intelSource, 0, len(order))}
	for _, k := range order {
		src := byKey[k]
		if len(src.History) > 0 {
			latest := src.History[0]
			src.Latest = &latest
		}
		resp.Sources = append(resp.Sources, *src)
	}
	jsonResponse(w, resp)
}

func toIntelSnapshot(row store.IntelSnapshot) intelSnapshot {
	return intelSnapshot{
		CapturedAt: row.CapturedAt, Payload: row.Payload, ChangeNote: row.ChangeNote,
		OK: row.OK, Error: row.Error,
	}
}
```

- [ ] **Step 4: Зарегистрировать маршрут** — в `internal/web/api.go`, рядом со строкой `mux.HandleFunc("GET /api/radar", s.handleRadar)` (строка ~82), добавить:
```go
	mux.HandleFunc("GET /api/intel", s.handleIntel)
```

- [ ] **Step 5: Запустить — убедиться, что проходит**
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/web/ -run TestHandleIntel -v
```
Expected: PASS.

- [ ] **Step 6: gofmt + commit**
```bash
git show :internal/web/intel.go | docker run --rm -i golang:1.26rc1 gofmt -d
git add internal/web/intel.go internal/web/intel_test.go internal/web/api.go
git commit -m "feat(web): GET /api/intel read-only per-source feed + history (S6)"
```

---

### Task 8: main.go — старт горутины коллектора (gated)

**Files:**
- Modify: `cmd/praktor/main.go` (блок после старта radar, ~строка 150)

- [ ] **Step 1: Реализовать** — в `cmd/praktor/main.go`, сразу ПОСЛЕ блока `if cfg.Radar.Enabled { ... }` (заканчивается `slog.Info("radar started", ...)`), добавить:
```go
	// Per-project periodic intel (S6) — start-time gate, no hot reload.
	if cfg.Intel.Enabled && len(cfg.Intel.Sources) > 0 {
		intelCollector := intel.NewCollector(orch, db, cfg.Intel)
		go intelCollector.Run(ctx)
		slog.Info("intel started", "sources", len(cfg.Intel.Sources))
	}
```

- [ ] **Step 2: Добавить импорт** — в блок импортов `cmd/praktor/main.go` добавить (рядом с `.../internal/radar`):
```go
	"github.com/mtzanidakis/praktor/internal/intel"
```

> **Контракт:** `orch` (`*agent.Orchestrator`) удовлетворяет `intel.AgentRunner` (метод `RunCapture` из Task 6); `db` (`*store.Store`) удовлетворяет `intel.SnapshotStore` (методы из Task 1). Проверка интерфейсов — на этапе сборки.

- [ ] **Step 3: Сборка всего бинаря**
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 go build ./...
```
Expected: успешная сборка. Если падает на несоответствии интерфейсов — сверь сигнатуры `RunCapture`/`InsertIntelSnapshot`/`LatestSnapshot` с Task 1/6.

- [ ] **Step 4: Полный прогон тестов + vet**
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 sh -c "go vet ./... && go test ./internal/intel/ ./internal/store/ ./internal/config/ ./internal/web/ ./internal/agent/"
```
Expected: PASS (natsbus load-флак игнорировать, S6 его не трогает).

- [ ] **Step 5: commit**
```bash
git add cmd/praktor/main.go
git commit -m "feat: start intel collector goroutine, gated on intel.enabled (S6)"
```

---

### Task 9: UI — страница Intel + nav

**Files:**
- Create: `ui/src/pages/Intel.tsx`
- Create: `ui/src/pages/intelStatus.ts`
- Create: `ui/src/pages/__tests__/intelStatus.test.ts`
- Modify: `ui/src/App.tsx` (route + nav, по образцу Radar)

- [ ] **Step 1: Написать падающий тест** — создать `ui/src/pages/__tests__/intelStatus.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { snapshotStatus, type IntelSnapshot } from "../intelStatus";

describe("snapshotStatus", () => {
  it("maps ok snapshot to ok", () => {
    const snap: IntelSnapshot = { captured_at: 1, ok: true, change_note: "+2" };
    expect(snapshotStatus(snap)).toBe("ok");
  });
  it("maps failed snapshot to error", () => {
    const snap: IntelSnapshot = { captured_at: 1, ok: false, error: "down" };
    expect(snapshotStatus(snap)).toBe("error");
  });
  it("maps null/absent to empty", () => {
    expect(snapshotStatus(null)).toBe("empty");
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**
```bash
cd ui && npx vitest run src/pages/__tests__/intelStatus.test.ts
```
Expected: FAIL — модуль `../intelStatus` не существует.

- [ ] **Step 3: Реализовать статус-маппинг** — создать `ui/src/pages/intelStatus.ts`:
```ts
export interface IntelSnapshot {
  captured_at: number;
  payload?: string;
  change_note?: string;
  ok: boolean;
  error?: string;
}

export interface IntelSource {
  key: string;
  project: string;
  latest: IntelSnapshot | null;
  history: IntelSnapshot[];
}

export type SnapshotStatus = "ok" | "error" | "empty";

export function snapshotStatus(snap: IntelSnapshot | null | undefined): SnapshotStatus {
  if (!snap) return "empty";
  return snap.ok ? "ok" : "error";
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**
```bash
cd ui && npx vitest run src/pages/__tests__/intelStatus.test.ts
```
Expected: PASS.

- [ ] **Step 5: Реализовать страницу** — создать `ui/src/pages/Intel.tsx` (по образцу `Radar.tsx`):
```tsx
import { useEffect, useState } from "react";
import { type IntelSource, snapshotStatus } from "./intelStatus";

export default function Intel() {
  const [sources, setSources] = useState<IntelSource[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/intel")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setSources(d.sources ?? []))
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <div className="page"><h1>Intel</h1><p className="error">{error}</p></div>;

  return (
    <div className="page">
      <h1>Intel</h1>
      {sources.length === 0 && <p>Нет источников или снимков.</p>}
      {sources.map((s) => {
        const st = snapshotStatus(s.latest);
        return (
          <div key={s.key} className="card">
            <div className="card-head">
              <strong>{s.key}</strong> <span className="muted">{s.project}</span>
              <span className={`badge badge-${st}`}>{st}</span>
            </div>
            {s.latest?.ok && (
              <>
                <p className="change-note">{s.latest.change_note}</p>
                <pre className="payload">{s.latest.payload}</pre>
              </>
            )}
            {s.latest && !s.latest.ok && <p className="error">Сбой сбора: {s.latest.error}</p>}
            <details>
              <summary>История ({s.history.length})</summary>
              <ul>
                {s.history.map((h, i) => (
                  <li key={i}>
                    {new Date(h.captured_at * 1000).toISOString().slice(0, 16).replace("T", " ")} —{" "}
                    {h.ok ? h.change_note : `сбой: ${h.error}`}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        );
      })}
    </div>
  );
}
```

> **Note:** классы (`page`/`card`/`badge`/`muted`/`error`) — переиспользуй из существующих страниц (`Radar.tsx`/`Catalog.tsx`). Если каких-то нет, скопируй ближайший стиль. Не вводи новый CSS-фреймворк.

- [ ] **Step 6: Добавить route + nav** — в `ui/src/App.tsx`, по образцу записи `Radar` (lazy import + `<Route>` + пункт навигации), добавить аналогичные строки для `Intel` (path `/intel`, label «Intel»). Найди три места: `const Radar = lazy(...)`, `<Route path="/radar" ...>`, и пункт меню — продублируй для Intel.

```tsx
// рядом с импортами страниц:
const Intel = lazy(() => import("./pages/Intel"));
// в списке Route:
<Route path="/intel" element={<Intel />} />
// в навигации (рядом с пунктом Radar):
<NavLink to="/intel">Intel</NavLink>
```

- [ ] **Step 7: Сборка UI + полный прогон vitest**
```bash
cd ui && npm run build && npx vitest run
```
Expected: tsc + vite build без ошибок (чанк `Intel-*.js`); все vitest зелёные.

- [ ] **Step 8: commit**
```bash
git add ui/src/pages/Intel.tsx ui/src/pages/intelStatus.ts ui/src/pages/__tests__/intelStatus.test.ts ui/src/App.tsx
git commit -m "feat(ui): Intel page — read-only per-source intel feed + history (S6)"
```

---

## Финальная верификация (перед PR)

- [ ] **Полный набор Go** (без `| tail` — pipe маскирует FAIL):
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 sh -c "go build ./... && go vet ./... && go test ./..."
```
Expected: build/vet чисто; тесты PASS (`internal/natsbus` под нагрузкой может флакнуть «nats server not ready» — изолированно зелёный, S6 не трогал).

- [ ] **gofmt по всем новым файлам** (по git-блобам, пусто = ок).
- [ ] **UI**: `cd ui && npm run build && npx vitest run` — зелено, чанк `Intel-*.js`.
- [ ] **Импорт-граф без циклов**: `store ← intel ← web ← main`; `agent` экспортирует `RunCapture`. `intel` импортирует только `store`, `config`, `gronx` (НЕ `agent`, НЕ `web`).
- [ ] **agent-runner не тронут**: `git diff --stat origin/main -- agent-runner/` пусто → деплой = `redeploy.sh` (gateway-only).

## Деплой (после merge PR, с явного согласия Alex на прод)

1. Добавить `intel:`-блок с источниками в серверный `~/praktor/config/praktor.yaml` (с бэкапом). Минимум для проверки:
```yaml
intel:
  enabled: true
  sources:
    - key: smoke
      project: praktor
      name: "Smoke source"
      instruction: "Верни JSON {\"summary\":\"ok\",\"metrics\":{},\"items\":[],\"change_note\":\"first snapshot\"} без обращений к сети."
      cron: "*/5 * * * *"        # каждые 5 мин — только для smoke; убрать после проверки
      agent: general
```
2. `redeploy.sh` (gateway-only). Verify: `curl /api/intel`=401 (жив за auth) + asset `Intel-*.js`=200.
3. После первого тика (≤5 мин) — `curl -u admin:$PW /api/intel` отдаёт источник `smoke` с `ok:true` снимком.
4. Заменить smoke на реальные источники (cron weekly). Phone-verify: страница Intel рендерит источники + историю.
5. После зелёного → **S6 ЗАКРЫТ** → North-star (S1–S6) завершён целиком.

## Out of scope (YAGNI — не делать)
TG-дайджест, пороговые алерты, UI-CRUD источников, механические адаптеры, графики трендов, hot-reload источников.
