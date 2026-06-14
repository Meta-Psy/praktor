# S3 — approve-планов-из-UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать Alex'у одобрять/отклонять планы COMPLEX-задач с устройства (MC), не запуская исполнение на сервере — approve флипает статус item'а в очереди S2, локальный CC подхватывает.

**Architecture:** Тонкий слой поверх инфраструктуры S2. Очередь `intake-queue` хранит план как файл `items/<id>.plan.md`; MC рендерит его и через 2 эндпоинта флипает статус item'а с оптимистичным SHA. Producer (план→очередь) и executor (исполнение approved) — расширения локальной команды `/intake-drain`. Переиспользуем `internal/intake` (Item, статус-машина, `Queue`), `internal/web/intake.go` (reader/cache), `GitHubClient` (read), `s.audit` (TG), React-паттерны Intake/Portfolio и модалку F.3.

**Tech Stack:** Go 1.26 (stdlib `net/http`), React 19 + react-router 7 + Vite, `marked` + `dompurify` (новые UI-депы), GitHub Contents API, vitest.

**Spec:** `_specs/2026-06-15-phase-f-stage-s3-approve-plans-design.md`

**Ветка:** `feature/s3-approve-plans` (форк `Meta-Psy/praktor`, от свежего `origin/main`). Команда `/intake-drain` — в репозитории `~/.claude` (ветка `feature/phase-e-e2e-handoff`, отдельный config-репо, без PR).

**Verification env (Go):** Go нативно нет — все Go-проверки в Docker:
```bash
docker run --rm -v "$PWD":/src -w /src \
  -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build \
  -e MSYS_NO_PATHCONV=1 -e GOTOOLCHAIN=auto golang:1.26rc1 <cmd>
```
gofmt на Windows-чекауте врёт из-за CRLF — проверять по git-блобам: `git show :path/file.go | gofmt -d` (пусто = ок).

---

### Task 1: Статус `approved`, поля плана, рёбра статус-машины

**Files:**
- Modify: `internal/intake/item.go`
- Test: `internal/intake/item_test.go`

- [ ] **Step 1: Написать падающий тест**

Добавить в `internal/intake/item_test.go` новый тест:

```go
func TestS3Transitions(t *testing.T) {
	cases := []struct {
		from, to string
		want     bool
	}{
		{StatusNeedsDesign, StatusAwaitingApproval, true},   // producer прикрепил план
		{StatusAwaitingApproval, StatusApproved, true},      // approve
		{StatusAwaitingApproval, StatusNeedsDesign, true},   // reject
		{StatusApproved, StatusInProgress, true},            // executor взял
		{StatusApproved, StatusDone, false},                 // только через in_progress
		{StatusQueued, StatusApproved, false},               // нельзя одобрить незатриаженное
	}
	for _, c := range cases {
		if got := ValidTransition(c.from, c.to); got != c.want {
			t.Errorf("ValidTransition(%q,%q) = %v, want %v", c.from, c.to, got, c.want)
		}
	}
}

func TestItemPlanFields(t *testing.T) {
	it := Item{ID: "x", PlanFile: "items/x.plan.md", ReviewNote: "переделай раздел A"}
	b, err := json.Marshal(it)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"plan_file":"items/x.plan.md"`) {
		t.Fatalf("plan_file not serialized: %s", b)
	}
	if !strings.Contains(string(b), `"review_note":"переделай раздел A"`) {
		t.Fatalf("review_note not serialized: %s", b)
	}
}
```

Добавить импорты `"encoding/json"` и `"strings"` в начало `item_test.go` (если их там нет).

- [ ] **Step 2: Запустить — убедиться, что падает**

```bash
docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e MSYS_NO_PATHCONV=1 -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/intake/ -run 'TestS3Transitions|TestItemPlanFields' -v
```
Expected: FAIL — `StatusApproved` undefined, `PlanFile`/`ReviewNote` undefined.

- [ ] **Step 3: Реализовать**

В `internal/intake/item.go` в блок статусов добавить:
```go
	StatusApproved           = "approved"
```
(рядом с `StatusAwaitingApproval`).

В `type Item struct` добавить два поля (после `Status`):
```go
	PlanFile   string `json:"plan_file,omitempty"`   // "items/<id>.plan.md", set by producer
	ReviewNote string `json:"review_note,omitempty"` // reject reason from MC
```

В `var transitions` заменить три записи:
```go
	StatusTriaged:          {StatusInProgress, StatusAwaitingApproval, StatusNeedsDesign, StatusError},
	StatusInProgress:       {StatusDone, StatusError},
	StatusAwaitingApproval: {StatusInProgress, StatusDone, StatusApproved, StatusNeedsDesign, StatusError},
	StatusNeedsDesign:      {StatusInProgress, StatusAwaitingApproval, StatusError},
	StatusApproved:         {StatusInProgress, StatusError},
