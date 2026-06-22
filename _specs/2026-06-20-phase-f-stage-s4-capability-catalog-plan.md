# S4 — каталог возможностей Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read-only страница Catalog в Mission Control: что умеет каждый агент (встроенные возможности + расширения + `allowed_tools`) + сводка его памяти + глобальный факт наличия профиля.

**Architecture:** Каталог собирается целиком в шлюзе из конфига (`registry`) + БД расширений + новой таблицы `agent_memory_stats`. Снимок памяти агент шлёт по NATS IPC (`memory_summary`); хост персистит. Внешнего репо/секретов нет.

**Tech Stack:** Go 1.26 (stdlib `net/http`, `modernc.org/sqlite`), TypeScript (agent-runner, `node:sqlite`, vitest), React 19 + Vite + vitest.

**Spec:** `_specs/2026-06-20-phase-f-stage-s4-capability-catalog-design.md`

**Ветка:** `feature/s4-capability-catalog` (форк `Meta-Psy/praktor`, от `origin/main` = `5377352`).

**Verification env (Go):** Go нативно нет — все Go-проверки в Docker. `MSYS_NO_PATHCONV=1` — ВНЕШНИЙ префикс шелла (durable-урок: иначе git-bash манглит `-w /src`):
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src \
  -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build \
  -e GOTOOLCHAIN=auto golang:1.26rc1 <cmd>
```
gofmt на Windows-чекауте врёт из-за CRLF — проверять по git-блобам: `git show :path/file.go | docker run --rm -i golang:1.26rc1 gofmt -d` (пусто = ок).

UI/agent-runner: `npm` на хосте (mise node).

---

### Task 1: Реестр встроенных возможностей

**Files:**
- Create: `internal/capabilities/registry.go`
- Test: `internal/capabilities/registry_test.go`

- [ ] **Step 1: Написать падающий тест**

Создать `internal/capabilities/registry_test.go`:
```go
package capabilities

import (
	"testing"

	"github.com/mtzanidakis/praktor/internal/config"
)

func keys(caps []Capability) map[string]bool {
	m := make(map[string]bool, len(caps))
	for _, c := range caps {
		m[c.Key] = true
	}
	return m
}

func TestForAgentFiltersConditional(t *testing.T) {
	// Plain agent: no nix, no email.
	plain := ForAgent(config.AgentDefinition{})
	k := keys(plain)
	if !k["memory"] || !k["tasks"] || !k["web"] || !k["browser"] {
		t.Fatalf("plain agent missing always-on caps: %v", k)
	}
	if k["nix"] {
		t.Errorf("nix present without nix_enabled")
	}
	if k["email"] {
		t.Errorf("email present without agentmail_inbox_id")
	}

	// Nix + email enabled.
	full := ForAgent(config.AgentDefinition{NixEnabled: true, AgentMailInboxID: "inbox_123"})
	kf := keys(full)
	if !kf["nix"] {
		t.Errorf("nix missing with nix_enabled=true")
	}
	if !kf["email"] {
		t.Errorf("email missing with agentmail_inbox_id set")
	}
}

func TestMemoryCapabilityHasTools(t *testing.T) {
	for _, c := range ForAgent(config.AgentDefinition{}) {
		if c.Key == "memory" {
			if len(c.Tools) == 0 {
				t.Fatal("memory capability has no tools listed")
			}
			return
		}
	}
	t.Fatal("memory capability not found")
}
```

- [ ] **Step 2: Запустить — убедиться, что падает**

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/capabilities/ -v
```
Expected: FAIL — пакет/`ForAgent` не существует.

- [ ] **Step 3: Реализовать**

Создать `internal/capabilities/registry.go`:
```go
// Package capabilities holds the static registry of built-in agent
// capabilities surfaced read-only in the Mission Control catalog (S4).
package capabilities

import "github.com/mtzanidakis/praktor/internal/config"

// Capability is one built-in capability available to an agent.
type Capability struct {
	Key         string   `json:"key"`
	Label       string   `json:"label"`
	Group       string   `json:"group"`
	Tools       []string `json:"tools,omitempty"`
	Conditional string   `json:"-"` // "" | "nix_enabled" | "agentmail_inbox_id"
}

// Builtins is the static set every agent gets; some are gated per-agent via
// Conditional. Mirrors the MCP servers registered in agent-runner/src/index.ts
// plus always-on web/browser tools.
var Builtins = []Capability{
	{Key: "tasks", Label: "Scheduled Tasks", Group: "tasks", Tools: []string{"scheduled_task_create", "scheduled_task_list", "scheduled_task_delete"}},
	{Key: "profile", Label: "User Profile", Group: "profile", Tools: []string{"user_profile_read", "user_profile_update"}},
	{Key: "memory", Label: "Memory", Group: "memory", Tools: []string{"memory_store", "memory_recall", "memory_list", "memory_delete", "memory_forget"}},
	{Key: "file", Label: "File Send", Group: "files", Tools: []string{"file_send"}},
	{Key: "history", Label: "History Search", Group: "history", Tools: []string{"search_history"}},
	{Key: "web", Label: "Web Access", Group: "web", Tools: []string{"WebSearch", "WebFetch"}},
	{Key: "browser", Label: "Browser Automation", Group: "browser", Tools: []string{"agent-browser"}},
	{Key: "nix", Label: "Nix Packages", Group: "nix", Tools: []string{"nix_search", "nix_add", "nix_list_installed", "nix_remove", "nix_upgrade"}, Conditional: "nix_enabled"},
	{Key: "email", Label: "Email (AgentMail)", Group: "email", Conditional: "agentmail_inbox_id"},
}

// ForAgent returns the built-in capabilities for an agent, dropping conditional
// ones whose enabling flag is unset.
func ForAgent(def config.AgentDefinition) []Capability {
	out := make([]Capability, 0, len(Builtins))
	for _, c := range Builtins {
		switch c.Conditional {
		case "nix_enabled":
			if !def.NixEnabled {
				continue
			}
		case "agentmail_inbox_id":
			if def.AgentMailInboxID == "" {
				continue
			}
		}
		out = append(out, c)
	}
	return out
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/capabilities/ -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/capabilities/registry.go internal/capabilities/registry_test.go
git commit -m "feat(capabilities): static built-in capability registry + ForAgent filter (S4)"
```

