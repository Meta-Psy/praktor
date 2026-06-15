# S3 — approve-планов-из-UI (design)

*Phase F · подсистема S3 · 2026-06-15*

## Контекст

S3 — третья из шести подсистем North-star управляющей поверхности (рефрейм Phase F 2026-06-11). Замыкает маршрут-3 триажа S2: COMPLEX-задача «никогда не авто-имплементируется», для неё пишется план, и план требует явного одобрения Alex'а **с устройства** до начала работы.

Отношение к соседям:
- **F.3** (approve-из-UI, закрыта) одобряет *audit-issue* комментарием `/approve <tier>` → approve-handler авто-имплементит TRIVIAL/STANDARD. S3 — тот же жест «approve с телефона», но над **планом** COMPLEX-задачи, и **без авто-исполнения** (см. ниже).
- **S2** (intake-триаж, закрыта) уже даёт очередь, статус-машину, web+TG-захват, reader+cache, GitHub read/write клиентов. В `internal/intake/item.go` уже заведены `StatusAwaitingApproval`/`StatusNeedsDesign` и `RouteComplex` «never auto»; `commands/intake-drain.md:25` явно предусматривает «once S3 ships, hand the plan to the S3 UI».

**Главное проектное решение** (locked, brainstorming 2026-06-15): COMPLEX «никогда не авто» + серверный автономный executor отложен (S2 D3) → **Approve = флип статуса**, не запуск исполнения. Approved-план подхватывает **локальный CC** в следующей сессии. Это держит blast-radius минимальным и не тянет за собой отложенный серверный executor + отдельный API-ключ.

## Решения (locked)

| # | Решение | Выбор |
|---|---------|-------|
| D1 | Что триггерит Approve | Флип статуса → локальный CC исполняет (не серверный executor) |
| D2 | Где живёт план | В очереди S2 (`intake-queue`); S3 = фильтр-вид на ту же очередь |
| D3 | Действия UI | Approve + Reject(с причиной); модалка-подтверждение + TG-аудит |
| D4 | Scope MVP | Полный цикл: MC-поверхность + тонкие расширения `/intake-drain` (producer + executor) |
| D5 | Хранение плана | Отдельный файл `items/<id>.plan.md` (не инлайн в JSON) — список очереди лёгкий, markdown по запросу |
| D6 | Рендер плана | React `marked` (md→html) + `dompurify` (санитизация) |
| D7 | Статус approved | Новый `StatusApproved = "approved"` (отделён от `in_progress`) |

## Архитектура

S3 — тонкий слой поверх инфраструктуры S2, не подсистема с нуля.

**Переиспользуем целиком:**
- `internal/intake` — `Item`, статус-машина (`ValidTransition`), `Queue.putFile(ctx,path,content,msg,sha)` (create-or-update; sha set = update→200).
- `internal/web/intake.go` — reader + stale-tolerant cache + `GET /api/intake`.
- `internal/web/github.go` — `GetFileContent` (S1, base64 Contents API, read-PAT).
- `internal/web/github_write.go` — write-клиент (F.3); очередь пишется write-токеном через `Queue`.
- `s.audit(ok, detail)` — TG-аудит на свежем ctx (F.3).
- React: паттерн страницы Intake/Portfolio, модалка-подтверждение F.3.

**Строим новое:**
- статус `approved` + 4 ребра статус-машины;
- 2 поля в `Item` (`plan_file`, `review_note`);
- producer-расширение `/intake-drain` (needs-design → пишет план → awaiting-approval);
- MC handlers: `GET /api/intake/{id}/plan`, `POST /api/intake/{id}/{approve,reject}`;
- React `Plans.tsx` + рендер markdown + nav/route;
- executor-расширение `/intake-drain` (дренит approved → исполняет).

## Модель данных (`internal/intake/item.go`)

```go
StatusApproved = "approved" // одобрено, ждёт локального исполнения

type Item struct {
    // ... существующие поля ...
    PlanFile   string `json:"plan_file,omitempty"`   // "items/<id>.plan.md"
    ReviewNote string `json:"review_note,omitempty"` // причина reject
}
```

Новые рёбра `transitions`:
- `needs-design → awaiting-approval` (producer прикрепил план)
- `awaiting-approval → approved` (approve)
- `awaiting-approval → needs-design` (reject; пишем `review_note`)
- `approved → in_progress` (executor взял в работу)

Существующие рёбра (`triaged→awaiting-approval`, `awaiting-approval→{in_progress,done,error}`, `needs-design→{in_progress,error}`) сохраняются.

План — отдельный файл `items/<id>.plan.md` в том же репо `intake-queue`. Список очереди (`GET /api/intake`) НЕ тянет markdown; он приходит по запросу при открытии конкретного плана.

## Поток данных (петля из 5 шагов)

