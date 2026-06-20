# S4 — каталог возможностей (Phase F) — Design

**Дата:** 2026-06-20
**Ветка:** `feature/s4-capability-catalog` (форк `Meta-Psy/praktor`, от `origin/main` = `5377352`)
**Статус:** дизайн утверждён Alex'ом 2026-06-20

## Цель

Дать Alex'у read-only поверхность в Mission Control — **каталог возможностей**: что умеет каждый агент (встроенные MCP-возможности + добавленные расширения + ограничения `allowed_tools`) **и** сводку его self-learning/памяти (сколько записей, когда обновлялась, есть ли профиль). Одно место «что агент умеет и что он уже знает».

## Контекст (что уже есть)

- `AgentExtensions` (`internal/extensions/types.go`) — **добавленные пользователем** MCP-серверы/marketplaces/plugins/skills, редактируются в `ui/src/components/AgentExtensions.tsx` и через `/api/agents/definitions/{id}/extensions`. Хранятся в нормализованных таблицах `agent_mcp_servers/marketplaces/plugins/skills`.
- **Встроенные** MCP-серверы у каждого агента (`agent-runner/src/index.ts`): `praktor-tasks/profile/memory/file/history`, условно `praktor-nix` (при `nix_enabled`), `praktor-swarm` (только в swarm-прогоне). Плюс WebSearch/WebFetch и agent-browser. **Нигде в сводный каталог не собраны.**
- `AgentDefinition` (`internal/config/config.go`): `allowed_tools`, `nix_enabled`, `agentmail_inbox_id`, model/image/claude_md.
- Память: per-agent SQLite `/workspace/agent/memory.db` **внутри тома контейнера** (`praktor-wk-{workspace}`) — хост напрямую не читает; агенты по умолчанию остановлены по `idle_timeout`.
- IPC: агент шлёт `IPCCommand{Type, Payload}` на `host.ipc.{agentID}`, `Orchestrator.handleIPC` диспетчит по типу (`internal/agent/orchestrator.go`). Уже есть прецедент репортинга состояния агентом — `extension_status`.

**Зазор, который закрывает S4:** единого read-only обзора «что доступно каждому агенту + состояние его памяти» нет.

## Решения (locked на brainstorm 2026-06-20)

- **D1 — ядро:** показывать **и** инвентарь возможностей, **и** сводку памяти (равнозначно).
- **D2 — глубина памяти:** только **сводка** (`count` + `last_updated`). Не список ключей, не содержимое. → нулевой PII-риск (важно: медданные в памяти). Профиль пользователя (`USER.md`) — **глобальный** (один на всех агентов, хранится хост-стороной в `registry`), не per-agent: показывается один раз сверху как `user_profile_present`, читается хост-стороной без участия агента.
- **D3 — подход:** **каталог в шлюзе + снимок памяти через IPC** (Подход 1). Инвентарь — целиком хост-сторона; память — агент репортит сводку по IPC, хост персистит.
- **D4 — транспорт:** всё внутри шлюза. Внешний репо (как `portfolio-data` в S1) **не нужен** — прямой API шлюза.
- **D5 — UX:** новая страница Catalog, обзор + drill-down (как S1 Portfolio), per-agent ось (N≤5 агентов). Чистый read-only — правки остаются в `AgentExtensions.tsx`.
- **D6 — ось:** per-agent карточки (малое N), не матрица capability×agent.

## Архитектура

```
                    ┌─ статический реестр встроенных (internal/capabilities) ─┐
GET /api/agents/    ├─ БД расширений (agent_mcp_servers/plugins/skills) ──────┤→ per-agent
   capabilities  ───┤─ AgentDefinition: allowed_tools, nix_enabled, ──────────┤  AgentCapabilities
   (за session-auth)│  agentmail_inbox_id, model                              │
                    └─ снимок памяти (новая таблица agent_memory_stats) ───────┘

Снимок памяти ← NATS IPC `memory_summary` ← agent-runner (на старте + после memory_store/forget)
```

Инвентарь не требует запущенного агента (читается из конфига + БД). Снимок памяти eventually-consistent: для спящего агента показывается last-known + `reported_at`.

### Компоненты (каждый — один смысл, тестируется изолированно)

1. **Реестр встроенных** — `internal/capabilities/registry.go`. Чистые данные, без рантайма.
   ```go
   type Capability struct {
       Key, Label, Group string  // group: memory|tasks|profile|web|browser|nix|email|files|history
       Tools       []string      // напр. memory_store/recall/list/delete/forget
       Builtin     bool
       Conditional string         // "" | "nix_enabled" | "agentmail_inbox_id"
   }
   var Builtins = []Capability{ ... } // tasks, profile, memory, file, history, web, browser, nix, email
   ```

2. **Сборщик** — `internal/web/capabilities.go`. Детерминированная функция `(definition, extensions, memStats) → AgentCapabilities`.
   ```go
   type AgentCapabilities struct {
       AgentID, Description, Model string
       Builtin      []Capability       // реестр × флаги агента (условные отфильтрованы)
       Extensions   ExtensionsSummary  // counts + имена из БД (MCP/skills/plugins)
       AllowedTools []string           // из AgentDefinition; пусто = без ограничений
       Restricted   bool               // len(AllowedTools) > 0
       Memory       *MemoryStats       // {Count, LastUpdated, ReportedAt} из agent_memory_stats; nil = ещё не репортилось
   }
   ```
   Ответ эндпоинта — обёртка `{user_profile_present: bool, agents: []AgentCapabilities}` (профиль глобальный, читается хост-стороной из `registry.GetUserMD()`).