---

### Task 2: Таблица `agent_memory_stats` + CRUD снимка

**Files:**
- Modify: `internal/store/store.go` (добавить таблицу в slice `migrations`)
- Create: `internal/store/memory_stats.go`
- Test: `internal/store/memory_stats_test.go`

- [ ] **Step 1: Написать падающий тест**

Создать `internal/store/memory_stats_test.go`:
```go
package store

import "testing"

func TestUpsertAndGetMemoryStats(t *testing.T) {
	s := newTestStore(t)

	if err := s.UpsertMemoryStats("agent-a", 12, "2026-06-20T08:00:00Z", "2026-06-20T09:00:00Z"); err != nil {
		t.Fatal(err)
	}
	stats, err := s.GetMemoryStats()
	if err != nil {
		t.Fatal(err)
	}
	got, ok := stats["agent-a"]
	if !ok {
		t.Fatal("agent-a missing")
	}
	if got.Count != 12 || got.LastUpdated != "2026-06-20T08:00:00Z" || got.ReportedAt != "2026-06-20T09:00:00Z" {
		t.Fatalf("stat = %+v", got)
	}

	// Upsert overwrites the same agent_id.
	if err := s.UpsertMemoryStats("agent-a", 15, "2026-06-20T10:00:00Z", "2026-06-20T10:01:00Z"); err != nil {
		t.Fatal(err)
	}
	stats, _ = s.GetMemoryStats()
	if stats["agent-a"].Count != 15 {
		t.Fatalf("count after upsert = %d, want 15", stats["agent-a"].Count)
	}
}
```

