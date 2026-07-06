# Штаб, этап 5: «Обстановка» (новая главная) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Переработать Dashboard.tsx из пассивных счётчиков в центр решений по §4 спеки `_specs/2026-07-04-shtab-ux-design.md`: шапка с чипами, колонка «Требует решения» (карточки план/PR/аудит/сбой с действиями по месту), живая лента «Активность» по WebSocket.

**Architecture:** Агрегация «Требует решения» собирается на клиенте из уже существующих `/api/status`, `/api/intake`, `/api/projects`, `/api/tasks`, `/api/swarms` — чистыми функциями в новом `dashboardStatus.ts` (тестируются vitest без DOM). Два точечных изменения Go-бэкенда: (1) `/api/tasks` начинает отдавать уже хранимые `last_status`/`last_error` (для карточки «Сбой»), (2) новый `POST /api/tasks/{id}/run` для действия «Повторить сейчас» (ставит `next_run_at = now`, планировщик подхватывает на ближайшем цикле). Действия карточек переиспользуют `ui/src/pages/actions.ts` (approvePlan/rejectPlan/mergePR/approve).

**Tech Stack:** Go (net/http, стандартный mux), React 19 + TypeScript strict, react-router-dom, vitest + testing-library, библиотека `ui/src/components/ui/*`.

---

## Контекст для исполнителя (прочитать перед началом)

- Рабочая копия — worktree `.worktrees/shtab-5`, ветка `feature/shtab-5-obstanovka` от `origin/main` (`git checkout main` в worktree невозможен — основная копия держит main). Git-операции ТОЛЬКО после `cd` в worktree (или `git -C`).
- Windows-окружение: `go` может быть не в PATH — полный путь `C:\Program Files\Go\bin\go.exe`. UI-команды: `cd ui && npm test -- --run`, `npm run build`. UI-suite изредка флачит пулом воркеров vitest — при странном падении перепрогнать.
- **Не коммитить в main. Не пушить без запроса.** Коммиты — Conventional Commits.
- Язык UI — русский. В TypeScript запрещён `any` (используй `unknown` + сужение).

### Утверждённые отклонения от макета `dashboard-v2.html` (дизайн-решения, не самодеятельность)

1. **Чип «почта: N новых» не делаем** — в API нет источника (AgentMail-события уходят агентам, счётчика непрочитанного нет). Чипов три: агенты в работе, активные дежурства, отряды в работе.
2. **Размер диффа PR (+412 −96) не показываем** — `/api/projects` отдаёт по PR только `number/title/url/draft`. CI-статус показываем проектный (`ci` в `ProjectStatus`), не пер-PR.
3. **«Открыть Сейф» у карточки сбоя не делаем** — причина сбоя произвольна; универсальное действие «перейти к источнику» = ссылка «К дежурствам» (`/tasks`).
4. **Выдержка в карточке плана** — из `raw_text` (текст задачи), не из plan.md: тянуть `/api/intake/{id}/plan` для каждой карточки — лишние запросы к GitHub. Полный план читается по «Читать план» → `/intake?tab=plans`.
5. **Лента «Активность»** засеивается `recent_messages` из `/api/status` (история из БД), дальше живёт на WS-событиях (`message`, `agent_started/stopped`, `task_executed`, `swarm_*`). События типа `deploy`/`merge`/«сбор разведсводок» из макета в шину не публикуются — их в ленте не будет (не выдумывать).

### Формы данных источников (как есть в main, менять нельзя кроме Task 1–2)

```
GET /api/status   → { status, version, uptime, active_agents, agents_count, pending_tasks,
                      recent_messages: [{ id, agent, role: 'user'|'assistant', text, time, terminal_reason? }] }
                      // recent_messages отсортированы НОВЫМИ ВПЕРЁД (ORDER BY created_at DESC LIMIT 10)
GET /api/tasks    → [{ id, name, schedule, schedule_display, agent_id, agent_name?, prompt,
                       enabled, status: 'active'|'paused'|'completed', last_run?, next_run? }]
                      // после Task 1 добавятся last_status? ('success'|'error'), last_error?
GET /api/intake   → { items: IntakeItem[] }        // IntakeItem в ui/src/pages/intakeStatus.ts;
                                                    // план на подпись = status === 'awaiting-approval'
GET /api/projects → ProjectStatus[]                 // ui/src/pages/projectStatus.ts
GET /api/swarms   → [{ id, name, status: 'running'|'completed'|'failed', ... }]
GET /api/agents/definitions → [{ id, name, ... }]
```

WS-события (`WsEvent { type, agent_id?, data: unknown, timestamp: RFC3339 }`):

| type | data | текст в ленте |
|---|---|---|
| `message` | `{ id, role, text, time }` | `{агент} ответил` (только role==='assistant') |
| `agent_started` | `{}` | `{агент} запущен` |
| `agent_stopped` | `{}` | `{агент} остановлен` |
| `task_executed` | `{ id, name, status: 'success'\|'error' }` | `дежурство «{name}»: успех/сбой` |
| `swarm_started` | `{ name, agents }` | `отряд «{name}» запущен` |
| `swarm_agent_completed` | `{ role, status, output }` | `отряд: {role} завершил (успех/сбой)` |
| `swarm_completed` | `{ results_count }` | `отряд завершён` |
| `swarm_failed` | `{ error }` | `отряд: сбой` |
| `swarm_tier_completed` | — | пропускаем (шум) |

### Известные грабли из ревью этапа 4 (не повторять)

- `events.length` как зависимость эффекта — БАГ после переполнения буфера: WS-контекст режет массив до 500 (`prev.slice(-500)`), длина перестаёт меняться, обновления умирают. Зависимость — сам массив `events` (ссылка меняется на каждом сообщении).
- Fetch-гонки: перекрывающиеся `fetchAll` (интервал + WS-дебаунс) должны игнорировать устаревшие завершения — паттерн epoch (`fetchEpoch` из Conversations.tsx).
- Ошибку загрузки не глотать молча (антипаттерн Catalog «Нет агентов» при упавшей сети) — источники, которые не удалось опросить, перечисляются в баннере.
- Отчётам субагентов о тестах не верить — контролёр прогоняет полный suite сам.

