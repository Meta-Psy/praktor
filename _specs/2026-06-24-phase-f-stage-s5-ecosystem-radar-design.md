# S5 — радар экосистемы Claude (Phase F) — Design

**Дата:** 2026-06-24
**Ветка:** `feature/s5-ecosystem-radar` (форк `Meta-Psy/praktor`, от `origin/main` = `342776b`)
**Статус:** дизайн утверждён Alex'ом 2026-06-24

## Цель

Дать Alex'у **read-only ленту осведомлённости** в Mission Control: периодический скан GitHub на новый/трендовый Claude-тулинг (MCP-серверы, skills, plugins, Claude Code расширения) → подача в MC, опционально краткий LLM-дайджест в Telegram. «Быть в курсе экосистемы», читаешь — решаешь сам.

## Контекст (что уже есть)

- `internal/scheduler` — Go-горутина с ticker по `poll_interval`, диспетчит задачи через `orch.HandleMessage(ctx, agentID, prompt, meta)`; `meta["chat_id"]=main_chat_id` → ответ агента уходит в Telegram. **Паттерн периодического хост-джоба + TG-доставки.**
- `internal/web/github.go` `GitHubClient` — `get(ctx, path, out)` дженерик (ставит `Authorization: Bearer <token>`); есть `GetFileContent/ListDir/OpenPRs/AuditIssues/LatestCI`. **Нет** Search-метода.
- `internal/web/portfolio.go` — read-only MC-ридер со stale-tolerant кэшем (паттерн для MC-поверхности S5).
- Read-PAT `GITHUB_READ_TOKEN` (из F.2/S1) — переиспользуется для GitHub-search.
- `config.SchedulerConfig{PollInterval}` — паттерн для нового `RadarConfig`.

## Решения (locked на brainstorm 2026-06-24)

- **D1 — ценность:** осведомлённость (лента), не actionable-install. Read-only.
- **D2 — источник:** GitHub Search API по топикам (`mcp`, `model-context-protocol`, `claude-code`).
- **D3 — исполнение:** гибрид — механическое Go-ядро (детерминированный сбор+store+MC) + опциональный LLM-дайджест.
- **D4 — подход (Подход 1):** Go-сборщик-горутина + MC-страница + LLM-дайджест через агент-задачу→TG (переиспользует orchestrator+scheduler-паттерн+TG-доставку; без нового паттерна шлюз→LLM напрямую).

## Архитектура

Два слабосвязанных компонента в шлюзе:

```
[Сборщик] internal/radar Collector — Go-горутина (ticker, как scheduler)
   каждые radar.poll_interval:
     GitHubClient.SearchRepos(q) ×{mcp, model-context-protocol, claude-code}
       → keepRepo фильтр (min_stars, freshness pushed, !archived, !fork)
       → store.UpsertRadarItem (дедуп по full_name; first_seen НЕ перезаписывается)

[MC] GET /api/radar → read-only страница Radar (паттерн portfolio.go, stale-tolerant кэш)
       items: name, description, stars, topic, html_url, first_seen, last_updated, is_new

[Дайджест] internal/radar Digest — Go-горутина (digest_interval), gated digest_enabled+main_chat_id:
     items с first_seen > last_digest_at → buildDigestPrompt → orch.HandleMessage(defaultAgent,
       prompt, meta{sender:radar, chat_id:main_chat_id}) → сводка в Telegram → SetLastDigestAt
```

**Слабая связь:** Сборщик+MC работают всегда (без LLM, детерминированно). Дайджест аддитивен — `digest_enabled:false` → горутина не стартует, радар = чистая MC-лента. Сбор от дайджеста не зависит.

### Компоненты (каждый — один смысл, тестируется изолированно)

1. **`GitHubClient.SearchRepos`** — `internal/web/github.go`. Зовёт `GET /search/repositories?<query>`, маппит `items[]` → `[]RadarRepo{FullName,Name,Description,HTMLURL,Stars,PushedAt,Archived,Fork}`. Запрос строит caller.

2. **Фильтр** — `internal/radar/filter.go`. Чистая `keepRepo(r RadarRepo, minStars, freshnessDays int, now time.Time) bool`: отбрасывает archived/fork/`<minStars`/пустой-или-устаревший `pushed_at`. Пояс-и-подтяжки поверх серверного `q`.

3. **Сборщик** — `internal/radar/collector.go`. `Collector{gh RepoSearcher, store RadarStore, cfg RadarConfig}`; `Run(ctx)` (ticker), `collectOnce(ctx) error` (по топикам: строит `q=topic:<t>+stars:>=<min>+pushed:>=<date>+archived:false+fork:false&sort=stars&order=desc&per_page=50`, search, filter, upsert). Интерфейсы `RepoSearcher`/`RadarStore` мокаются. `first_seen`/`last_updated` штампует хост.

4. **Store** — `internal/store/radar.go` + миграция. `RadarItem` struct; `UpsertRadarItem` (`ON CONFLICT(full_name) DO UPDATE` обновляет stars/desc/pushed_at/last_updated, НЕ first_seen); `ListRadarItems()` (sort stars desc); `LastDigestAt()/SetLastDigestAt()` (таблица `radar_meta` kv).