- [ ] **Step 2: Запустить — убедиться, что падает**

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/store/ -run TestUpsertAndGetMemoryStats -v
```
Expected: FAIL — `UpsertMemoryStats`/`GetMemoryStats` не определены.

- [ ] **Step 3: Реализовать таблицу**

В `internal/store/store.go` в slice `migrations := []string{` (после блока `CREATE TABLE IF NOT EXISTS agents (...)`) добавить запись:
```go
		`CREATE TABLE IF NOT EXISTS agent_memory_stats (
			agent_id     TEXT PRIMARY KEY,
			mem_count    INTEGER NOT NULL DEFAULT 0,
			last_updated TEXT,
			reported_at  TEXT NOT NULL
		)`,
```

- [ ] **Step 4: Реализовать CRUD**

Создать `internal/store/memory_stats.go`:
```go
package store

import "fmt"

// MemoryStat is a per-agent memory summary reported by the agent runtime (S4).
type MemoryStat struct {
	AgentID     string
	Count       int
	LastUpdated string // RFC3339, "" if no memories yet
	ReportedAt  string // RFC3339, stamped host-side when the snapshot arrived
}

// UpsertMemoryStats writes or overwrites an agent's memory summary.
func (s *Store) UpsertMemoryStats(agentID string, count int, lastUpdated, reportedAt string) error {
	_, err := s.db.Exec(`
		INSERT INTO agent_memory_stats (agent_id, mem_count, last_updated, reported_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(agent_id) DO UPDATE SET
			mem_count = excluded.mem_count,
			last_updated = excluded.last_updated,
			reported_at = excluded.reported_at`,
		agentID, count, lastUpdated, reportedAt)
	if err != nil {
		return fmt.Errorf("upsert memory stats: %w", err)
	}
	return nil
}

// GetMemoryStats returns every agent's memory summary keyed by agent_id.
func (s *Store) GetMemoryStats() (map[string]MemoryStat, error) {
	rows, err := s.db.Query(`SELECT agent_id, mem_count, COALESCE(last_updated, ''), reported_at FROM agent_memory_stats`)
	if err != nil {
		return nil, fmt.Errorf("get memory stats: %w", err)
	}
	defer func() { _ = rows.Close() }()

	out := make(map[string]MemoryStat)
	for rows.Next() {
		var m MemoryStat
		if err := rows.Scan(&m.AgentID, &m.Count, &m.LastUpdated, &m.ReportedAt); err != nil {
			return nil, fmt.Errorf("scan memory stat: %w", err)
		}
		out[m.AgentID] = m
	}
	return out, rows.Err()
}
```

- [ ] **Step 5: Запустить — убедиться, что проходит**

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/store/ -v
```
Expected: PASS (новый тест + существующие store-тесты).

- [ ] **Step 6: Commit**

```bash
git add internal/store/store.go internal/store/memory_stats.go internal/store/memory_stats_test.go
git commit -m "feat(store): agent_memory_stats table + Upsert/GetMemoryStats (S4)"
```

---

### Task 3: Сборщик `AgentCapabilities` (чистая функция)

**Files:**
- Create: `internal/web/capabilities.go`
- Test: `internal/web/capabilities_test.go`

- [ ] **Step 1: Написать падающий тест**

Создать `internal/web/capabilities_test.go`:
```go
package web

import (
	"testing"

	"github.com/mtzanidakis/praktor/internal/config"
	"github.com/mtzanidakis/praktor/internal/extensions"
	"github.com/mtzanidakis/praktor/internal/store"
)

func TestAssembleCapabilitiesRestrictedAndMemory(t *testing.T) {
	a := store.Agent{ID: "coder", Description: "Software engineer"}
	def := config.AgentDefinition{AllowedTools: []string{"Bash", "Read"}, NixEnabled: true}
	mem := &MemoryStats{Count: 7, LastUpdated: "2026-06-20T08:00:00Z", ReportedAt: "2026-06-20T09:00:00Z"}

	got := assembleCapabilities(a, def, "claude-sonnet-4-6", nil, mem)

	if !got.Restricted {
		t.Error("expected Restricted=true when AllowedTools set")
	}
	if got.Memory == nil || got.Memory.Count != 7 {
		t.Errorf("memory = %+v", got.Memory)
	}
	if got.Model != "claude-sonnet-4-6" {
		t.Errorf("model = %q", got.Model)
	}
	// nix_enabled → nix builtin present.
	found := false
	for _, c := range got.Builtin {
		if c.Key == "nix" {
			found = true
		}
	}
	if !found {
		t.Error("nix builtin missing with nix_enabled")
	}
}

func TestAssembleCapabilitiesDefaults(t *testing.T) {
	got := assembleCapabilities(store.Agent{ID: "general"}, config.AgentDefinition{}, "m", nil, nil)

	if got.Restricted {
		t.Error("Restricted should be false with empty AllowedTools")
	}
	if got.Memory != nil {
		t.Error("Memory should be nil when no snapshot")
	}
	// Non-nil empty slices for stable JSON.
	if got.AllowedTools == nil || got.Extensions.MCPServers == nil {
		t.Error("expected non-nil empty slices")
	}
}

func TestAssembleCapabilitiesExtensions(t *testing.T) {
	ext := &extensions.AgentExtensions{
		MCPServers: map[string]extensions.MCPServerConfig{"weather": {Type: "stdio", Command: "x"}},
		Skills:     map[string]extensions.SkillConfig{"writing": {Description: "d", Content: "c"}},
		Plugins:    []extensions.PluginConfig{{Name: "fmt@official"}},
	}
	got := assembleCapabilities(store.Agent{ID: "g"}, config.AgentDefinition{}, "m", ext, nil)

	if len(got.Extensions.MCPServers) != 1 || got.Extensions.MCPServers[0] != "weather" {
		t.Errorf("mcp = %v", got.Extensions.MCPServers)
	}
	if len(got.Extensions.Skills) != 1 || got.Extensions.Plugins[0] != "fmt@official" {
		t.Errorf("ext = %+v", got.Extensions)
	}
}
```

- [ ] **Step 2: Запустить — убедиться, что падает**

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/web/ -run TestAssembleCapabilities -v
```
Expected: FAIL — `assembleCapabilities`/типы не определены.

- [ ] **Step 3: Реализовать**

Создать `internal/web/capabilities.go`:
```go
package web

import (
	"sort"

	"github.com/mtzanidakis/praktor/internal/capabilities"
	"github.com/mtzanidakis/praktor/internal/config"
	"github.com/mtzanidakis/praktor/internal/extensions"
	"github.com/mtzanidakis/praktor/internal/store"
)

// MemoryStats is the per-agent memory summary surfaced in the catalog.
type MemoryStats struct {
	Count       int    `json:"count"`
	LastUpdated string `json:"last_updated,omitempty"`
	ReportedAt  string `json:"reported_at"`
}

// ExtensionsSummary lists the names of user-added extensions for an agent.
type ExtensionsSummary struct {
	MCPServers []string `json:"mcp_servers"`
	Skills     []string `json:"skills"`
	Plugins    []string `json:"plugins"`
}

// AgentCapabilities is one agent's read-only catalog entry.
type AgentCapabilities struct {
	AgentID      string                    `json:"agent_id"`
	Description  string                    `json:"description"`
	Model        string                    `json:"model"`
	Builtin      []capabilities.Capability `json:"builtin"`
	Extensions   ExtensionsSummary         `json:"extensions"`
	AllowedTools []string                  `json:"allowed_tools"`
	Restricted   bool                      `json:"restricted"`
	Memory       *MemoryStats              `json:"memory"`
}

// CatalogResponse is the GET /api/agents/capabilities body.
type CatalogResponse struct {
	UserProfilePresent bool                `json:"user_profile_present"`
	Agents             []AgentCapabilities `json:"agents"`
}

// assembleCapabilities builds one agent's entry from its definition, extensions,
// and optional memory snapshot. Pure — no I/O — so it is unit-testable.
func assembleCapabilities(a store.Agent, def config.AgentDefinition, model string, ext *extensions.AgentExtensions, mem *MemoryStats) AgentCapabilities {
	exts := ExtensionsSummary{MCPServers: []string{}, Skills: []string{}, Plugins: []string{}}
	if ext != nil {
		for name := range ext.MCPServers {
			exts.MCPServers = append(exts.MCPServers, name)
		}
		for name := range ext.Skills {
			exts.Skills = append(exts.Skills, name)
		}
		for _, p := range ext.Plugins {
			exts.Plugins = append(exts.Plugins, p.Name)
		}
	}
	sort.Strings(exts.MCPServers)
	sort.Strings(exts.Skills)
	sort.Strings(exts.Plugins)

	allowed := def.AllowedTools
	if allowed == nil {
		allowed = []string{}
	}

	return AgentCapabilities{
		AgentID:      a.ID,
		Description:  a.Description,
		Model:        model,
		Builtin:      capabilities.ForAgent(def),
		Extensions:   exts,
		AllowedTools: allowed,
		Restricted:   len(def.AllowedTools) > 0,
		Memory:       mem,
	}
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/web/ -run TestAssembleCapabilities -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/web/capabilities.go internal/web/capabilities_test.go
git commit -m "feat(web): assembleCapabilities + catalog types (S4)"
```

---

### Task 4: `GET /api/agents/capabilities` — сборка каталога + хендлер

**Files:**
- Modify: `internal/web/capabilities.go` (добавить `buildCatalog` + `handleCapabilities`)
- Modify: `internal/web/api.go` (маршрут)
- Test: `internal/web/capabilities_handler_test.go`

- [ ] **Step 1: Написать падающий тест**

Создать `internal/web/capabilities_handler_test.go`:
```go
package web

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mtzanidakis/praktor/internal/config"
	"github.com/mtzanidakis/praktor/internal/registry"
	"github.com/mtzanidakis/praktor/internal/store"
)

func TestHandleCapabilities(t *testing.T) {
	st := newTestStoreForWeb(t)
	defs := map[string]config.AgentDefinition{
		"coder": {Description: "Engineer", AllowedTools: []string{"Bash"}},
	}
	reg := registry.New(st, defs, config.DefaultsConfig{Model: "claude-sonnet-4-6"}, t.TempDir())
	if err := reg.Sync(); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertMemoryStats("coder", 5, "2026-06-20T08:00:00Z", "2026-06-20T09:00:00Z"); err != nil {
		t.Fatal(err)
	}

	s := &Server{store: st, registry: reg}
	req := httptest.NewRequest(http.MethodGet, "/api/agents/capabilities", nil)
	rec := httptest.NewRecorder()
	s.handleCapabilities(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d (%s)", rec.Code, rec.Body)
	}
	var got CatalogResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.UserProfilePresent {
		t.Error("expected user_profile_present=false (no USER.md)")
	}
	if len(got.Agents) != 1 || got.Agents[0].AgentID != "coder" {
		t.Fatalf("agents = %+v", got.Agents)
	}
	if !got.Agents[0].Restricted {
		t.Error("coder should be restricted")
	}
	if got.Agents[0].Memory == nil || got.Agents[0].Memory.Count != 5 {
		t.Errorf("memory = %+v", got.Agents[0].Memory)
	}
}
```

Note: тест использует хелпер `newTestStoreForWeb`. Если в пакете `web` ещё нет хелпера, создающего реальный `*store.Store`, добавить его в этот же файл:
```go
func newTestStoreForWeb(t *testing.T) *store.Store {
	t.Helper()
	st, err := store.New(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return st
}
```

- [ ] **Step 2: Запустить — убедиться, что падает**

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/web/ -run TestHandleCapabilities -v
```
Expected: FAIL — `handleCapabilities`/`buildCatalog` не определены.

- [ ] **Step 3: Реализовать**

В `internal/web/capabilities.go` добавить импорты `"net/http"`, `"strings"` и функции:
```go
// buildCatalog assembles the capability catalog across all configured agents.
func (s *Server) buildCatalog() (CatalogResponse, error) {
	agents, err := s.registry.List()
	if err != nil {
		return CatalogResponse{}, err
	}
	memStats, _ := s.store.GetMemoryStats()

	out := make([]AgentCapabilities, 0, len(agents))
	for _, a := range agents {
		def, _ := s.registry.GetDefinition(a.ID)

		var ext *extensions.AgentExtensions
		if blob, err := s.store.GetAgentExtensions(a.ID); err == nil {
			ext, _ = extensions.Parse(blob)
		}

		var mem *MemoryStats
		if ms, ok := memStats[a.ID]; ok {
			mem = &MemoryStats{Count: ms.Count, LastUpdated: ms.LastUpdated, ReportedAt: ms.ReportedAt}
		}

		out = append(out, assembleCapabilities(a, def, s.registry.ResolveModel(a.ID), ext, mem))
	}

	profile, _ := s.registry.GetUserMD()
	return CatalogResponse{UserProfilePresent: strings.TrimSpace(profile) != "", Agents: out}, nil
}

// handleCapabilities is GET /api/agents/capabilities — the read-only catalog.
func (s *Server) handleCapabilities(w http.ResponseWriter, r *http.Request) {
	cat, err := s.buildCatalog()
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, cat)
}
```

В `internal/web/api.go` после строки `mux.HandleFunc("GET /api/agents/definitions/{id}", s.getAgentDefinition)` добавить:
```go
	mux.HandleFunc("GET /api/agents/capabilities", s.handleCapabilities)
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/web/ -v
```
Expected: PASS (весь web-пакет компилируется и проходит).

- [ ] **Step 5: Commit**

```bash
git add internal/web/capabilities.go internal/web/capabilities_handler_test.go internal/web/api.go
git commit -m "feat(web): GET /api/agents/capabilities catalog endpoint (S4)"
```

---

### Task 5: Снимок памяти — агент-сторона (IPC `memory_summary`)

**Files:**
- Create: `agent-runner/src/memory-summary.ts` (чистый хелпер)
- Create: `agent-runner/src/memory-summary.test.ts` (vitest)
- Modify: `agent-runner/src/mcp-memory.ts` (репорт на старте + после store/forget)

- [ ] **Step 1: Написать падающий тест**

Создать `agent-runner/src/memory-summary.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { toMemorySummary } from "./memory-summary.js";

describe("toMemorySummary", () => {
  it("converts a unix-epoch max into RFC3339 last_updated", () => {
    const s = toMemorySummary(12, 1_750_000_000); // 2025-06-15T...Z
    expect(s.count).toBe(12);
    expect(s.last_updated).toBe(new Date(1_750_000_000 * 1000).toISOString());
  });
  it("returns empty last_updated when there are no memories", () => {
    const s = toMemorySummary(0, 0);
    expect(s).toEqual({ count: 0, last_updated: "" });
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

```bash
cd agent-runner && npm install && npx vitest run src/memory-summary.test.ts
```
Expected: FAIL — `./memory-summary.js` не существует.

- [ ] **Step 3: Реализовать чистый хелпер**

Создать `agent-runner/src/memory-summary.ts`:
```ts
// memory-summary computes the catalog snapshot ({count, last_updated}) from raw
// memory.db aggregates. Kept free of node:sqlite so it is unit-testable.
export interface MemorySummary {
  count: number;
  last_updated: string; // RFC3339, "" when there are no memories
}

// toMemorySummary builds the snapshot. maxEpoch is MAX(updated_at) in unix
// seconds (memory.db stores updated_at as unixepoch()); 0 means "no rows".
export function toMemorySummary(count: number, maxEpoch: number): MemorySummary {
  return {
    count,
    last_updated: maxEpoch > 0 ? new Date(maxEpoch * 1000).toISOString() : "",
  };
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

```bash
cd agent-runner && npx vitest run src/memory-summary.test.ts
```
Expected: PASS.

- [ ] **Step 5: Подключить к mcp-memory.ts**

В `agent-runner/src/mcp-memory.ts`:

1. В импортах добавить:
```ts
import { sendIPC } from "./ipc.js";
import { toMemorySummary } from "./memory-summary.js";
```

2. Добавить функцию-репортер (рядом с `backfillEmbeddings`):
```ts
// reportMemorySummary pushes a {count, last_updated} snapshot to the host so
// the S4 catalog can show memory state even while this agent is stopped.
// Best-effort: never throws into callers.
function reportMemorySummary(): void {
  try {
    const row = memoryDb
      .prepare("SELECT COUNT(*) AS c, COALESCE(MAX(updated_at), 0) AS m FROM memories")
      .get() as { c: number | bigint; m: number | bigint };
    const summary = toMemorySummary(Number(row.c), Number(row.m));
    void sendIPC("memory_summary", { ...summary }).catch((err) =>
      console.error("[mcp-memory] memory_summary IPC failed:", err)
    );
  } catch (err) {
    console.error("[mcp-memory] reportMemorySummary failed:", err);
  }
}
```

3. В `main()` после инициализации (рядом с запуском backfill через `setTimeout`) добавить вызов:
```ts
  reportMemorySummary();
```

4. В обработчике инструмента `memory_store` — в конце успешной ветки (после записи в БД, перед `return`) добавить:
```ts
  reportMemorySummary();
```

5. В обработчике инструмента `memory_forget` — аналогично, после удаления, перед `return`:
```ts
  reportMemorySummary();
```

- [ ] **Step 6: Проверить сборку бандла (esbuild не нужен новый — memory-summary.ts импортируется в mcp-memory.ts)**

```bash
cd agent-runner && npx tsc --noEmit
```
Expected: без ошибок типов.

- [ ] **Step 7: Commit**

```bash
git add agent-runner/src/memory-summary.ts agent-runner/src/memory-summary.test.ts agent-runner/src/mcp-memory.ts
git commit -m "feat(agent): report memory_summary snapshot via IPC (S4)"
```

---

### Task 6: Снимок памяти — хост-сторона (`memory_summary` IPC handler)

**Files:**
- Modify: `internal/agent/orchestrator.go` (case + `applyMemorySummary` + `ipcMemorySummary`)
- Test: `internal/agent/orchestrator_test.go`

- [ ] **Step 1: Написать падающий тест**

Создать `internal/agent/orchestrator_test.go`:
```go
package agent

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/mtzanidakis/praktor/internal/store"
)

func TestApplyMemorySummary(t *testing.T) {
	st, err := store.New(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = st.Close() }()

	o := &Orchestrator{store: st}
	payload := json.RawMessage(`{"count":9,"last_updated":"2026-06-20T08:00:00Z"}`)
	now := time.Date(2026, 6, 20, 9, 0, 0, 0, time.UTC)

	if err := o.applyMemorySummary("agent-x", payload, now); err != nil {
		t.Fatal(err)
	}
	stats, err := st.GetMemoryStats()
	if err != nil {
		t.Fatal(err)
	}
	got := stats["agent-x"]
	if got.Count != 9 || got.LastUpdated != "2026-06-20T08:00:00Z" {
		t.Fatalf("stat = %+v", got)
	}
	if got.ReportedAt != "2026-06-20T09:00:00Z" {
		t.Fatalf("reported_at = %q (host should stamp it)", got.ReportedAt)
	}
}

func TestApplyMemorySummaryRejectsBadPayload(t *testing.T) {
	st, _ := store.New(t.TempDir() + "/test.db")
	defer func() { _ = st.Close() }()
	o := &Orchestrator{store: st}
	if err := o.applyMemorySummary("a", json.RawMessage(`not json`), time.Now()); err == nil {
		t.Fatal("expected error on bad payload")
	}
}
```

- [ ] **Step 2: Запустить — убедиться, что падает**

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/agent/ -run TestApplyMemorySummary -v
```
Expected: FAIL — `applyMemorySummary` не определён.

- [ ] **Step 3: Реализовать**

В `internal/agent/orchestrator.go` убедиться, что импортирован `"time"` (если нет — добавить). В `handleIPC` в `switch cmd.Type` после `case "search_history":` добавить:
```go
	case "memory_summary":
		o.ipcMemorySummary(msg, agentID, cmd.Payload)
```

Рядом с прочими `ipc*`-методами добавить:
```go
// applyMemorySummary parses a memory_summary payload and upserts the snapshot,
// stamping reported_at host-side (we don't trust the container clock). Split
// from ipcMemorySummary so it is unit-testable without NATS.
func (o *Orchestrator) applyMemorySummary(agentID string, payload json.RawMessage, now time.Time) error {
	var req struct {
		Count       int    `json:"count"`
		LastUpdated string `json:"last_updated"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		return fmt.Errorf("invalid memory_summary payload: %w", err)
	}
	return o.store.UpsertMemoryStats(agentID, req.Count, req.LastUpdated, now.UTC().Format(time.RFC3339))
}

func (o *Orchestrator) ipcMemorySummary(msg *nats.Msg, agentID string, payload json.RawMessage) {
	if err := o.applyMemorySummary(agentID, payload, time.Now()); err != nil {
		o.respondIPC(msg, map[string]any{"error": err.Error()})
		return
	}
	o.respondIPC(msg, map[string]any{"ok": true})
}
```

Note: если `fmt` ещё не импортирован в orchestrator.go — добавить (он почти наверняка уже есть).

- [ ] **Step 4: Запустить — убедиться, что проходит**

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/agent/ -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/agent/orchestrator.go internal/agent/orchestrator_test.go
git commit -m "feat(agent): memory_summary IPC handler upserts snapshot (S4)"
```

---

### Task 7: React — страница Catalog

**Files:**
- Create: `ui/src/pages/catalogStatus.ts`
- Create: `ui/src/pages/__tests__/catalogStatus.test.ts`
- Create: `ui/src/pages/Catalog.tsx`
- Modify: `ui/src/App.tsx` (lazy route + nav + icon)

- [ ] **Step 1: Написать падающий тест (хелперы)**

Создать `ui/src/pages/__tests__/catalogStatus.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { formatMemory, type AgentCapabilities } from '../catalogStatus';

const base: AgentCapabilities = {
  agent_id: 'a', description: '', model: 'm',
  builtin: [], extensions: { mcp_servers: [], skills: [], plugins: [] },
  allowed_tools: [], restricted: false, memory: null,
};

describe('formatMemory', () => {
  it('reports no data when memory is null', () => {
    expect(formatMemory(base.memory)).toBe('нет данных');
  });
  it('summarises count and date when present', () => {
    const out = formatMemory({ count: 47, last_updated: '2026-06-18T08:00:00Z', reported_at: '2026-06-20T09:00:00Z' });
    expect(out).toContain('47');
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

```bash
cd ui && npx vitest run src/pages/__tests__/catalogStatus.test.ts
```
Expected: FAIL — `../catalogStatus` не существует.

- [ ] **Step 3: Реализовать хелперы**

Создать `ui/src/pages/catalogStatus.ts`:
```ts
export interface Capability {
  key: string;
  label: string;
  group: string;
  tools?: string[];
}

export interface MemoryStats {
  count: number;
  last_updated?: string;
  reported_at: string;
}

export interface AgentCapabilities {
  agent_id: string;
  description: string;
  model: string;
  builtin: Capability[];
  extensions: { mcp_servers: string[]; skills: string[]; plugins: string[] };
  allowed_tools: string[];
  restricted: boolean;
  memory: MemoryStats | null;
}

export interface CatalogResponse {
  user_profile_present: boolean;
  agents: AgentCapabilities[];
}

// formatMemory renders the one-line memory summary for an agent card.
export function formatMemory(mem: MemoryStats | null): string {
  if (!mem) return 'нет данных';
  const when = mem.last_updated ? ` · ${mem.last_updated.slice(0, 10)}` : '';
  return `${mem.count} записей${when}`;
}

// capabilityGroups returns the distinct capability group labels for chips.
export function capabilityGroups(agent: AgentCapabilities): string[] {
  return agent.builtin.map((c) => c.group);
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

```bash
cd ui && npx vitest run src/pages/__tests__/catalogStatus.test.ts
```
Expected: PASS.

- [ ] **Step 5: Реализовать страницу**

Создать `ui/src/pages/Catalog.tsx`:
```tsx
import { useState, useEffect, useCallback } from 'react';
import {
  formatMemory, capabilityGroups,
  type CatalogResponse, type AgentCapabilities,
} from './catalogStatus';

const card: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: 10, padding: 16, boxShadow: 'var(--shadow)', marginBottom: 12,
};
const chip: React.CSSProperties = {
  display: 'inline-block', padding: '2px 8px', borderRadius: 6,
  border: '1px solid var(--border)', fontSize: 12, marginRight: 6, marginTop: 4,
};
const btn: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)',
  cursor: 'pointer', fontSize: 13, background: 'transparent', color: 'inherit',
};

function AgentCard({ a }: { a: AgentCapabilities }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <strong>{a.agent_id}</strong>
          {a.restricted && (
            <span style={{ ...chip, borderColor: 'crimson', color: 'crimson' }}>restricted</span>
          )}
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {a.model} · память: {formatMemory(a.memory)}
          </div>
          <div>
            {capabilityGroups(a).map((g) => (
              <span key={g} style={chip}>{g}</span>
            ))}
          </div>
        </div>
        <button style={btn} onClick={() => setOpen((v) => !v)}>
          {open ? 'Скрыть' : 'Детали'}
        </button>
      </div>
      {open && (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12, fontSize: 14 }}>
          <p style={{ margin: '0 0 8px' }}>{a.description || '—'}</p>
          <div style={{ marginBottom: 8 }}>
            <strong>Встроенные возможности:</strong>
            <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
              {a.builtin.map((c) => (
                <li key={c.key}>{c.label}{c.tools?.length ? ` (${c.tools.join(', ')})` : ''}</li>
              ))}
            </ul>
          </div>
          <div style={{ marginBottom: 8 }}>
            <strong>Расширения:</strong>{' '}
            {a.extensions.mcp_servers.length + a.extensions.skills.length + a.extensions.plugins.length === 0
              ? 'нет'
              : `MCP: ${a.extensions.mcp_servers.join(', ') || '—'}; skills: ${a.extensions.skills.join(', ') || '—'}; plugins: ${a.extensions.plugins.join(', ') || '—'}`}
          </div>
          <div style={{ marginBottom: 8 }}>
            <strong>allowed_tools:</strong>{' '}
            {a.allowed_tools.length ? a.allowed_tools.join(', ') : 'без ограничений'}
          </div>
          {a.memory && (
            <div>
              <strong>Память:</strong> {a.memory.count} записей
              {a.memory.last_updated ? `, последняя ${a.memory.last_updated.slice(0, 10)}` : ''}
              {` (снимок ${a.memory.reported_at.slice(0, 10)})`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Catalog() {
  const [data, setData] = useState<CatalogResponse | null>(null);

  const fetchData = useCallback(() => {
    fetch('/api/agents/capabilities')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('load failed'))))
      .then((d: CatalogResponse) => setData(d))
      .catch(() => setData({ user_profile_present: false, agents: [] }));
  }, []);
  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 16 }}>Каталог возможностей</h1>
      <div style={{ ...card, color: 'var(--text-secondary)' }}>
        Профиль пользователя: {data?.user_profile_present ? 'задан' : 'не задан'}
      </div>
      {data?.agents.length === 0 && <div style={card}>Нет агентов.</div>}
      {data?.agents.map((a) => <AgentCard key={a.agent_id} a={a} />)}
    </div>
  );
}

export default Catalog;
```

- [ ] **Step 6: Подключить навигацию**

В `ui/src/App.tsx`:

1. Рядом с другими `lazy(...)` добавить:
```tsx
const Catalog = lazy(() => import('./pages/Catalog'));
```
2. Добавить icon-компонент (рядом с прочими `Icon*`):
```tsx
function IconCatalog() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2.5" width="12" height="3" rx="0.5" />
      <rect x="2" y="6.5" width="12" height="3" rx="0.5" />
      <rect x="2" y="10.5" width="12" height="3" rx="0.5" />
    </svg>
  );
}
```
3. В массиве `navItems` (после элемента `Agents` или рядом) добавить:
```tsx
  { to: '/catalog', label: 'Catalog', Icon: IconCatalog },
```
4. В `<Routes>` добавить:
```tsx
            <Route path="/catalog" element={<Catalog />} />
```

- [ ] **Step 7: Запустить тест + build**

```bash
cd ui && npx vitest run && npm run build
```
Expected: vitest PASS (включая `catalogStatus.test.ts`); `tsc && vite build` без ошибок, в выводе — чанк `Catalog-*.js`.

- [ ] **Step 8: Commit**

```bash
git add ui/src/pages/catalogStatus.ts ui/src/pages/__tests__/catalogStatus.test.ts ui/src/pages/Catalog.tsx ui/src/App.tsx
git commit -m "feat(ui): Catalog page — read-only capability catalog (S4)"
```

---

## Развёртывание и верификация (после реализации)

**Финальные гейты перед PR (всё зелёное):**
- Go: `go test ./...`, `go vet ./...`, `CGO_ENABLED=0 go build ./...` в Docker — PASS. (Полный прогон без `| tail` — durable-урок: pipe-exit маскирует FAIL.)
- gofmt по git-блобам новых/изменённых `.go` — пусто.
- agent-runner: `npx vitest run` PASS, `npx tsc --noEmit` без ошибок.
- UI: `npx vitest run` PASS, `npm run build` без ошибок (чанк `Catalog-*.js`).

**PR форка:** `gh pr create --repo Meta-Psy/praktor --base main --head feature/s4-capability-catalog` (заголовок «feat: S4 capability catalog», тело — ссылка на design+plan, список изменений).

**[ALEX]-гейты (новых секретов/env/репо НЕТ):**
1. merge PR `Meta-Psy/praktor#?` (хард-правило #1 — только Alex).
2. `~/praktor/redeploy.sh` (pull → build СИНХРОННО → up → verify; пересобирает оркестратор И образ агента — снимок памяти требует нового agent-bundle). Проверка: `curl -s -o /dev/null -w '%{http_code}' localhost:8080/api/agents/capabilities` → 401 (за auth = маршрут жив); asset `Catalog-*.js` = 200.
3. **phone-verify** `mc.alexmetapsy.com` (инкогнито / сброс PWA-SW — бандл сменился):
   - Страница **Catalog** в nav → карточки агентов с чипами возможностей + бейджем restricted (где задан `allowed_tools`).
   - «Детали» раскрывает встроенные возможности + расширения + `allowed_tools`.
   - Строка профиля сверху («задан/не задан»).
   - **[после первого сообщения агенту]** строка памяти показывает счёт+дату (агент при запуске/записи памяти прислал `memory_summary`). До первого запуска — «нет данных» (ожидаемо).

После зелёного → **S4 ЗАКРЫТ** (roadmap doing→done), выбор S5/S6, апрув Alex.

---

## Self-Review

**Spec coverage:**
- D1 (инвентарь + память) → Task 1/3 (инвентарь) + Task 2/5/6 (память) ✅
- D2 (память=сводка; профиль глобальный хост-сторона) → Task 5 `toMemorySummary` (count+last_updated, без профиля) + Task 4 `buildCatalog` `user_profile_present` из `GetUserMD` ✅
- D3 (Подход 1: каталог в шлюзе + IPC-снимок) → Task 4 (сборка хост-сторона) + Task 5/6 (IPC) ✅
- D4 (всё внутри шлюза, без внешнего репо) → Task 4 (источники: registry+store) ✅
- D5 (UX обзор+drill-down, read-only) → Task 7 (карточки+детали, ни одной мутирующей кнопки) ✅
- D6 (per-agent ось) → Task 7 (карточка на агента) ✅
- Модель данных (таблица + типы) → Task 2 (`agent_memory_stats`) + Task 3 (`AgentCapabilities`/`MemoryStats`/`ExtensionsSummary`/`CatalogResponse`) ✅
- MC-поверхность (GET capabilities) → Task 4 ✅
- Обработка ошибок (mem nil→«нет данных»; restricted; ext пусто; 500 при ошибке БД) → Task 3/4/7 ✅
- Тестирование (Go-юниты, TS-юнит, UI-юнит) → Tasks 1-7 ✅
- Не-цели (без редактирования/без содержимого памяти/без live-опроса/без swarm-per-agent/без трендов) → соблюдены (read-only, summary-only) ✅
- [ALEX]-гейты → раздел развёртывания ✅

**Placeholder scan:** код приведён в каждом шаге; PR-номер `#?` — корректный pre-open плейсхолдер. Чисто.

**Type consistency:** `Capability` (Task 1) ↔ импорт в `AgentCapabilities.Builtin` (Task 3) ↔ TS `Capability` (Task 7); `MemoryStat` стора (Task 2, поля Count/LastUpdated/ReportedAt) ↔ `MemoryStats` web (Task 3) ↔ маппинг в `buildCatalog` (Task 4) ↔ TS `MemoryStats` (Task 7); `UpsertMemoryStats(agentID, count, lastUpdated, reportedAt)` (Task 2) ↔ вызов в `applyMemorySummary` (Task 6); `toMemorySummary(count, maxEpoch)→{count,last_updated}` (Task 5) ↔ payload `{count, last_updated}` парсится в `applyMemorySummary` (Task 6); `assembleCapabilities(a, def, model, ext, mem)` (Task 3) ↔ вызов в `buildCatalog` (Task 4); `CatalogResponse{user_profile_present, agents}` (Task 3) ↔ TS `CatalogResponse` (Task 7) ↔ тест хендлера (Task 4). Согласовано.