---

## Структура файлов

| Файл | Действие | Ответственность |
|---|---|---|
| `internal/web/api.go` | правка | `taskToAPI` + `last_status`/`last_error`; маршрут и handler `runTaskNow` |
| `internal/web/tasks_api_test.go` | создать | Go-тесты обоих изменений |
| `CLAUDE.md` | правка | строка нового endpoint в REST API |
| `ui/src/pages/dashboardStatus.ts` | создать | чистые функции: `buildDecisions`, `buildFeed`, `runningSwarms` + типы |
| `ui/src/pages/__tests__/dashboardStatus.test.ts` | создать | unit-тесты помощников |
| `ui/src/pages/actions.ts` | правка | `runTaskNow(id)` |
| `ui/src/pages/Dashboard.tsx` | переписать | страница: шапка, чипы, решения, лента |
| `ui/src/pages/Dashboard.test.tsx` | создать | компонентные тесты страницы |
| `ui/src/styles/base.css` | правка | `.stats-grid` → `.dashboard-grid` в мобильном блоке |

---

### Task 1: Go — отдать `last_status`/`last_error` в `/api/tasks`

Store уже хранит и сканирует эти поля (`internal/store/tasks.go:70-71`), но `taskToAPI` (`internal/web/api.go:629`) их не отдаёт. Карточке «Сбой» они нужны.

**Files:**
- Create: `internal/web/tasks_api_test.go`
- Modify: `internal/web/api.go:629-650` (`taskToAPI`)

- [ ] **Step 1: Написать падающий тест**

Создать `internal/web/tasks_api_test.go` (helper `newTestStoreForWeb` уже существует — им пользуется `chat_test.go`):

```go
package web

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/mtzanidakis/praktor/internal/store"
)

// seedWebTask сохраняет минимальное активное дежурство для тестов web-слоя.
func seedWebTask(t *testing.T, st *store.Store, id string) {
	t.Helper()
	next := time.Now().Add(24 * time.Hour)
	task := &store.ScheduledTask{
		ID:          id,
		AgentID:     "coder",
		Name:        "Утренняя сводка",
		Schedule:    `{"kind":"cron","cron_expr":"0 9 * * *"}`,
		Prompt:      "собери сводку",
		ContextMode: "isolated",
		Status:      "active",
		NextRunAt:   &next,
	}
	if err := st.SaveTask(task); err != nil {
		t.Fatal(err)
	}
}

func TestListTasksExposesFailureInfo(t *testing.T) {
	st := newTestStoreForWeb(t)
	seedWebTask(t, st, "t1")
	if err := st.UpdateTaskRun("t1", "error", "AgentMail API: 401 Unauthorized", nil); err != nil {
		t.Fatal(err)
	}

	s := &Server{store: st}
	rec := httptest.NewRecorder()
	s.listTasks(rec, httptest.NewRequest(http.MethodGet, "/api/tasks", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d (%s)", rec.Code, rec.Body)
	}
	var out []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if len(out) != 1 {
		t.Fatalf("len = %d, want 1", len(out))
	}
	if out[0]["last_status"] != "error" {
		t.Errorf("last_status = %v, want error", out[0]["last_status"])
	}
	if out[0]["last_error"] != "AgentMail API: 401 Unauthorized" {
		t.Errorf("last_error = %v", out[0]["last_error"])
	}
}

func TestListTasksOmitsEmptyFailureInfo(t *testing.T) {
	st := newTestStoreForWeb(t)
	seedWebTask(t, st, "t1")

	s := &Server{store: st}
	rec := httptest.NewRecorder()
	s.listTasks(rec, httptest.NewRequest(http.MethodGet, "/api/tasks", nil))

	var out []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if _, ok := out[0]["last_status"]; ok {
		t.Error("пустой last_status не должен попадать в JSON")
	}
	if _, ok := out[0]["last_error"]; ok {
		t.Error("пустой last_error не должен попадать в JSON")
	}
}
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `& "C:\Program Files\Go\bin\go.exe" test ./internal/web/ -run TestListTasks -v` (env `CGO_ENABLED=0`)
Expected: FAIL — `last_status = <nil>, want error`

- [ ] **Step 3: Минимальная реализация**

В `internal/web/api.go`, в `taskToAPI`, после блока `if t.NextRunAt != nil { ... }` (строка ~648) добавить:

```go
	if t.LastStatus != "" {
		m["last_status"] = t.LastStatus
	}
	if t.LastError != "" {
		m["last_error"] = t.LastError
	}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `& "C:\Program Files\Go\bin\go.exe" test ./internal/web/ -run TestListTasks -v`
Expected: PASS (оба)

- [ ] **Step 5: Commit**

```bash
git add internal/web/api.go internal/web/tasks_api_test.go
git commit -m "feat(api): expose last_status/last_error in /api/tasks"
```

---

### Task 2: Go — `POST /api/tasks/{id}/run` («Повторить сейчас»)

Handler ставит `next_run_at = now` и `status = active` (снимает паузу/завершённость); выполнение подхватывает планировщик на ближайшем цикле опроса. Для one-shot задач после запуска `CalculateNextRun` вернёт nil и планировщик снова пометит её completed — корректно.

**Files:**
- Modify: `internal/web/api.go` (маршрут после строки 51 `PUT /api/tasks/{id}`; handler рядом с `updateTask`, после строки 408)
- Modify: `internal/web/tasks_api_test.go` (дописать тесты)
- Modify: `CLAUDE.md` (REST API список)

- [ ] **Step 1: Написать падающие тесты**

Дописать в `internal/web/tasks_api_test.go`:

```go
func TestRunTaskNow(t *testing.T) {
	st := newTestStoreForWeb(t)
	seedWebTask(t, st, "t1")
	if err := st.UpdateTaskStatus("t1", "paused"); err != nil {
		t.Fatal(err)
	}

	s := &Server{store: st}
	req := httptest.NewRequest(http.MethodPost, "/api/tasks/t1/run", nil)
	req.SetPathValue("id", "t1")
	rec := httptest.NewRecorder()
	s.runTaskNow(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d (%s)", rec.Code, rec.Body)
	}
	got, err := st.GetTask("t1")
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != "active" {
		t.Errorf("status = %q, want active (пауза должна сниматься)", got.Status)
	}
	if got.NextRunAt == nil || got.NextRunAt.After(time.Now().Add(time.Second)) {
		t.Errorf("next_run_at = %v, want ~сейчас", got.NextRunAt)
	}
}

func TestRunTaskNowNotFound(t *testing.T) {
	st := newTestStoreForWeb(t)
	s := &Server{store: st}
	req := httptest.NewRequest(http.MethodPost, "/api/tasks/ghost/run", nil)
	req.SetPathValue("id", "ghost")
	rec := httptest.NewRecorder()
	s.runTaskNow(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("code = %d, want 404", rec.Code)
	}
}
```

- [ ] **Step 2: Убедиться, что не компилируется/падает**

Run: `& "C:\Program Files\Go\bin\go.exe" test ./internal/web/ -run TestRunTaskNow -v`
Expected: build FAIL — `s.runTaskNow undefined`

- [ ] **Step 3: Реализация**

В `internal/web/api.go` после строки 51 (`mux.HandleFunc("PUT /api/tasks/{id}", s.updateTask)`) добавить маршрут:

```go
	mux.HandleFunc("POST /api/tasks/{id}/run", s.runTaskNow)
```

После `updateTask` (после строки ~408) добавить handler:

```go
// runTaskNow ставит дежурство на немедленный запуск: next_run_at = сейчас,
// паузу/завершённость снимает. Выполнение подхватит планировщик на ближайшем
// цикле опроса; после запуска расписание пересчитывается как обычно.
func (s *Server) runTaskNow(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	existing, err := s.store.GetTask(id)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if existing == nil {
		jsonError(w, "task not found", http.StatusNotFound)
		return
	}
	now := time.Now().UTC()
	existing.Status = "active"
	existing.NextRunAt = &now
	if err := s.store.SaveTask(existing); err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, taskToAPI(*existing, s.agentNameMap()))
}
```

- [ ] **Step 4: Убедиться, что тесты проходят + весь Go-suite**

Run: `& "C:\Program Files\Go\bin\go.exe" test ./internal/...` (env `CGO_ENABLED=0`)
Expected: PASS везде

- [ ] **Step 5: Обновить CLAUDE.md**

В разделе `## REST API`, после строки `PUT/DELETE     /api/tasks/{id}                       # Update/delete task` добавить:

```
POST           /api/tasks/{id}/run                   # Run a scheduled task immediately (clears pause)
```

- [ ] **Step 6: Commit**

```bash
git add internal/web/api.go internal/web/tasks_api_test.go CLAUDE.md
git commit -m "feat(api): POST /api/tasks/{id}/run to trigger a task immediately"
```

---

### Task 3: UI — помощники `dashboardStatus.ts` (чистые функции + тесты)

**Files:**
- Create: `ui/src/pages/dashboardStatus.ts`
- Create: `ui/src/pages/__tests__/dashboardStatus.test.ts`

- [ ] **Step 1: Написать падающие тесты**