5. **MC API** — `internal/web/radar.go` + маршрут. `GET /api/radar` → `{items: []RadarItem}` за session-auth, stale-tolerant кэш (~60с), `is_new` = first_seen в окне `freshness_days`.

6. **Дайджест** — `internal/radar/digest.go`. `buildDigestPrompt(items) string` (чистая); `Digest` горутина (digest_interval), собирает новые-с-last_digest_at, диспетчит через `orch.HandleMessage`, обновляет last_digest_at.

7. **React** — `ui/src/pages/Radar.tsx` + `radarStatus.ts` + nav. Список: имя(ссылка), описание, ⭐, чип топика, «впервые: дата», бейдж new. Read-only. `radarStatus.ts` хелперы (формат звёзд `1.2k`, дата) — vitest.

### Таблицы
```sql
CREATE TABLE IF NOT EXISTS radar_items (
  full_name    TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT,
  html_url     TEXT NOT NULL,
  stars        INTEGER NOT NULL DEFAULT 0,
  topic        TEXT NOT NULL,
  pushed_at    TEXT,
  first_seen   TEXT NOT NULL,
  last_updated TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS radar_meta (
  key   TEXT PRIMARY KEY,   -- "last_digest_at"
  value TEXT NOT NULL
);
```

## Поток данных

1. Сборщик-горутина на тике: по каждому топику `SearchRepos` → `keepRepo` → `UpsertRadarItem`. Новые репо получают `first_seen=now`; повторно виденные обновляют stars/pushed, сохраняют first_seen.
2. MC грузит Radar → `GET /api/radar` → кэш/`ListRadarItems` → рендер, бейдж new по first_seen.
3. (Опц.) Дайджест-горутина на своём интервале: новые-с-last_digest_at items → промпт → дефолт-агент → TG.

## Обработка ошибок

- `SearchRepos` non-200 (вкл. 403 rate-limit) → ошибка; `collectOnce` логирует и пропускает тик (как stale-tolerant ридеры). Прошлые items остаются в store.
- Пустой store (радар не собрал / `enabled:false`) → `GET /api/radar` отдаёт `{items:[]}`; страница «радар пуст/выключен».
- Дайджест: `HandleMessage` ошибка → лог, `last_digest_at` НЕ двигается (повтор на следующем тике).
- `enabled:false` → сборщик-горутина не стартует.

## Конфиг
```yaml
radar:
  enabled: true
  poll_interval: 6h
  min_stars: 10
  freshness_days: 30
  topics: [mcp, model-context-protocol, claude-code]
  digest_enabled: false
  digest_interval: 168h
```
Реюз `GITHUB_READ_TOKEN`. Hot-reload: интервалы обновляемы (как scheduler); `enabled` — старт/стоп горутины.

## Тестирование

- `internal/radar/filter_test.go` — `keepRepo` (archived/fork/min_stars/freshness/валидный).
- `internal/radar/collector_test.go` — `collectOnce` (фейк searcher+store: upsert прошедшего, дедуп, стабильный first_seen).
- `internal/radar/digest_test.go` — `buildDigestPrompt` (содержит имена/звёзды; пустой → no-op).
- `internal/web/github_test.go` — `SearchRepos` против httptest (маппинг GitHub JSON).
- `internal/store/radar_test.go` — Upsert сохраняет first_seen; List сортирует.
- `internal/web/radar_test.go` — хендлер пустой стор → `{items:[]}`; `is_new` окно.
- `ui/.../radarStatus.test.ts` — формат звёзд/даты.
- Go — Docker `golang:1.26rc1`; gofmt по git-блобам; UI vitest + `npm run build` (чанк `Radar-*.js`).

## Не-цели (YAGNI)

- ❌ Не устанавливает найденное (связь с S4 — позже, если захочется).
- ❌ Без оценки качества/безопасности репо (только звёзды+свежесть+!archived).
- ❌ Без полнотекстового индекса/поиска по радару.
- ❌ Без code-search (только repository-search по топикам).
- ❌ Дайджест без тредов/истории; краткая сводка.

## Развёртывание

Новых секретов НЕТ (реюз `GITHUB_READ_TOKEN`); новый `radar:` блок в серверном `praktor.yaml`. Затрагивает только gateway-образ (agent-runner НЕ трогается → `redeploy.sh` достаточно, отдельный agent-build НЕ нужен — durable-отличие от S4).

**[ALEX]-гейты:** merge PR форка → добавить `radar:` блок в `~/praktor` конфиг (или env) → `redeploy.sh` → phone-verify (страница Radar рендерит найденные репо; опц. включить `digest_enabled` и проверить TG-сводку).

После зелёного → **S5 ЗАКРЫТ** (roadmap doing→done), остаётся S6.

## Связь с другими подсистемами

- Независим от S1-S4; чистое дополнение к MC-поверхности.
- Потенциальная будущая связь с S4 (radar → «добавить агенту») — явная не-цель сейчас.