1. **intake → triage** `complex` → `needs-design`, открыт needs-design issue. *(есть: `/intake-drain`)*
2. **producer** *(новое, расширение `/intake-drain`)*: для `needs-design`-item локальный CC прогоняет brainstorming + writing-plans → пишет `items/<id>.plan.md` в `intake-queue` (`Queue.putFile`) + флип `needs-design → awaiting-approval` + проставляет `plan_file`.
3. **MC read** *(новое)*: `Plans.tsx` фильтрует `awaiting-approval`; по тапу `GET /api/intake/{id}/plan` → рендер markdown.
4. **MC action** *(новое)*: Approve → `awaiting-approval → approved`; Reject(причина) → `awaiting-approval → needs-design` + `review_note`. Оба через модалку, `Queue.putFile(...,sha)`, TG-аудит `✅/❌ MC:`.
5. **executor** *(новое, расширение `/intake-drain`)*: дренит `approved`-items → `approved → in_progress` → subagent-driven-development → `done`/PR (реюз маршрута trivial/standard-исполнения, но для COMPLEX-плана).

## MC-поверхность (Go, `internal/web`)

За существующим auth-middleware (тот же `PRAKTOR_WEB_PASSWORD`, что F.3):

- `GET /api/intake/{id}/plan` — читает `items/<id>.plan.md` через `GetFileContent` (read-PAT), отдаёт markdown (404 если файла нет).
- `POST /api/intake/{id}/approve` — читает item + SHA, `ValidTransition(awaiting-approval, approved)`, флип через `Queue.putFile(...,sha)`, `s.audit(true, "approve "+id)`.
- `POST /api/intake/{id}/reject` — тело `{"reason": "..."}`; флип в `needs-design` + пишет `review_note`, аудит.

Approve/reject — `Queue` write-токеном (как POST /api/intake S2); read item+SHA — через read-клиент (Contents API GET возвращает `sha`).

## Рендер плана (React, `ui/src`)

- Новые депы: `marked` (md→html), `dompurify` (санитизация HTML). План наш, но транзитит репо → санитизируем (defense-in-depth).
- `Plans.tsx`: список `awaiting-approval` (заголовок = raw_text/первая строка, проект, дата) → раскрытие → `GET …/plan` → `DOMPurify.sanitize(marked.parse(md))` в контейнер → кнопки **Approve** / **Reject**.
- Модалка-подтверждение (паттерн F.3); Reject открывает поле причины. После действия — перечитать список.
- `planStatus.ts` — лейблы/хелперы (паттерн `intakeStatus.ts`/`portfolioStatus.ts`).
- nav-пункт + lazy-route в `App.tsx`.

## Обработка ошибок

- Устаревший SHA (item изменился между read и write) → 409; UI перечитывает список.
- Невалидный переход (`ValidTransition` = false) → 409.
- План-файл отсутствует → `GET …/plan` 404; кнопки заблокированы.
- Любой провал → `❌ MC:` в TG на свежем ctx (паттерн F.3: request-ctx мог истечь, аудит на отдельном ctx).
- Concurrency: повторный approve уже approved-item → невалидный переход → 409 (страховка к UI-локу кнопки).

## Тестирование

- **Go-юниты:** новые рёбра `ValidTransition`; approve/reject handlers (валидный переход, невалидный переход → 409, SHA-конфликт → 409, отсутствующий план → 404). Docker `golang:1.26rc1` + кэш-тома `praktor-gomod`/`praktor-gocache` + `MSYS_NO_PATHCONV=1`; gofmt по git-блобам (CRLF-ложняк на Windows).
- **UI-юниты:** `Plans.tsx` фильтр+рендер+модалка; `planStatus.ts`. vitest + tsc + build.
- **Producer/executor** (`/intake-drain`-расширение) — ревью диффом, апрув Alex (правило #2).

## [ALEX]-гейты (прод)

PAT-scope, репо `intake-queue`, env `INTAKE_QUEUE_REPO` — **уже на месте от S2** (читать/писать очередь). Новых секретов нет.

1. merge PR `Meta-Psy/praktor#?` (хард-правило #1 — только Alex);
2. апрув diff расширения `commands/intake-drain.md` в `~/.claude` (правило #2);
3. `~/praktor/redeploy.sh` (pull → build СИНХРОННО → up → verify; образ с S3);
4. phone-verify `mc.alexmetapsy.com`: засеять awaiting-approval item с планом → страница **Plans** рендерит план → **Approve** с телефона → статус `approved` + TG-аудит `✅ MC:`; **Reject** с причиной → статус `needs-design` + `review_note`.

## Известные fast-follow (не MVP-блок)

- Тир-аппрув для COMPLEX (сейчас approve без тиров — COMPLEX всегда «весь план»).
- Capture-time превью плана в TG (сейчас approve только через MC-web).
- Полировка стилей Plans-страницы (как и хвост S1 — визуальный дизайн дашборда отдельным мини-циклом).
- Edit-inline плана в MC (отвергнут для MVP — правки проще в CC-сессии).

## Граница S3 / соседей

- S3 НЕ запускает исполнение на сервере (D1) — это отдельный под-проект (серверный автономный executor).
- S3 наследует очередь S2; планы только из intake-происхождения (D2). Планы «любого происхождения» — вне MVP.
- Маршрут-2 S2 (STANDARD) по-прежнему может идти через F.3 approve-issue ИЛИ через S3 UI — на усмотрение `/intake-drain` при дренаже.