```
(добавлены: `awaiting-approval→{approved,needs-design}`, `needs-design→awaiting-approval`, новый ключ `approved→{in_progress,error}`.)

- [ ] **Step 4: Запустить — убедиться, что проходит**

```bash
docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e MSYS_NO_PATHCONV=1 -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/intake/ -v
```
Expected: PASS (все тесты пакета, включая существующие `TestValidTransition`/`TestAssemble`).

- [ ] **Step 5: Commit**

```bash
git add internal/intake/item.go internal/intake/item_test.go
git commit -m "feat(intake): approved status + plan_file/review_note + S3 transitions"
```

---

### Task 2: Чтение item'а с SHA (`GetFileWithSHA` + `getItem`)

**Files:**
- Modify: `internal/web/github.go` (добавить `GetFileWithSHA`)
- Modify: `internal/web/intake.go` (расширить интерфейс `intakeFetcher`, добавить `intakeReader.getItem`)
- Test: `internal/web/intake_test.go` (расширить `fakeIntakeFetcher`, тест `getItem`)

- [ ] **Step 1: Написать падающий тест**

Добавить в `internal/web/intake_test.go`:
```go
func TestIntakeReaderGetItem(t *testing.T) {
	item := `{"id":"20260615T100000Z-ab12","source":"web","raw_text":"build X","status":"awaiting-approval","created_at":"2026-06-15T10:00:00Z","updated_at":"2026-06-15T10:00:00Z"}`
	f := &fakeIntakeFetcher{files: map[string]string{
		"items/20260615T100000Z-ab12.json": item,
	}}
	r := &intakeReader{gh: f, repo: "r/q"}
	it, sha, err := r.getItem(context.Background(), "20260615T100000Z-ab12")
	if err != nil {
		t.Fatal(err)
	}
	if it.Status != "awaiting-approval" || it.RawText != "build X" {
		t.Fatalf("item = %+v", it)
	}
	if sha == "" {
		t.Fatal("expected non-empty sha")
	}
}
```

Note: `fakeIntakeFetcher` уже есть в этом файле с полем `files map[string]string` (проверь его форму у строки ~18; если структура иная — адаптируй ключи). Добавить ему метод (новый интерфейсный):
```go
func (f *fakeIntakeFetcher) GetFileWithSHA(_ context.Context, _, path string) ([]byte, string, error) {
	b, err := f.GetFileContent(context.Background(), "", path)
	if err != nil {
		return nil, "", err
	}
	return b, "sha-" + path, nil
}
```

- [ ] **Step 2: Запустить — убедиться, что падает**

```bash
docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e MSYS_NO_PATHCONV=1 -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/web/ -run TestIntakeReaderGetItem -v
```
Expected: FAIL — `r.getItem` undefined; возможно `*GitHubClient` не реализует расширенный `intakeFetcher`.

- [ ] **Step 3: Реализовать**

В `internal/web/github.go` после `GetFileContent` добавить:
```go
// GetFileWithSHA fetches a file's raw bytes and its blob SHA. The SHA is required
// to update the file via the Contents API (optimistic concurrency).
func (c *GitHubClient) GetFileWithSHA(ctx context.Context, repo, path string) ([]byte, string, error) {
	var raw struct {
		Content  string `json:"content"`
		Encoding string `json:"encoding"`
		SHA      string `json:"sha"`
	}
	if err := c.get(ctx, "/repos/"+repo+"/contents/"+path, &raw); err != nil {
		return nil, "", err
	}
	if raw.Encoding != "base64" {
		return nil, "", fmt.Errorf("github contents %s: unexpected encoding %q", path, raw.Encoding)
	}
	b, err := base64.StdEncoding.DecodeString(strings.ReplaceAll(raw.Content, "\n", ""))
	return b, raw.SHA, err
}
```

В `internal/web/intake.go` расширить интерфейс `intakeFetcher`:
```go
type intakeFetcher interface {
	ListDir(ctx context.Context, repo, dir string) ([]string, error)
	GetFileContent(ctx context.Context, repo, path string) ([]byte, error)
	GetFileWithSHA(ctx context.Context, repo, path string) ([]byte, string, error)
}
```

И добавить метод `getItem` (после метода `list`):
```go
// getItem fetches one queue item plus its blob SHA, for status transitions.
func (r *intakeReader) getItem(ctx context.Context, id string) (intake.Item, string, error) {
	raw, sha, err := r.gh.GetFileWithSHA(ctx, r.repo, "items/"+id+".json")
	if err != nil {
		return intake.Item{}, "", err
	}
	var it intake.Item
	if err := json.Unmarshal(raw, &it); err != nil {
		return intake.Item{}, "", err
	}
	return it, sha, nil
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

```bash
docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e MSYS_NO_PATHCONV=1 -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/web/ -run 'TestIntake' -v
```
Expected: PASS (новый тест + существующие intake-тесты).

- [ ] **Step 5: Commit**

```bash
git add internal/web/github.go internal/web/intake.go internal/web/intake_test.go
git commit -m "feat(web): GetFileWithSHA + intakeReader.getItem (S3 reads item+sha)"
```

---

### Task 3: Запись item'а с SHA (`Queue.Update`)

**Files:**
- Modify: `internal/intake/queue.go` (добавить `Update`)
- Modify: `internal/web/intake.go` (расширить интерфейс `intakeWriter`)
- Test: `internal/intake/queue_test.go` (тест `Update` шлёт PUT с sha)
- Modify: `internal/web/intake_test.go` (расширить `fakeQueue`)

- [ ] **Step 1: Написать падающий тест**

Добавить в `internal/intake/queue_test.go` (если файла нет — создать с `package intake` и импортами `context`, `encoding/json`, `io`, `net/http`, `net/http/httptest`, `strings`, `testing`):
```go
func TestQueueUpdateSendsSHA(t *testing.T) {
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			t.Errorf("method = %s", r.Method)
		}
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &gotBody)
		w.WriteHeader(http.StatusOK) // update → 200
	}))
	defer srv.Close()

	q := &Queue{Token: "t", Repo: "o/r", BaseURL: srv.URL, HTTP: srv.Client()}
	it := Item{ID: "id1", Status: StatusApproved}
	if err := q.Update(context.Background(), it, "sha-abc"); err != nil {
		t.Fatal(err)
	}
	if gotBody["sha"] != "sha-abc" {
		t.Fatalf("sha in body = %v, want sha-abc", gotBody["sha"])
	}
}
```

- [ ] **Step 2: Запустить — убедиться, что падает**

```bash
docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e MSYS_NO_PATHCONV=1 -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/intake/ -run TestQueueUpdateSendsSHA -v
```
Expected: FAIL — `q.Update` undefined.

- [ ] **Step 3: Реализовать**

В `internal/intake/queue.go` после `Put` добавить:
```go
// Update overwrites items/<id>.json carrying sha (optimistic concurrency); a
// stale sha makes the Contents API reject the write.
func (q *Queue) Update(ctx context.Context, it Item, sha string) error {
	data, err := json.MarshalIndent(it, "", "  ")
	if err != nil {
		return err
	}
	return q.putFile(ctx, "items/"+it.ID+".json", data, "intake: "+it.Status+" "+it.ID, sha)
}
```

В `internal/web/intake.go` расширить интерфейс `intakeWriter`:
```go
type intakeWriter interface {
	Put(ctx context.Context, it intake.Item) error
	PutMedia(ctx context.Context, id, name string, data []byte) (string, error)
	Update(ctx context.Context, it intake.Item, sha string) error
}
```

В `internal/web/intake_test.go` расширить `fakeQueue`: добавить поле `updatedSHA string` в структуру и метод:
```go
func (f *fakeQueue) Update(_ context.Context, it intake.Item, sha string) error {
	f.put = &it
	f.updatedSHA = sha
	return nil
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

```bash
docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e MSYS_NO_PATHCONV=1 -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/intake/ ./internal/web/ -v
```
Expected: PASS (новый Update-тест + весь web-пакет компилируется с расширенным `intakeWriter`).

- [ ] **Step 5: Commit**

```bash
git add internal/intake/queue.go internal/intake/queue_test.go internal/web/intake.go internal/web/intake_test.go
git commit -m "feat(intake): Queue.Update writes item with sha (S3 status flip)"
```

---

### Task 4: `GET /api/intake/{id}/plan` — отдать markdown плана

**Files:**
- Modify: `internal/web/intake.go` (handler `handleIntakePlan`)
- Modify: `internal/web/api.go` (route)
- Test: `internal/web/intake_test.go`

- [ ] **Step 1: Написать падающий тест**

```go
func TestHandleIntakePlan(t *testing.T) {
	f := &fakeIntakeFetcher{files: map[string]string{
		"items/id1.plan.md": "# Plan\n\n- step one\n",
	}}
	s := &Server{intake: &intakeReader{gh: f, repo: "r/q"}}
	req := httptest.NewRequest(http.MethodGet, "/api/intake/id1/plan", nil)
	req.SetPathValue("id", "id1")
	rec := httptest.NewRecorder()
	s.handleIntakePlan(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d (%s)", rec.Code, rec.Body)
	}
	if !strings.Contains(rec.Body.String(), "# Plan") {
		t.Fatalf("body = %q", rec.Body.String())
	}
}

func TestHandleIntakePlanMissing404(t *testing.T) {
	f := &fakeIntakeFetcher{files: map[string]string{}} // GetFileContent returns error for unknown
	s := &Server{intake: &intakeReader{gh: f, repo: "r/q"}}
	req := httptest.NewRequest(http.MethodGet, "/api/intake/nope/plan", nil)
	req.SetPathValue("id", "nope")
	rec := httptest.NewRecorder()
	s.handleIntakePlan(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("code = %d", rec.Code)
	}
}
```

Note: убедись, что `fakeIntakeFetcher.GetFileContent` возвращает ошибку для отсутствующего ключа (так его строит существующий тест-код; если он возвращает пусто без ошибки — поправь fake, чтобы неизвестный путь давал `error`, иначе 404-тест не пройдёт).

- [ ] **Step 2: Запустить — убедиться, что падает**

```bash
docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e MSYS_NO_PATHCONV=1 -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/web/ -run 'TestHandleIntakePlan' -v
```
Expected: FAIL — `s.handleIntakePlan` undefined.

- [ ] **Step 3: Реализовать**

В `internal/web/intake.go` (рядом с `handleIntakeList`) добавить:
```go
// handleIntakePlan is GET /api/intake/{id}/plan — returns the plan markdown for
// an awaiting-approval item. Plan lives at items/<id>.plan.md by convention.
func (s *Server) handleIntakePlan(w http.ResponseWriter, r *http.Request) {
	if s.intake == nil {
		jsonError(w, "intake not configured", http.StatusServiceUnavailable)
		return
	}
	id := r.PathValue("id")
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	md, err := s.intake.gh.GetFileContent(ctx, s.intake.repo, "items/"+id+".plan.md")
	if err != nil {
		jsonError(w, "plan not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	_, _ = w.Write(md)
}
```

В `internal/web/api.go` в блоке `// Intake & triage (S2)` добавить маршрут:
```go
	mux.HandleFunc("GET /api/intake/{id}/plan", s.handleIntakePlan)
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

```bash
docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e MSYS_NO_PATHCONV=1 -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/web/ -run 'TestHandleIntakePlan' -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/web/intake.go internal/web/api.go internal/web/intake_test.go
git commit -m "feat(web): GET /api/intake/{id}/plan serves plan markdown (S3)"
```

---

### Task 5: `POST /api/intake/{id}/{approve,reject}` — флип статуса

**Files:**
- Create: `internal/web/plans.go`
- Create: `internal/web/plans_test.go`
- Modify: `internal/web/api.go` (2 маршрута)

- [ ] **Step 1: Написать падающий тест**

Создать `internal/web/plans_test.go`:
```go
package web

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// planServer wires a reader (fake fetcher) + fakeQueue for transition tests.
func planServer(itemJSON string) (*Server, *fakeQueue) {
	f := &fakeIntakeFetcher{files: map[string]string{
		"items/id1.json": itemJSON,
	}}
	q := &fakeQueue{}
	return &Server{intake: &intakeReader{gh: f, repo: "r/q"}, intakeQueue: q}, q
}

func TestHandleIntakeApprove(t *testing.T) {
	s, q := planServer(`{"id":"id1","source":"web","raw_text":"x","status":"awaiting-approval","created_at":"2026-06-15T10:00:00Z","updated_at":"2026-06-15T10:00:00Z"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/intake/id1/approve", nil)
	req.SetPathValue("id", "id1")
	rec := httptest.NewRecorder()
	s.handleIntakeApprove(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d (%s)", rec.Code, rec.Body)
	}
	if q.put == nil || q.put.Status != "approved" {
		t.Fatalf("queued = %+v", q.put)
	}
	if q.updatedSHA == "" {
		t.Fatal("expected sha passed to Update")
	}
}

func TestHandleIntakeApproveInvalid409(t *testing.T) {
	s, _ := planServer(`{"id":"id1","source":"web","raw_text":"x","status":"queued","created_at":"2026-06-15T10:00:00Z","updated_at":"2026-06-15T10:00:00Z"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/intake/id1/approve", nil)
	req.SetPathValue("id", "id1")
	rec := httptest.NewRecorder()
	s.handleIntakeApprove(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("code = %d, want 409", rec.Code)
	}
}

func TestHandleIntakeReject(t *testing.T) {
	s, q := planServer(`{"id":"id1","source":"web","raw_text":"x","status":"awaiting-approval","created_at":"2026-06-15T10:00:00Z","updated_at":"2026-06-15T10:00:00Z"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/intake/id1/reject", strings.NewReader(`{"reason":"redo section A"}`))
	req.SetPathValue("id", "id1")
	rec := httptest.NewRecorder()
	s.handleIntakeReject(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d (%s)", rec.Code, rec.Body)
	}
	if q.put == nil || q.put.Status != "needs-design" || q.put.ReviewNote != "redo section A" {
		t.Fatalf("queued = %+v", q.put)
	}
}

func TestHandleIntakeApproveNotFound404(t *testing.T) {
	f := &fakeIntakeFetcher{files: map[string]string{}}
	s := &Server{intake: &intakeReader{gh: f, repo: "r/q"}, intakeQueue: &fakeQueue{}}
	req := httptest.NewRequest(http.MethodPost, "/api/intake/missing/approve", nil)
	req.SetPathValue("id", "missing")
	rec := httptest.NewRecorder()
	s.handleIntakeApprove(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("code = %d, want 404", rec.Code)
	}
	_ = context.Background()
}
```

- [ ] **Step 2: Запустить — убедиться, что падает**

```bash
docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e MSYS_NO_PATHCONV=1 -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/web/ -run 'TestHandleIntakeApprove|TestHandleIntakeReject' -v
```
Expected: FAIL — `handleIntakeApprove`/`handleIntakeReject` undefined.

- [ ] **Step 3: Реализовать**

Создать `internal/web/plans.go`:
```go
package web

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/mtzanidakis/praktor/internal/intake"
)

// handleIntakeApprove is POST /api/intake/{id}/approve — awaiting-approval → approved.
// Approve is a status flip only: local CC picks up approved items and executes them
// (COMPLEX is never auto-implemented server-side).
func (s *Server) handleIntakeApprove(w http.ResponseWriter, r *http.Request) {
	s.transitionItem(w, r, intake.StatusApproved, "")
}

// handleIntakeReject is POST /api/intake/{id}/reject — awaiting-approval → needs-design,
// recording the reviewer's reason so the plan can be rewritten.
func (s *Server) handleIntakeReject(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Reason string `json:"reason"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	s.transitionItem(w, r, intake.StatusNeedsDesign, body.Reason)
}

// transitionItem reads an item + its SHA, validates the move against the status
// machine, writes the new status back with that SHA, and audits to Telegram.
func (s *Server) transitionItem(w http.ResponseWriter, r *http.Request, to, reason string) {
	if s.intake == nil || s.intakeQueue == nil {
		jsonError(w, "intake not configured", http.StatusServiceUnavailable)
		return
	}
	id := r.PathValue("id")
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	it, sha, err := s.intake.getItem(ctx, id)
	if err != nil {
		jsonError(w, "item not found", http.StatusNotFound)
		return
	}
	if !intake.ValidTransition(it.Status, to) {
		jsonError(w, "invalid transition from "+it.Status+" to "+to, http.StatusConflict)
		return
	}
	it.Status = to
	it.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	if reason != "" {
		it.ReviewNote = reason
	}
	detail := to + " " + id
	if err := s.intakeQueue.Update(ctx, it, sha); err != nil {
		// A stale SHA (concurrent edit) or upstream failure lands here; the UI
		// refetches the list on any non-2xx, so it self-corrects.
		s.audit(false, detail+": "+err.Error())
		jsonError(w, err.Error(), http.StatusBadGateway)
		return
	}
	s.audit(true, detail)
	jsonResponse(w, map[string]string{"status": it.Status})
}
```

В `internal/web/api.go` в блоке `// Intake & triage (S2)` добавить:
```go
	mux.HandleFunc("POST /api/intake/{id}/approve", s.handleIntakeApprove)
	mux.HandleFunc("POST /api/intake/{id}/reject", s.handleIntakeReject)
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

```bash
docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e MSYS_NO_PATHCONV=1 -e GOTOOLCHAIN=auto golang:1.26rc1 go test ./internal/web/ -v
```
Expected: PASS (весь web-пакет).

- [ ] **Step 5: gofmt + vet + build, затем commit**

```bash
docker run --rm -v "$PWD":/src -w /src -v praktor-gomod:/go/pkg/mod -v praktor-gocache:/root/.cache/go-build -e MSYS_NO_PATHCONV=1 -e GOTOOLCHAIN=auto golang:1.26rc1 sh -c "go vet ./... && go build ./..."
git show :internal/web/plans.go | docker run --rm -i golang:1.26rc1 gofmt -d   # ожидаем пусто
```
Затем:
```bash
git add internal/web/plans.go internal/web/plans_test.go internal/web/api.go
git commit -m "feat(web): POST /api/intake/{id}/approve|reject status flip + TG audit (S3)"
```

---

### Task 6: React — страница Plans (рендер + approve/reject)

**Files:**
- Modify: `ui/package.json` (+ `marked`, `dompurify`)
- Create: `ui/src/pages/planStatus.ts`
- Create: `ui/src/pages/__tests__/planStatus.test.ts`
- Modify: `ui/src/pages/actions.ts` (`approvePlan`/`rejectPlan`)
- Create: `ui/src/pages/Plans.tsx`
- Modify: `ui/src/App.tsx` (nav + lazy route + icon)

- [ ] **Step 1: Установить депы**

```bash
cd ui && npm install marked dompurify
```
(`marked` и `dompurify` v3 несут собственные типы — `@types/*` не нужны. Если `tsc` пожалуется на типы dompurify — `npm install -D @types/dompurify`.)

- [ ] **Step 2: Написать падающий тест (фильтр)**

Создать `ui/src/pages/__tests__/planStatus.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { awaitingPlans } from '../planStatus';
import type { IntakeItem } from '../intakeStatus';

const mk = (id: string, status: string): IntakeItem => ({
  id, source: 'web', raw_text: id, status, created_at: '', updated_at: '',
});

describe('planStatus', () => {
  it('keeps only awaiting-approval items', () => {
    const items = [mk('a', 'queued'), mk('b', 'awaiting-approval'), mk('c', 'approved')];
    const out = awaitingPlans(items);
    expect(out.map((i) => i.id)).toEqual(['b']);
  });
  it('tolerates empty', () => {
    expect(awaitingPlans([])).toEqual([]);
  });
});
```

- [ ] **Step 3: Запустить — убедиться, что падает**

```bash
cd ui && npx vitest run src/pages/__tests__/planStatus.test.ts
```
Expected: FAIL — `../planStatus` не существует.

- [ ] **Step 4: Реализовать helper, actions, страницу, навигацию**

Создать `ui/src/pages/planStatus.ts`:
```ts
import type { IntakeItem } from './intakeStatus';

export type PlanItem = IntakeItem;

// awaitingPlans returns items pending plan approval (caller already sorted by date).
export function awaitingPlans(items: IntakeItem[]): IntakeItem[] {
  return items.filter((it) => it.status === 'awaiting-approval');
}
```

В `ui/src/pages/actions.ts` добавить в конец (переиспользует приватный `post`):
```ts
export function approvePlan(id: string): Promise<void> {
  return post(`/api/intake/${id}/approve`);
}

export function rejectPlan(id: string, reason: string): Promise<void> {
  return post(`/api/intake/${id}/reject`, { reason });
}
```

Создать `ui/src/pages/Plans.tsx`:
```tsx
import { useState, useEffect, useCallback } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { awaitingPlans, type PlanItem } from './planStatus';
import type { IntakeList } from './intakeStatus';
import { approvePlan, rejectPlan } from './actions';

const card: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: 10, padding: 16, boxShadow: 'var(--shadow)', marginBottom: 12,
};
const btn: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)',
  cursor: 'pointer', fontSize: 14, marginRight: 8,
};

function Plans() {
  const [items, setItems] = useState<PlanItem[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [planHtml, setPlanHtml] = useState('');
  const [confirm, setConfirm] = useState<{ id: string; action: 'approve' | 'reject' } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const fetchList = useCallback(() => {
    fetch('/api/intake')
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((d: IntakeList) => setItems(awaitingPlans(d.items || [])))
      .catch(() => setItems([]));
  }, []);
  useEffect(() => { fetchList(); }, [fetchList]);

  const openPlan = useCallback((id: string) => {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    setPlanHtml('');
    fetch(`/api/intake/${id}/plan`)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error('no plan'))))
      .then((md) => setPlanHtml(DOMPurify.sanitize(marked.parse(md) as string)))
      .catch(() => setPlanHtml('<p>План недоступен.</p>'));
  }, [openId]);

  const doAction = useCallback(async () => {
    if (!confirm) return;
    setBusy(true); setMsg(null);
    try {
      if (confirm.action === 'approve') await approvePlan(confirm.id);
      else await rejectPlan(confirm.id, reason);
      setConfirm(null); setReason(''); setOpenId(null);
      fetchList();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [confirm, reason, fetchList]);

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 16 }}>Планы на одобрение</h1>
      {msg && <div style={{ ...card, color: 'crimson' }}>{msg}</div>}
      {items.length === 0 && <div style={card}>Нет планов, ожидающих одобрения.</div>}
      {items.map((it) => (
        <div key={it.id} style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <strong>{it.raw_text.split('\n')[0]}</strong>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {it.target_project || '—'} · {it.created_at.slice(0, 10)}
              </div>
            </div>
            <button style={btn} onClick={() => openPlan(it.id)}>
              {openId === it.id ? 'Скрыть' : 'План'}
            </button>
          </div>
          {openId === it.id && (
            <>
              <div
                style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}
                dangerouslySetInnerHTML={{ __html: planHtml }}
              />
              <div style={{ marginTop: 12 }}>
                <button
                  style={{ ...btn, background: 'var(--accent, #0F8B5C)', color: '#fff' }}
                  onClick={() => setConfirm({ id: it.id, action: 'approve' })}
                >
                  Approve
                </button>
                <button style={btn} onClick={() => setConfirm({ id: it.id, action: 'reject' })}>
                  Reject
                </button>
              </div>
            </>
          )}
        </div>
      ))}

      {confirm && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
        >
          <div style={{ ...card, maxWidth: 420, marginBottom: 0 }}>
            <p style={{ marginTop: 0 }}>
              {confirm.action === 'approve'
                ? 'Одобрить план? Локальный CC начнёт исполнение.'
                : 'Отклонить план?'}
            </p>
            {confirm.action === 'reject' && (
              <textarea
                placeholder="Причина (что переделать)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                style={{ width: '100%', minHeight: 80, marginBottom: 8 }}
              />
            )}
            <div>
              <button style={{ ...btn, background: 'var(--accent, #0F8B5C)', color: '#fff' }} disabled={busy} onClick={doAction}>
                {busy ? '…' : 'Подтвердить'}
              </button>
              <button style={btn} disabled={busy} onClick={() => { setConfirm(null); setReason(''); }}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Plans;
```

В `ui/src/App.tsx`:
1. Рядом с `const Intake = lazy(...)` добавить:
```tsx
const Plans = lazy(() => import('./pages/Plans'));
```
2. Добавить icon-компонент (рядом с `IconIntake`):
```tsx
function IconPlans() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 1.5h6l2.5 2.5V14a.5.5 0 01-.5.5H4a.5.5 0 01-.5-.5V2a.5.5 0 01.5-.5z" />
      <path d="M9.5 1.5V4H12" />
      <path d="M5.5 9l1.5 1.5L10 7.5" />
    </svg>
  );
}
```
3. В массиве `navItems` после строки `{ to: '/intake', label: 'Intake', Icon: IconIntake },` добавить:
```tsx
  { to: '/plans', label: 'Plans', Icon: IconPlans },
```
4. В `<Routes>` после `<Route path="/intake" element={<Intake />} />` добавить:
```tsx
            <Route path="/plans" element={<Plans />} />
```

- [ ] **Step 5: Запустить тест + tsc + build**

```bash
cd ui && npx vitest run && npm run build
```
Expected: vitest PASS (включая planStatus.test.ts и все прежние); `tsc && vite build` без ошибок, в выводе — чанк `Plans-*.js`.

- [ ] **Step 6: Commit**

```bash
git add ui/package.json ui/package-lock.json ui/src/pages/planStatus.ts ui/src/pages/__tests__/planStatus.test.ts ui/src/pages/actions.ts ui/src/pages/Plans.tsx ui/src/App.tsx
git commit -m "feat(ui): Plans page — render plan markdown + approve/reject (S3)"
```

---

### Task 7: `/intake-drain` — producer (план→очередь) + executor (исполнение approved)

**Files:**
- Modify: `C:/Users/Alex/.claude/commands/intake-drain.md` (репозиторий `~/.claude`, ветка `feature/phase-e-e2e-handoff`)

Это команда-документ (инструкция для локального CC), не код Praktor. Коммит в `~/.claude` точечным `git add` на текущей ветке; ревью — диффом для Alex (правило #2). **Перед git-операциями `cd C:/Users/Alex/.claude`** (правило worktree).

- [ ] **Step 1: Расширить маршрут `complex` (producer)**

В разделе маршрутов (рядом со строкой `- **complex:** set status needs-design; ...`) уточнить, что после ручного дизайна план попадает в очередь. Добавить новый под-раздел после описания маршрутов:

```markdown
## Producer: needs-design → awaiting-approval (S3)

Когда для `needs-design`-item проведён дизайн (brainstorming + writing-plans дали план):

1. Запиши план как **markdown-файл** `items/<id>.plan.md` в репо `INTAKE_QUEUE_REPO` через GitHub Contents API (тот же write-PAT, что пишет очередь). Содержимое — человекочитаемый план (что/зачем/шаги/критерии). Создание без SHA (новый файл).
2. Прочитай текущий `items/<id>.json` (с его `sha`), выставь `status: "awaiting-approval"`, `plan_file: "items/<id>.plan.md"`, обнови `updated_at`; запиши обратно PUT с `sha` (update).
3. Не имплементируй. План ждёт одобрения Alex'а на странице **Plans** в MC.
```

- [ ] **Step 2: Добавить executor (approved → исполнение)**

Добавить под-раздел:

```markdown
## Executor: approved → исполнение (S3)

При дренаже для item'ов со статусом `approved` (одобрены Alex'ом в MC):

1. Флип `approved → in_progress` (PUT items/<id>.json с sha).
2. Исполни план `items/<id>.plan.md` через superpowers:executing-plans или subagent-driven-development в целевом репо (`target_project`). COMPLEX исполняется в реальной CC-сессии — НЕ на сервере.
3. На открытии PR — статус `done`, запиши URL PR в item. Если в процессе всплыли вопросы — `needs-clarification`.
4. Если item отклонён (`needs-design` с `review_note`) — учти причину и перепиши план (вернись к Producer).
```

- [ ] **Step 3: Самопроверка диффа**

```bash
cd C:/Users/Alex/.claude && git diff commands/intake-drain.md
```
Убедиться: упомянуты оба перехода (`needs-design→awaiting-approval`, `approved→in_progress`), пути `items/<id>.plan.md` и `items/<id>.json`, требование SHA на update, запрет серверного исполнения. Согласованность статусов с `item.go` (Task 1).

- [ ] **Step 4: Commit (в `~/.claude`)**

```bash
cd C:/Users/Alex/.claude && git add commands/intake-drain.md && git commit -m "feat(commands): /intake-drain — S3 producer (plan→queue) + executor (run approved)"
```

---

## Развёртывание и верификация (после реализации)

**PR форка:** `gh pr create --repo Meta-Psy/praktor --base main --head feature/s3-approve-plans` (заголовок «feat: S3 approve plans from UI», тело — ссылка на design+plan, список изменений).

**Финальные гейты перед PR (всё зелёное):**
- Go: `go test ./...`, `go vet ./...`, `go build ./...` в Docker — PASS.
- gofmt по git-блобам новых/изменённых `.go` — пусто.
- UI: `npx vitest run` PASS, `npm run build` без ошибок (чанк `Plans-*.js`).

**[ALEX]-гейты (прод; PAT/репо/env уже на месте от S2 — новых секретов нет):**
1. merge PR `Meta-Psy/praktor#?` (хард-правило #1 — только Alex).
2. апрув diff `commands/intake-drain.md` в `~/.claude` (правило #2).
3. `~/praktor/redeploy.sh` (pull → build СИНХРОННО → up → verify; образ с S3). Проверка: `curl localhost:8080/api/intake` 200; новый UI-бандл несёт чанк `Plans-*.js`.
4. **phone-verify** `mc.alexmetapsy.com` (инкогнито/сброс PWA-SW — бандл сменился):
   - **[CLAUDE автономно, подготовка]** засеять тестовый item: `items/<id>.json` со `status:"awaiting-approval"`, `plan_file` + `items/<id>.plan.md` с коротким планом (через gh api, write-PAT).
   - Страница **Plans** в nav → элемент виден → «План» рендерит markdown.
   - **Approve** → модалка → Подтвердить → статус item'а в очереди `approved` + TG-аудит `✅ MC: approved <id>`.
   - **Reject** на втором seed-item с причиной → статус `needs-design` + `review_note` в JSON + TG-аудит.
   - **[CLAUDE]** снять серверную сторону (item-JSON в репо, TG) при тесте; очистить seed-items после.

После зелёного теста → **S3 ЗАКРЫТ** (roadmap S3 planned→done), выбор следующей подсистемы (S4 каталог возможностей / S5 / S6), апрув Alex.

---

## Self-Review

**Spec coverage:**
- D1 (approve=флип статуса) → Task 5 `transitionItem` (нет серверного исполнения) ✅
- D2 (план в intake-queue) → Task 4/7 (`items/<id>.plan.md`) ✅
- D3 (Approve+Reject+модалка+TG) → Task 5 (handlers + `s.audit`) + Task 6 (модалка) ✅
- D4 (полный цикл + тонкие команды) → Task 7 (producer+executor) ✅
- D5 (отдельный .md файл) → Task 4 convention ✅
- D6 (marked+dompurify) → Task 6 ✅
- D7 (статус approved) → Task 1 ✅
- Модель данных (поля + 4 ребра) → Task 1 ✅
- MC-поверхность (GET plan, POST approve/reject) → Task 4/5 ✅
- Обработка ошибок (404 нет плана/item, 409 невалидный переход, 502 запись) → Task 4/5 ✅ *(уточнение к спеке: stale-SHA/upstream-сбой → 502 с сообщением GitHub, не 409; для UI идентично — перечитывает список на любой non-2xx. 409 закреплён за детерминированным невалидным переходом.)*
- Тестирование (Go-юниты, UI-юнит, команда-диффом) → Tasks 1-7 ✅
- [ALEX]-гейты → раздел развёртывания ✅

**Placeholder scan:** код приведён в каждом шаге; PR-номер `#?` — корректный pre-open плейсхолдер. Чисто.

**Type consistency:** `StatusApproved`/`StatusNeedsDesign` (Task 1) ↔ `transitionItem(..., intake.StatusApproved/StatusNeedsDesign)` (Task 5); `getItem` (Task 2) возвращает `(intake.Item, string, error)` ↔ вызов в Task 5; `Queue.Update(ctx, it, sha)` (Task 3) ↔ интерфейс `intakeWriter.Update` ↔ `fakeQueue.Update`; `awaitingPlans` (Task 6 helper) ↔ импорт в `Plans.tsx`; `approvePlan`/`rejectPlan` (actions.ts) ↔ вызовы в `Plans.tsx`. Согласовано.
