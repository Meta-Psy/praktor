# S2 — Intake & Triage (design)

*Phase F / North-star управляющая поверхность. Дата: 2026-06-14. Ветка: `feature/s2-intake-triage`.*

## Цель

Захват **задач Claude'у** с устройства (голос / фото / текст) → автоматический триаж в один из 3 маршрутов → передача исполнителю. Захват заметок/материалов — вне области S2 (вторично, отдельный цикл).

Подсистема S2 из рефрейма Phase F (2026-06-11): «intake с устройства → триаж 3 маршрута». Связана с S1 (каталог проектов = источник таргетинга) и S3 (approve-планов-из-UI = приёмник маршрутов 2/3).

## Решения (locked в brainstorming 2026-06-14)

| # | Решение | Выбор |
|---|---------|-------|
| D1 | Что захватываем | **Задачи Claude'у** (приоритет); заметки — позже |
| D2 | Каналы ввода | **Оба сразу**: MC-web + Telegram |
| D3 | Исполнитель MVP | **Локальный CC** за чистым интерфейсом (серверный — апгрейд позже, отдельный под-проект) |
| D4 | Очередь / точка передачи | **Приватный GitHub-репо** `Meta-Psy/intake-queue` (item = JSON-файл) |
| D5 | Таргет проекта | **Гибрид**: LLM-триаж предлагает из каталога roadmap-блоков S1, Alex подтверждает/меняет |
| D6 | Таксономия маршрутов | Переиспользовать **TRIVIAL / STANDARD / COMPLEX** (Auditor Phase E) |
| D7 | TG-развязка | **Отдельный мини-intake-поллер**, НЕ форк `bot.go`; большой бот остаётся off |

## Ключевая находка search-before-build

- `internal/speech` (OpenAI STT/TTS) — переиспользуется как есть для транскрипции голоса обоих каналов.
- `internal/telegram/bot.go` — голос+фото+медиа-группы УЖЕ реализованы upstream, НО бот жёстко связан с `agent.Orchestrator` (тяжёлый контейнерный исполнитель, который мы отложили). Поэтому НЕ зажигаем большой бот, а пишем тонкий поллер, переиспользуя `speech.Client` + паттерн буфера медиа-групп.
- `web.NewServer`, GitHub-клиент F.2 (read) + write-PAT F.3, `portfolio.go` ридер, approve-handler-метки, командный паттерн `~/.claude` (`/self-improve`, `/publish-portfolio`) — всё переиспользуется.

**Принцип:** автономный серверный исполнитель — это отдельное решение (blast-radius + API-ключ + VPS $16→$32), НЕ сворачивать его в S2. S2 = intake + триаж + очередь; исполнитель — сменный backend за интерфейсом очереди.

## Архитектура (юниты)

Каждый юнит — одна ответственность, тестируется отдельно.

### 1. Intake-core (общий на оба канала)
`транскрибировать(если голос) → собрать intake-item → закоммитить в queue-репо`. Без знания о канале и без оркестратора.

**intake-item** (JSON в queue-репо):
```
{
  "id": "<ts>-<rand>",          // стабильный, без Date.now в скрипте — генерит сервер
  "source": "web" | "telegram",
  "raw_text": "<транскрипт/текст>",
  "media": ["<путь к фото в репо>", ...],
  "target_project": "" ,        // заполняет триаж (гибрид)
  "route": "",                  // unset при захвате → trivial|standard|complex
  "status": "queued",           // queued→triaged→in_progress→done | awaiting-approval | needs-design | needs-clarification | error
  "created_at": "<ISO>",
  "updated_at": "<ISO>",
  "history": [ ... ]            // аудит смен статуса
}
```

### 2. Capture-адаптеры (тонкие, над intake-core)
- **MC-web:** React-форма (текст + загрузка фото + запись голоса через `MediaRecorder`) → `POST /api/intake` (multipart). Хендлер вызывает intake-core. Серверный STT для голоса.
- **Telegram:** мини-поллер (`internal/intake/telegram.go` или аналог), владеет TG-токеном через **новый config-кноб** (`cfg.Intake.TelegramToken`, отдельный от `cfg.Telegram.Token`, чтобы большой бот остался off). Принимает voice/photo/text/медиа-группы → intake-core. Переиспользует `speech.Client`.

### 3. Очередь — `Meta-Psy/intake-queue`
Приватный репо. Запись — серверным write-PAT (F.3). Чтение — read-PAT (F.2). Дренаж — локальный CC сейчас, серверный исполнитель позже (оба через GitHub-клиент). Durable, device-agnostic, переживает рестарт/оффлайн.