Создать `ui/src/pages/__tests__/dashboardStatus.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
  buildDecisions, buildFeed, runningSwarms,
  type RecentMessage, type TaskItem,
} from '../dashboardStatus';
import type { IntakeItem } from '../intakeStatus';
import type { ProjectStatus } from '../projectStatus';
import type { WsEvent } from '../../hooks/useWebSocket';

const intakeItem = (over: Partial<IntakeItem>): IntakeItem => ({
  id: 'i1', source: 'web', raw_text: 'Задача', status: 'awaiting-approval',
  created_at: '2026-07-04T22:40:00Z', updated_at: '2026-07-04T22:40:00Z', ...over,
});

const project = (over: Partial<ProjectStatus>): ProjectStatus => ({
  name: 'praktor', repo: 'Meta-Psy/praktor', ci: { conclusion: 'success' }, deploy: { ok: true }, ...over,
});

const task = (over: Partial<TaskItem>): TaskItem => ({
  id: 't1', name: 'Сводка', status: 'active', ...over,
});

const ev = (type: string, data: unknown, over: Partial<WsEvent> = {}): WsEvent => ({
  type, data, timestamp: '2026-07-05T08:00:00Z', ...over,
});

describe('buildDecisions', () => {
  test('план: только awaiting-approval, заголовок и выдержка из raw_text', () => {
    const out = buildDecisions(
      [
        intakeItem({ id: 'a', raw_text: 'Скрейпер v2\nмигрируем на Playwright', target_project: 'mentis' }),
        intakeItem({ id: 'b', status: 'in_progress' }),
      ],
      [], [],
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: 'plan', id: 'a', title: 'Скрейпер v2',
      project: 'mentis', created: '2026-07-04', excerpt: 'мигрируем на Playwright',
    });
  });

  test('PR: draft пропускается, ci — проектный лейбл', () => {
    const out = buildDecisions([], [project({
      prs: [
        { number: 14, title: 'feat: x', url: 'https://g/14', draft: false },
        { number: 15, title: 'wip', url: 'https://g/15', draft: true },
      ],
    })], []);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'pr', number: 14, repo: 'Meta-Psy/praktor', ci: '✓ passing' });
  });

  test('audit-issue даёт карточку', () => {
    const out = buildDecisions([], [project({
      audit_issues: [{ number: 7, title: 'self-improve', url: 'https://g/7' }],
    })], []);
    expect(out).toEqual([expect.objectContaining({ kind: 'audit', number: 7 })]);
  });

  test('сбой: только last_status === error', () => {
    const out = buildDecisions([], [], [
      task({ id: 'bad', last_status: 'error', last_error: '401', agent_name: 'mail', last_run: '08:00' }),
      task({ id: 'good', last_status: 'success' }),
      task({ id: 'never' }),
    ]);
    expect(out).toEqual([expect.objectContaining({
      kind: 'failure', taskId: 'bad', error: '401', agent: 'mail', lastRun: '08:00',
    })]);
  });

  test('порядок: планы → PR → аудит → сбои; ключи уникальны', () => {
    const out = buildDecisions(
      [intakeItem({})],
      [project({
        prs: [{ number: 1, title: 'a', url: 'u', draft: false }],
        audit_issues: [{ number: 2, title: 'b', url: 'u' }],
      })],
      [task({ last_status: 'error' })],
    );
    expect(out.map((c) => c.kind)).toEqual(['plan', 'pr', 'audit', 'failure']);
    expect(new Set(out.map((c) => c.key)).size).toBe(4);
  });
});

describe('buildFeed', () => {
  const seed: RecentMessage[] = [
    { id: '2', agent: 'dev', role: 'assistant', text: 'готово', time: '07:10' },  // новее
    { id: '1', agent: 'mail', role: 'user', text: 'привет', time: '07:00' },
  ];

  test('seed: только ответы агентов, новые сверху', () => {
    const out = buildFeed(seed, [], {});
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ key: 'msg-2', text: 'dev ответил', time: '07:10' });
  });

  test('WS message дедуплицируется с seed по id', () => {
    const out = buildFeed(seed, [
      ev('message', { id: '2', role: 'assistant', text: 'готово', time: '07:10' }, { agent_id: 'dev' }),
    ], { dev: 'dev' });
    expect(out.filter((i) => i.key === 'msg-2')).toHaveLength(1);
  });

  test('маппинг типов: task_executed, agent_started, swarm_failed; неизвестный тип пропускается', () => {
    const out = buildFeed([], [
      ev('task_executed', { id: 't1', name: 'Сводка', status: 'error' }),
      ev('agent_started', {}, { agent_id: 'dev' }),
      ev('swarm_failed', { error: 'boom' }),
      ev('unknown_event', {}),
    ], { dev: 'Разработчик' });
    expect(out.map((i) => i.text)).toEqual([
      'отряд: сбой',
      'Разработчик запущен',
      'дежурство «Сводка»: сбой',
    ]);
  });

  test('message с role=user в ленту не попадает', () => {
    const out = buildFeed([], [ev('message', { id: '9', role: 'user', text: 'q', time: '10:00' })], {});
    expect(out).toHaveLength(0);
  });

  test('лента ограничена 30 элементами, новые сверху', () => {
    const events = Array.from({ length: 40 }, (_, i) =>
      ev('message', { id: String(i), role: 'assistant', text: 'x', time: '10:00' }, { agent_id: 'dev' }));
    const out = buildFeed([], events, {});
    expect(out).toHaveLength(30);
    expect(out[0].key).toBe('msg-39');
  });
});

test('runningSwarms считает только running', () => {
  expect(runningSwarms([
    { id: 'a', status: 'running' },
    { id: 'b', status: 'completed' },
    { id: 'c', status: 'running' },
  ])).toBe(2);
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `cd ui && npx vitest run src/pages/__tests__/dashboardStatus.test.ts`
Expected: FAIL — модуль `../dashboardStatus` не существует

- [ ] **Step 3: Реализация**

Создать `ui/src/pages/dashboardStatus.ts`:

```ts
import type { IntakeItem } from './intakeStatus';
import { ciLabel, type ProjectStatus } from './projectStatus';
import type { WsEvent } from '../hooks/useWebSocket';

export interface RecentMessage {
  id: string;
  agent: string;
  role: string;
  text: string;
  time: string;
}

export interface StatusData {
  status?: string;
  version?: string;
  active_agents?: number;
  agents_count?: number;
  pending_tasks?: number;
  recent_messages?: RecentMessage[];
}

export interface TaskItem {
  id: string;
  name: string;
  agent_id?: string;
  agent_name?: string;
  status: string;
  last_run?: string;
  last_status?: string;
  last_error?: string;
}

export interface SwarmRunItem {
  id: string;
  name?: string;
  status: string;
}

export type DecisionCard =
  | { kind: 'plan'; key: string; id: string; title: string; project: string; created: string; excerpt: string }
  | { kind: 'pr'; key: string; project: string; repo: string; number: number; title: string; url: string; ci: string }
  | { kind: 'audit'; key: string; project: string; repo: string; number: number; title: string; url: string }
  | { kind: 'failure'; key: string; taskId: string; name: string; agent: string; lastRun: string; error: string };

export interface FeedItem {
  key: string;
  time: string;
  icon: string;
  text: string;
}

const FEED_LIMIT = 30;