3. **Хранилище снимка** — `internal/store`, новая таблица + CRUD.
   ```sql
   CREATE TABLE IF NOT EXISTS agent_memory_stats (
     agent_id      TEXT PRIMARY KEY,
     mem_count     INTEGER NOT NULL DEFAULT 0,
     last_updated  TEXT,              -- RFC3339, последняя запись памяти (от агента)
     reported_at   TEXT NOT NULL      -- когда хост принял снимок (time.Now().UTC())
   );
   ```
   `UpsertMemoryStats(agentID, count, lastUpdated, reportedAt)` + чтение.

4. **Память-пайплайн:**
   - **Агент** (`agent-runner/src/mcp-memory.ts` + `ipc.ts`): `reportMemorySummary()` считает `COUNT(*)` и `MAX(updated_at)` из `memory.db` (колонка `updated_at` — unix-epoch секунды); вызывается на старте (рядом с backfill эмбеддингов) и после `memory_store`/`memory_forget`; шлёт `sendIPC("memory_summary", {count, last_updated})` (`last_updated` — RFC3339, конвертируется из epoch на стороне агента).
   - **Хост** (`internal/agent/orchestrator.go`): `case "memory_summary": o.ipcMemorySummary(...)` → парсит payload, `store.UpsertMemoryStats(...)` с `reported_at = time.Now().UTC()` (единый источник времени — не доверяем часам контейнера), отвечает `{ok:true}`.

5. **API** — `GET /api/agents/capabilities` (маршрут в `internal/web/api.go`): `{user_profile_present, agents:[]AgentCapabilities}`, за session-auth, read-only.

6. **React** — `ui/src/pages/Catalog.tsx` + `ui/src/pages/catalogStatus.ts` (чистые хелперы) + nav-иконка в `App.tsx`:
   - **Глобально (сверху):** «Профиль пользователя: задан / не задан» (из `user_profile_present`).
   - **Обзор:** карточка на агента — имя, модель, чипы групп возможностей (`memory · tasks · web · browser · nix?`), бейдж «restricted» при заданном `allowed_tools`, строка памяти («47 записей · 2 дня назад» / «нет данных»).
   - **Drill-down** (раскрытие): встроенные возможности с tools, расширения по именам (MCP/skills/plugins), полный `allowed_tools`, детали памяти (счёт + последняя запись + снимок от).

## Поток данных

1. MC грузит страницу Catalog → `GET /api/agents/capabilities`.
2. Сборщик по каждому агенту: реестр встроенных × флаги (`nix_enabled`, `agentmail_inbox_id`) + сводка расширений из БД + `allowed_tools` + снимок памяти из `agent_memory_stats` (или `nil`).
3. React рендерит обзор + drill-down.
4. Снимок памяти обновляется асинхронно: агент при следующем запуске/записи памяти шлёт `memory_summary` → хост upsert'ит → следующий запрос каталога видит свежее.

## Обработка ошибок

- Агент не запускался / память не репортилась → `Memory: nil` → UI «нет данных» (не ошибка).
- `allowed_tools` пуст → `Restricted: false`, показываем полный набор.
- Расширений нет → пустые counts, drill-down показывает «нет расширений».
- Ошибка БД при сборке → 500 с сообщением (как прочие хендлеры); страница показывает ошибку.

## Тестирование

- `internal/capabilities/` — условные возможности фильтруются по флагам (`nix_enabled=false` → нет nix; пустой `agentmail_inbox_id` → нет email).
- `internal/web/capabilities_test.go` — сборщик детерминирован; кейсы: restricted, `memStats=nil` → `Memory:nil`, extensions присутствуют/пусты.
- `internal/store/` — `UpsertMemoryStats` пишет/перезаписывает по `agent_id`; чтение возвращает снимок.
- `internal/agent/` — `ipcMemorySummary` парсит payload + зовёт upsert (фейк-стор).
- `ui/.../catalogStatus.test.ts` — форматирование memory-сводки + группировка чипов.
- Go-проверки через Docker `golang:1.26rc1` (правило проекта); gofmt по git-блобам; UI — vitest + `npm run build` (чанк `Catalog-*.js`).

## Не-цели (YAGNI)

- ❌ Редактирование из каталога (правки — в `AgentExtensions.tsx` на странице Agents).
- ❌ Просмотр **содержимого** памяти (только сводка — D2; нулевой PII-риск).
- ❌ Live-опрос запущенных агентов для инвентаря (всё хост-сторона).
- ❌ Swarm как per-agent возможность (она per-run, не свойство определения).
- ❌ История/тренды памяти (только текущий снимок).

## Развёртывание

Новых секретов/env/репозиториев НЕТ — всё внутри шлюза. Затрагивает образ агента (новый код в `agent-runner` бандлится esbuild'ом — без новой entry, правка существующего `mcp-memory.ts`/`ipc.ts`) и образ оркестратора.

**[ALEX]-гейты:** merge PR форка → передеплой `~/praktor/redeploy.sh` (pull→build→up→verify; пересобирает и оркестратор, и образ агента) → phone-verify `mc.alexmetapsy.com`:
- Страница Catalog в nav → карточки агентов с встроенными возможностями + расширениями + `allowed_tools`.
- После первого запуска/записи памяти агентом — строка памяти показывает счёт+дату.

После зелёного → **S4 ЗАКРЫТ** (roadmap doing→done), выбор S5/S6.

## Связь с другими подсистемами

- Сосуществует с `AgentExtensions.tsx` (S4 — read-only сводка, тот — редактор). Источник расширений общий (БД).
- Не зависит от S1/S2/S3; чистое дополнение к MC-поверхности.