### 4. Триаж-классификатор (на дренаже, в локальном CC)
LLM-шаг внутри команды `/intake-drain`. Читает item → присваивает:
- **route** по таксономии: TRIVIAL→М-1, STANDARD→М-2, COMPLEX→М-3.
- **target_project** (гибрид): сопоставляет упомянутый проект с каталогом roadmap-блоков S1 (у них есть `mc_key`/repo). Неоднозначно → `needs-clarification` (НЕ угадывать молча).

Без отдельной инфры / без LLM-ключа на сервере сверх STT.

### 5. Роутер → 3 маршрута
- **М-1 (TRIVIAL, полное доверие):** локальный CC спавнит `implementer-trivial` → PR. Статус→done.
- **М-2 (STANDARD):** генерит план → `/approve`-issue (переиспользует approve-handler-метки). Статус→awaiting-approval. *(После постройки S3 — отдаётся в S3-UI.)*
- **М-3 (COMPLEX, «никогда авто»):** HTML-план + кнопка → **стык с S3**. Статус→needs-design. *(До S3 — `needs-design`-issue, ручной brainstorm.)*

### 6. Видимость
- MC-страница **Intake** (`GET /api/intake`, ридер по образцу `portfolio.go` + stale-tolerant cache; React по образцу `Portfolio.tsx`): список items со статусом/маршрутом/таргетом.
- TG-аудит на каждой смене статуса (готовый `send`): «принято», «триаж: М-N → проект», «PR открыт», «ждёт апрува».

## Граница S2/S3

S2 владеет: захват → триаж → очередь → авто-исполнение М-1.
S3 (позже) апгрейдит UX апрува для М-2/М-3. **До S3** маршруты 2/3 падают в существующий `/approve`-issue-флоу — S2 поставляется и работает независимо.

## Поток (сквозной)

1. Захват (web/TG) → STT(если голос) → intake-item → коммит в `intake-queue`.
2. Видимость сразу: MC Intake + TG-аудит «принято».
3. `/intake-drain` (локальный CC): читает очередь → триаж (route + target) → роутит (М-1 спавн implementer / М-2 план→approve-issue / М-3 needs-design).
4. Смена статуса → коммит обратно + TG-аудит.

## Обработка ошибок

- STT-сбой → item `status:error`, виден на MC, не теряется (durable очередь).
- Неоднозначный таргет → `needs-clarification`, не угадывает молча (Core Principle #1).
- Очередь на GitHub → переживает рестарт сервера и оффлайн-машину; ни один item не теряется.
- TG-поллер: один токен = один поллер (большой бот off) → нет конфликта long-polling.

## Тестирование

| Юнит | Тест |
|------|------|
| intake-core | юнит: сборка item, санитизация, генерация id |
| `POST /api/intake` | хендлер-тест (multipart, как F.4) |
| TG-поллер | мок telego, voice/photo/медиа-группа → item |
| `GET /api/intake` ридер | как `portfolio.go` (cache, 503-если-не-сконфигурён) |
| триаж-классификатор | табличные кейсы вход→(route, target) |
| React Intake | vitest по образцу Portfolio |

Go-тесты — Docker `golang:1.26rc1` + `GOTOOLCHAIN=auto` (durable-урок S1).

## [ALEX]-гейты (прод)

1. Приватный репо `Meta-Psy/intake-queue` (seed пустой) + в scope read+write PAT.
2. `INTAKE_QUEUE_REPO=Meta-Psy/intake-queue` env на сервере + проброс в `environment:` оркестратора.
3. OpenAI API-ключ на сервере (`cfg.Speech.APIKey`) для STT — покрывает оба канала.
4. TG-токен для intake-поллера (новый `cfg.Intake.TelegramToken`; большой бот остаётся off).
5. Пересборка образа + recreate через `redeploy.sh`.
6. Апрув diff команды `/intake-drain` в `~/.claude` (правило #2).
7. Phone-verify: задача с телефона (web+TG, голос+фото) → видна на MC Intake → дренаж → PR/issue по маршруту.

## YAGNI / вне области

- Автономный серверный исполнитель (отдельный под-проект, VPS $16→$32).
- Захват заметок/материалов (вторичный режим, позже).
- Polished UI Intake-страницы (функциональная сейчас; полировка — хвост, как у S1).
- Capture-time триаж (MVP триажит на дренаже; перенос на захват — опц. апгрейд).

## Связи

- S1 (`reference`/каталог roadmap-блоков) — источник таргетинга D5.
- S3 (approve-планов-из-UI) — приёмник маршрутов 2/3.
- `feedback_anthropic_max_agent_sdk_tos` — почему серверный исполнитель = отдельное взвешенное решение (API-ключ Commercial, не Max-OAuth).
- `feedback_chrome_mcp_surrogate`, `feedback_vlm_bbox_fractional` — при обработке фото (OCR/vision) на дренаже.