export function runningSwarms(swarms: SwarmRunItem[]): number {
  return swarms.filter((s) => s.status === 'running').length;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// buildDecisions собирает карточки «Требует решения» из уже опрошенных источников.
// Порядок: планы на подпись → PR → audit-issues → сбои дежурств.
export function buildDecisions(
  intake: IntakeItem[],
  projects: ProjectStatus[],
  tasks: TaskItem[],
): DecisionCard[] {
  const out: DecisionCard[] = [];
  for (const it of intake) {
    if (it.status !== 'awaiting-approval') continue;
    const lines = it.raw_text.split('\n');
    out.push({
      kind: 'plan',
      key: `plan-${it.id}`,
      id: it.id,
      title: lines[0] || 'Без названия',
      project: it.target_project || '—',
      created: it.created_at.slice(0, 10),
      excerpt: truncate(lines.slice(1).join(' ').trim(), 140),
    });
  }
  for (const p of projects) {
    for (const pr of p.prs ?? []) {
      if (pr.draft) continue;
      out.push({
        kind: 'pr',
        key: `pr-${p.name}-${pr.number}`,
        project: p.name,
        repo: p.repo,
        number: pr.number,
        title: pr.title,
        url: pr.url,
        ci: ciLabel(p.ci),
      });
    }
    for (const iss of p.audit_issues ?? []) {
      out.push({
        kind: 'audit',
        key: `audit-${p.name}-${iss.number}`,
        project: p.name,
        repo: p.repo,
        number: iss.number,
        title: iss.title,
        url: iss.url,
      });
    }
  }
  for (const t of tasks) {
    if (t.last_status !== 'error') continue;
    out.push({
      kind: 'failure',
      key: `fail-${t.id}`,
      taskId: t.id,
      name: t.name,
      agent: t.agent_name || t.agent_id || '—',
      lastRun: t.last_run || '',
      error: t.last_error || '',
    });
  }
  return out;
}

function fmtTime(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function eventToFeedItem(e: WsEvent, agentNames: Record<string, string>): FeedItem | null {
  const data = (e.data ?? {}) as Record<string, unknown>;
  const agent = agentNames[e.agent_id ?? ''] || e.agent_id || 'агент';
  switch (e.type) {
    case 'message': {
      if (data.role !== 'assistant') return null;
      const time = typeof data.time === 'string' && data.time ? data.time : fmtTime(e.timestamp);
      return { key: `msg-${String(data.id)}`, time, icon: '💬', text: `${agent} ответил` };
    }
    case 'agent_started':
      return { key: `as-${e.agent_id}-${e.timestamp}`, time: fmtTime(e.timestamp), icon: '▶', text: `${agent} запущен` };
    case 'agent_stopped':
      return { key: `ap-${e.agent_id}-${e.timestamp}`, time: fmtTime(e.timestamp), icon: '⏹', text: `${agent} остановлен` };
    case 'task_executed': {
      const ok = data.status === 'success';
      return {
        key: `te-${String(data.id)}-${e.timestamp}`,
        time: fmtTime(e.timestamp),
        icon: '⏰',
        text: `дежурство «${String(data.name ?? '')}»: ${ok ? 'успех' : 'сбой'}`,
      };
    }
    case 'swarm_started': {
      const nm = typeof data.name === 'string' && data.name ? `«${data.name}» ` : '';
      return { key: `sws-${e.timestamp}`, time: fmtTime(e.timestamp), icon: '🐝', text: `отряд ${nm}запущен` };
    }
    case 'swarm_agent_completed':
      return {
        key: `swa-${String(data.role)}-${e.timestamp}`,
        time: fmtTime(e.timestamp),
        icon: '🐝',
        text: `отряд: ${String(data.role ?? 'агент')} завершил (${data.status === 'error' ? 'сбой' : 'успех'})`,
      };
    case 'swarm_completed':
      return { key: `swc-${e.timestamp}`, time: fmtTime(e.timestamp), icon: '🐝', text: 'отряд завершён' };
    case 'swarm_failed':
      return { key: `swf-${e.timestamp}`, time: fmtTime(e.timestamp), icon: '🐝', text: 'отряд: сбой' };
    default:
      return null;
  }
}

// buildFeed строит ленту «Активность»: seed из /api/status (история из БД,
// новыми вперёд) + живые WS-события (в порядке поступления). Новые сверху,
// дубликаты сообщений (seed ∩ WS) схлопываются по key, максимум FEED_LIMIT.
export function buildFeed(
  seed: RecentMessage[],
  events: WsEvent[],
  agentNames: Record<string, string>,
): FeedItem[] {
  const items: FeedItem[] = [];
  // seed разворачиваем в хронологию, чтобы после общего разворота новые были сверху
  for (const m of [...seed].reverse()) {
    if (m.role !== 'assistant') continue;
    items.push({ key: `msg-${m.id}`, time: m.time, icon: '💬', text: `${m.agent} ответил` });
  }
  for (const e of events) {
    const it = eventToFeedItem(e, agentNames);
    if (it) items.push(it);
  }
  const seen = new Set<string>();
  const out: FeedItem[] = [];
  for (let i = items.length - 1; i >= 0 && out.length < FEED_LIMIT; i--) {
    if (seen.has(items[i].key)) continue;
    seen.add(items[i].key);
    out.push(items[i]);
  }
  return out;
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `cd ui && npx vitest run src/pages/__tests__/dashboardStatus.test.ts`
Expected: PASS (все)

- [ ] **Step 5: Commit**

```bash
git add ui/src/pages/dashboardStatus.ts ui/src/pages/__tests__/dashboardStatus.test.ts
git commit -m "feat(ui): dashboard helpers - decisions aggregation and activity feed"
```

---

### Task 4: UI — действие `runTaskNow` в actions.ts

**Files:**
- Modify: `ui/src/pages/actions.ts`

- [ ] **Step 1: Добавить функцию**

В конец `ui/src/pages/actions.ts`:

```ts
export function runTaskNow(id: string): Promise<void> {
  return post(`/api/tasks/${id}/run`);
}
```

- [ ] **Step 2: Проверка типов**

Run: `cd ui && npx tsc --noEmit -p tsconfig.app.json` (если такого tsconfig нет — `npx tsc -b`)
Expected: без ошибок

- [ ] **Step 3: Commit**

```bash
git add ui/src/pages/actions.ts
git commit -m "feat(ui): runTaskNow action for POST /api/tasks/{id}/run"
```

---

### Task 5: UI — переписать Dashboard.tsx

**Files:**
- Modify (полная замена содержимого): `ui/src/pages/Dashboard.tsx`
- Modify: `ui/src/styles/base.css:48` (`.stats-grid` → `.dashboard-grid`)
- Create: `ui/src/pages/Dashboard.test.tsx`

- [ ] **Step 1: Написать компонентные тесты (падающие)**

Создать `ui/src/pages/Dashboard.test.tsx` (паттерн — `Tasks.test.tsx`; MemoryRouter обязателен, страница использует Link/useNavigate):

```tsx
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ToastProvider } from '../components/ui';
import { WebSocketProvider } from '../contexts/WebSocketContext';
import Dashboard from './Dashboard';

class FakeWebSocket {
  static OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: unknown) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close() {}
}

const statusData = {
  status: 'ok', version: 'v1.8', active_agents: 2, agents_count: 3,
  pending_tasks: 4, recent_messages: [],
};
const failedTask = {
  id: 't1', name: 'Утренняя сводка', status: 'active', enabled: true,
  schedule: '', last_status: 'error', last_error: 'AgentMail API: 401',
  last_run: '08:00', agent_name: 'mail',
};
const plan = {
  id: 'p1', source: 'web', raw_text: 'Скрейпер v2\nдетали плана',
  status: 'awaiting-approval', created_at: '2026-07-04T22:40:00Z',
  updated_at: '2026-07-04T22:40:00Z', target_project: 'mentis-vuzy-db',
};
const project = {
  name: 'praktor', repo: 'Meta-Psy/praktor', ci: { conclusion: 'success' },
  deploy: { ok: true, code: 200 },
  prs: [{ number: 14, title: 'feat: сводки', url: 'https://github.com/x/14', draft: false }],
};

let fetchMock: ReturnType<typeof vi.fn>;

function stubFetch(over: Record<string, unknown> = {}) {
  const routes: Record<string, unknown> = {
    '/api/status': statusData,
    '/api/tasks': [failedTask],
    '/api/projects': [project],
    '/api/intake': { items: [plan] },
    '/api/swarms': [],
    '/api/agents/definitions': [],
    ...over,
  };
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return Promise.resolve(new Response('{}'));
    const body = url in routes ? routes[url] : {};
    return Promise.resolve(new Response(JSON.stringify(body)));
  });
  vi.stubGlobal('fetch', fetchMock);
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  stubFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <WebSocketProvider>
        <ToastProvider>
          <Dashboard />
        </ToastProvider>
      </WebSocketProvider>
    </MemoryRouter>
  );
}

test('рендерит чипы и карточки всех типов', async () => {
  renderPage();
  expect(await screen.findByText('Скрейпер v2')).toBeTruthy();          // план
  expect(screen.getByText('#14 feat: сводки')).toBeTruthy();            // PR
  expect(screen.getByText(/Утренняя сводка/)).toBeTruthy();             // сбой
  expect(screen.getByText(/Агенты в работе/)).toBeTruthy();             // чип
});

test('«Подписать» шлёт approve только после подтверждения', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Подписать' }));

  const posts = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'POST');
  expect(posts()).toHaveLength(0); // диалог открыт, POST ещё не ушёл

  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Подписать' }));
  await waitFor(() => {
    expect(posts().map(([u]) => u)).toContain('/api/intake/p1/approve');
  });
});

test('«Повторить сейчас» шлёт POST /api/tasks/{id}/run', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Повторить сейчас' }));
  await waitFor(() => {
    const posts = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'POST');
    expect(posts.map(([u]) => u)).toContain('/api/tasks/t1/run');
  });
});

test('пусто → «Всё разобрано ✓»', async () => {
  stubFetch({ '/api/tasks': [], '/api/projects': [], '/api/intake': { items: [] } });
  renderPage();
  expect(await screen.findByText('Всё разобрано ✓')).toBeTruthy();
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `cd ui && npx vitest run src/pages/Dashboard.test.tsx`
Expected: FAIL (старый Dashboard не содержит этих элементов)

- [ ] **Step 3: Переписать Dashboard.tsx**

Полностью заменить содержимое `ui/src/pages/Dashboard.tsx`:

```tsx
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useWebSocket } from '../hooks/useWebSocket';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, PageHeader, Skeleton, Textarea, useToast,
} from '../components/ui';
import { approve, approvePlan, mergePR, rejectPlan, runTaskNow } from './actions';
import {
  buildDecisions, buildFeed, runningSwarms,
  type DecisionCard, type StatusData, type SwarmRunItem, type TaskItem,
} from './dashboardStatus';
import type { IntakeItem, IntakeList } from './intakeStatus';
import type { ProjectStatus } from './projectStatus';

type Pending =
  | { kind: 'plan-approve'; id: string; title: string }
  | { kind: 'plan-reject'; id: string; title: string }
  | { kind: 'pr-merge'; project: string; repo: string; number: number }
  | { kind: 'audit-approve'; project: string; repo: string; number: number; tier: 'trivial' | 'all' };

const chipStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: 999, padding: '4px 14px', fontSize: 13.5, color: 'var(--text-secondary)',
};

const colTitleStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
  fontSize: 12, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.07em', color: 'var(--text-tertiary)',
};

const metaStyle: React.CSSProperties = { fontSize: 13, color: 'var(--text-tertiary)', marginTop: 4 };

function DecisionCardView({ card, onAct, onRetry }: {
  card: DecisionCard;
  onAct: (p: Pending) => void;
  onRetry: (taskId: string) => void;
}) {
  const navigate = useNavigate();

  if (card.kind === 'plan') {
    return (
      <Card style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Badge tone="accent">План</Badge>
          <Link to="/intake?tab=plans" style={{ fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none' }}>
            {card.title}
          </Link>
        </div>
        <div style={metaStyle}>{card.project} · поставлен {card.created}</div>
        {card.excerpt && (
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6, borderLeft: '2px solid var(--border)', paddingLeft: 9, fontStyle: 'italic' }}>
            {card.excerpt}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <Button size="sm" onClick={() => onAct({ kind: 'plan-approve', id: card.id, title: card.title })}>Подписать</Button>
          <Button size="sm" variant="secondary" onClick={() => navigate('/intake?tab=plans')}>Читать план</Button>
          <Button size="sm" variant="danger" onClick={() => onAct({ kind: 'plan-reject', id: card.id, title: card.title })}>Отклонить</Button>
        </div>
      </Card>
    );
  }

  if (card.kind === 'pr') {
    return (
      <Card style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Badge tone="ok">PR</Badge>
          <a href={card.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none' }}>
            #{card.number} {card.title}
          </a>
        </div>
        <div style={metaStyle}>{card.repo} · CI: {card.ci}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <Button size="sm" onClick={() => onAct({ kind: 'pr-merge', project: card.project, repo: card.repo, number: card.number })}>Merge</Button>
          <Button size="sm" variant="secondary" onClick={() => window.open(card.url, '_blank', 'noopener')}>На GitHub</Button>
        </div>
      </Card>
    );
  }

  if (card.kind === 'audit') {
    return (
      <Card style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Badge tone="warn">Аудит</Badge>
          <a href={card.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none' }}>
            #{card.number} {card.title}
          </a>
        </div>
        <div style={metaStyle}>{card.repo}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <Button size="sm" variant="secondary" onClick={() => onAct({ kind: 'audit-approve', project: card.project, repo: card.repo, number: card.number, tier: 'trivial' })}>
            Approve trivial
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onAct({ kind: 'audit-approve', project: card.project, repo: card.repo, number: card.number, tier: 'all' })}>
            Approve all
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Badge tone="danger">Сбой</Badge>
        <Link to="/tasks" style={{ fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none' }}>
          Дежурство «{card.name}» упало
        </Link>
      </div>
      <div style={metaStyle}>
        {card.lastRun && <>последний запуск {card.lastRun} · </>}агент {card.agent}
      </div>
      {card.error && (
        <div style={{ fontSize: 13, color: 'var(--red-light)', marginTop: 6, borderLeft: '2px solid var(--red-muted)', paddingLeft: 9 }}>
          {card.error}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <Button size="sm" variant="secondary" onClick={() => onRetry(card.taskId)}>Повторить сейчас</Button>
        <Button size="sm" variant="secondary" onClick={() => navigate('/tasks')}>К дежурствам</Button>
      </div>
    </Card>
  );
}

function Dashboard() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [tasks, setTasks] = useState<TaskItem[] | null>(null);
  const [projects, setProjects] = useState<ProjectStatus[] | null>(null);
  const [intake, setIntake] = useState<IntakeItem[] | null>(null);
  const [swarms, setSwarms] = useState<SwarmRunItem[] | null>(null);
  const [agentNames, setAgentNames] = useState<Record<string, string>>({});
  const [failedSources, setFailedSources] = useState<string[]>([]);

  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { events } = useWebSocket();

  // Перекрывающиеся циклы опроса (интервал + WS-дебаунс): применяем только
  // результат последнего запущенного, иначе устаревший ответ затрёт свежий
  const epochRef = useRef(0);

  const fetchAll = useCallback(async () => {
    const epoch = ++epochRef.current;
    const get = async (url: string): Promise<unknown> => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    };
    const [st, ts, pr, ik, sw, ag] = await Promise.allSettled([
      get('/api/status'), get('/api/tasks'), get('/api/projects'),
      get('/api/intake'), get('/api/swarms'), get('/api/agents/definitions'),
    ]);
    if (epoch !== epochRef.current) return;
    const failed: string[] = [];
    if (st.status === 'fulfilled') setStatus(st.value as StatusData); else failed.push('статус');
    if (ts.status === 'fulfilled') setTasks(Array.isArray(ts.value) ? ts.value as TaskItem[] : []); else failed.push('дежурства');
    if (pr.status === 'fulfilled') setProjects(Array.isArray(pr.value) ? pr.value as ProjectStatus[] : []); else failed.push('операции');
    if (ik.status === 'fulfilled') setIntake((ik.value as IntakeList).items || []); else failed.push('приёмная');
    if (sw.status === 'fulfilled') setSwarms(Array.isArray(sw.value) ? sw.value as SwarmRunItem[] : []); else failed.push('отряды');
    if (ag.status === 'fulfilled') {
      const defs = ag.value as { id: string; name?: string }[];
      setAgentNames(Object.fromEntries((Array.isArray(defs) ? defs : []).map((a) => [a.id, a.name || a.id])));
    }
    setFailedSources(failed);
  }, []);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 30000);
    return () => clearInterval(id);
  }, [fetchAll]);

  // Дозапрос по WS-событиям. Зависимость — сам массив events (ссылка меняется
  // на каждом сообщении); events.length сломается после переполнения буфера 500
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (events.length === 0) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchAll, 500);
    return () => clearTimeout(debounceRef.current);
  }, [events, fetchAll]);

  const decisions = useMemo(
    () => (tasks === null || projects === null || intake === null)
      ? null
      : buildDecisions(intake, projects, tasks),
    [intake, projects, tasks],
  );

  const feed = useMemo(
    () => buildFeed(status?.recent_messages ?? [], events, agentNames),
    [status, events, agentNames],
  );

  const confirmAction = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.kind === 'plan-approve') await approvePlan(pending.id);
      else if (pending.kind === 'plan-reject') await rejectPlan(pending.id, reason);
      else if (pending.kind === 'pr-merge') await mergePR(pending.project, pending.number);
      else await approve(pending.project, pending.tier, pending.number);
      setPending(null);
      setReason('');
      fetchAll();
    } catch (e) {
      toast.error(`Не удалось выполнить: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [pending, reason, fetchAll, toast]);

  const retryTask = useCallback(async (taskId: string) => {
    try {
      await runTaskNow(taskId);
      toast.success('Дежурство поставлено на запуск');
      fetchAll();
    } catch (e) {
      toast.error(`Не удалось запустить: ${(e as Error).message}`);
    }
  }, [fetchAll, toast]);

  const healthy = failedSources.length === 0 && status?.status === 'ok';
  const dateStr = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

  const confirmTitle =
    pending?.kind === 'plan-approve' ? 'Подписать план?' :
    pending?.kind === 'plan-reject' ? 'Отклонить план?' :
    pending?.kind === 'pr-merge' ? 'Merge PR?' : 'Approve audit-issue?';
  const confirmLabel =
    pending?.kind === 'plan-approve' ? 'Подписать' :
    pending?.kind === 'plan-reject' ? 'Отклонить' :
    pending?.kind === 'pr-merge' ? 'Merge' : 'Approve';
  const confirmMessage =
    pending?.kind === 'plan-approve' ? `«${pending.title}» — локальный CC начнёт исполнение.` :
    pending?.kind === 'plan-reject' ? (
      <Textarea
        placeholder="Причина (что переделать)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
    ) :
    pending?.kind === 'pr-merge' ? `${pending.repo}#${pending.number}` :
    pending ? `${pending.repo}#${pending.number} · tier: ${pending.tier}` : '';

  return (
    <div>
      <PageHeader
        title="Обстановка"
        subtitle={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {dateStr}
            {status?.version && <> · {status.version}</>}
            <span style={{ color: healthy ? 'var(--green)' : 'var(--red)' }}>
              ● {healthy ? 'все системы в норме' : 'есть проблемы'}
            </span>
          </span>
        }
      />

      {failedSources.length > 0 && (
        <Card style={{ color: 'var(--red)', marginBottom: 16 }}>
          Не удалось загрузить: {failedSources.join(', ')}
        </Card>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
        <span style={chipStyle}>
          <span style={{ color: (status?.active_agents ?? 0) > 0 ? 'var(--green)' : 'var(--text-muted)' }}>●</span>
          Агенты в работе: <b style={{ color: 'var(--text-primary)' }}>{status?.active_agents ?? 0}</b>
        </span>
        <span style={chipStyle}>
          Активные дежурства: <b style={{ color: 'var(--text-primary)' }}>{status?.pending_tasks ?? 0}</b>
        </span>
        <span style={chipStyle}>
          Отряды в работе: <b style={{ color: 'var(--text-primary)' }}>{runningSwarms(swarms ?? [])}</b>
        </span>
      </div>

      <div className="dashboard-grid" style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16, alignItems: 'start' }}>
        <section>
          <div style={colTitleStyle}>
            Требует решения
            {decisions !== null && decisions.length > 0 && (
              <span style={{ background: 'var(--accent)', color: '#fff', borderRadius: 999, fontSize: 11, fontWeight: 700, padding: '1px 8px' }}>
                {decisions.length}
              </span>
            )}
          </div>
          {decisions === null && <Skeleton lines={4} />}
          {decisions !== null && decisions.length === 0 && (
            <EmptyState
              title="Всё разобрано ✓"
              hint="Планы на подпись, PR к merge и сбои дежурств появятся здесь."
            />
          )}
          {(decisions ?? []).map((card) => (
            <DecisionCardView key={card.key} card={card} onAct={setPending} onRetry={retryTask} />
          ))}
        </section>

        <section>
          <div style={colTitleStyle}>Активность</div>
          <Card>
            {status === null && <Skeleton lines={4} />}
            {status !== null && feed.length === 0 && (
              <div style={{ color: 'var(--text-tertiary)', fontSize: 14, textAlign: 'center', padding: '12px 0' }}>
                Лента живая: события придут по WebSocket без обновления страницы
              </div>
            )}
            {feed.map((f) => (
              <div key={f.key} style={{ display: 'flex', gap: 10, padding: '7px 2px', borderBottom: '1px solid var(--border-subtle)', fontSize: 13.5 }}>
                <span style={{ color: 'var(--text-muted)', minWidth: 40, textAlign: 'right', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                  {f.time}
                </span>
                <span aria-hidden="true">{f.icon}</span>
                <span style={{ color: 'var(--text-secondary)' }}>{f.text}</span>
              </div>
            ))}
          </Card>
        </section>
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={confirmTitle}
        message={confirmMessage}
        confirmLabel={confirmLabel}
        danger={pending?.kind === 'plan-reject'}
        busy={busy}
        onConfirm={confirmAction}
        onCancel={() => { setPending(null); setReason(''); }}
      />
    </div>
  );
}

export default Dashboard;
```

- [ ] **Step 4: base.css — мобильная сетка**

В `ui/src/styles/base.css`, в блоке `@media (max-width: 768px)` заменить строку:

```css
  .stats-grid { grid-template-columns: 1fr !important; }
```

на:

```css
  .dashboard-grid { grid-template-columns: 1fr !important; }
```

(класс `stats-grid` использовал только старый Dashboard; легаси hover-правила выше по файлу НЕ трогать — ими ещё живёт Login, удаление в этапе 6).

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `cd ui && npx vitest run src/pages/Dashboard.test.tsx src/pages/__tests__/dashboardStatus.test.ts`
Expected: PASS (все)

- [ ] **Step 6: Commit**

```bash
git add ui/src/pages/Dashboard.tsx ui/src/pages/Dashboard.test.tsx ui/src/styles/base.css
git commit -m "feat(ui): Dashboard becomes decision center - chips, decision cards, live activity feed"
```

---

### Task 6: Полная верификация

- [ ] **Step 1: Полный UI-suite + сборка**

Run: `cd ui && npm test -- --run && npm run build`
Expected: все тесты PASS, сборка без ошибок. (Suite изредка флачит пулом воркеров vitest — при странном падении перепрогнать.)

- [ ] **Step 2: Полный Go-suite + линт**

Run: `& "C:\Program Files\Go\bin\go.exe" test ./internal/...` (env `CGO_ENABLED=0`), затем `make lint` (если golangci-lint доступен; на Windows-машине может отсутствовать — тогда зафиксировать это в отчёте, НЕ заявлять «линт пройден»)
Expected: PASS

- [ ] **Step 3: Ручная проверка в браузере**

Запустить gateway с конфигом, открыть Штаб: десктопная ширина (две колонки, чипы в строку) и мобильная ≤768px (одна колонка). Проверить: карточка плана открывает диалог; «Повторить сейчас» показывает toast; лента пополняется при активности агента. Если полного окружения нет — прогнать `npm run dev` с моками невозможно, тогда зафиксировать, что ручная проверка отложена до ревью Alex.

- [ ] **Step 4: Итоговый коммит-статус**

`git log --oneline origin/main..HEAD` — ожидаемо 5 коммитов (Task 1, 2, 3, 4, 5). Push и PR — только по явной команде контролёра.

---

## Самопроверка плана (выполнена при написании)

- §4 спеки: шапка (дата/версия/здоровье/чипы) — Task 5; «Требует решения» (план/PR+audit/сбой, действия по месту, клик по заголовку, «Всё разобрано ✓») — Task 3+5; «Активность» по WS — Task 3+5; данные из существующих API — Task 1–2 только расширяют `/api/tasks` (поля + действие «Повторить сейчас», явно требуемое §4).
- §9 спеки: vitest-помощники (`dashboardStatus.test.ts`), компонентные тесты страницы, Go-тесты новых полей/endpoint, ручная верификация — Task 6.
- Типы согласованы: `DecisionCard.kind` ('plan'|'pr'|'audit'|'failure') одинаков в Task 3 и Task 5; `runTaskNow` (Task 4) используется в Task 5; `last_status`/`last_error` (Task 1) читаются `buildDecisions` (Task 3).
