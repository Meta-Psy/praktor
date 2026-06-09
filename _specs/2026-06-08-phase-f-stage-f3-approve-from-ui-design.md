# Phase F · Stage F.3 — approve-из-UI (управляющие действия в Mission Control)

**Дата:** 2026-06-08
**Репозиторий:** `Meta-Psy/praktor` (форк)
**Ветка:** `feature/f3-approve-from-ui`
**Статус:** дизайн одобрен Alex 2026-06-08
**Предшественники:** F.1 (онбординг gnathology), F.2 (MC observability roll-up — read-only агрегация `GET /api/projects`)

## Цель

Вынести управляющие действия автономного стека в Mission Control, чтобы вести цикл
auditor→implementers→approve→merge→deploy **с телефона** (через CF Tunnel
`mc.alexmetapsy.com`), не открывая GitHub. F.2 дал наблюдаемость; F.3 даёт действия.

Это первый под-проект Phase F, расширяющий **blast-radius** от наблюдения к
управлению (merge в публичные репо + прод-деплой), поэтому safety-слой — часть дизайна.

## Решения (зафиксированы при brainstorming)

| Вопрос | Решение |
|---|---|
| Scope действий | **approve + merge + deploy** (полный цикл) |
| Слой защиты | **один пароль** `PRAKTOR_WEB_PASSWORD` + модалка-подтверждение + TG-аудит |
| Путь исполнения | **гибрид**: GitHub-действия → Go→GitHub API; gnathology-deploy → host-docker |
| Семантика deploy | pdai = `workflow_dispatch`; gnathology = host-docker `pull+rebuild` (вариант A сейчас, Path C — будущий под-проект) |

### Обоснование «один пароль»

Пароль MC **уже** гейтит CRUD vault-секретов и запуск агентов с write-PAT — тот,
у кого пароль, уже владеет стеком. merge/deploy не пробивают новую границу доверия,
они внутри существующей. CSRF не страшен: session-cookie `SameSite=Strict`, Basic-auth
требует явного заголовка; CORS `*` не передаёт credentials кросс-сайт.

Реально новое — merge/deploy **необратимее** vault-операций. Поэтому два дешёвых,
**не добавляющих второй фактор** дополнения:
- **Модалка-подтверждение** — показывает точный текст действия перед исполнением.
- **TG-аудит** — строка в Telegram после каждого действия (detect при утечке пароля,
  раз решили без второго prevent-фактора).

## Архитектура

```
телефон → CF Tunnel → MC (:8080, пароль)
            │
            ▼
     internal/web/actions.go  (3 хендлера, за общим auth-middleware)
            │
   ┌────────┴─────────┐
   ▼                  ▼
github_write.go    host_deploy.go
(comment/merge/    (helper-контейнер
 dispatch,          gnathology через
 GITHUB_WRITE_TOKEN docker-сокет хоста)
 из env)
            │
            ▼
     audit_tg.go → Telegram (sendMessage, token+main_chat_id из конфига)
```

### Действия → механика

| Действие | Механизм | Источник истины |
|---|---|---|
| **approve** | `POST` коммент `/approve trivial\|all` на audit-issue | существующий `approve-handler.yml` (логику не дублируем) |
| **merge** | `PUT /repos/{owner}/{repo}/pulls/{n}/merge` | GitHub API |
| **deploy pdai** | `POST /repos/.../actions/workflows/{deploy}/dispatches` (ref=main) | GitHub Actions |
| **deploy gnathology** | one-shot helper-контейнер: `git pull --ff-only` + `docker compose up -d --build` в `/opt/apps/gnathology-bot/deploy/` | host docker (сокет уже смонтирован в praktor) |

### Компоненты

Новый код — в **новые файлы** (минимизируем дивергенцию форка от upstream):

| Файл | Назначение | Зависит от |
|---|---|---|
| `internal/web/github_write.go` | write-клиент GitHub: `AddComment`, `MergePR`, `DispatchWorkflow`. Токен из `GITHUB_WRITE_TOKEN` (отдельный от read-PAT F.2 — least-privilege для read-путей). | `net/http`, env |
| `internal/web/host_deploy.go` | спавн helper-контейнера для gnathology pull+rebuild | `internal/container` |
| `internal/web/actions.go` | 3 хендлера: `POST /api/projects/{key}/approve`, `.../pulls/{n}/merge`, `.../deploy`. Каждый: валидация → исполнение → TG-аудит → JSON. | github_write, host_deploy, audit_tg |
| `internal/web/audit_tg.go` | прямой `sendMessage` ботом (token+main_chat_id из конфига) | telegram bot token |
| `internal/web/projects.go` (расширить) | агрегатор добавляет открытые `audit-report` issues + счётчики манифеста (TRIVIAL/STANDARD/COMPLEX) для UI approve | github read-клиент F.2 |
| `ui/src/pages/Projects.tsx` (расширить) | кнопки действий + модалка подтверждения; контекстная видимость | api-клиент |

### Поток UI

Кнопки контекстны:
- **approve** — виден только при открытом `audit-report` issue (с разбитым манифестом).
- **merge** — на каждом открытом PR.
- **deploy** — всегда, per-project.

Каждое нажатие → модалка с точным текстом → подтверждение → запрос → результат в UI + TG.
Кнопка disabled пока запрос in-flight (защита от двойного клика).

### Эндпоинты (новые, за существующим auth-middleware)

```
POST /api/projects/{key}/approve        body {tier:"trivial"|"all", issue:N}
POST /api/projects/{key}/pulls/{n}/merge
POST /api/projects/{key}/deploy
```

## Ошибки

- Каждый хендлер — явный success/failure JSON; ошибка пробрасывается **и в UI, и в TG**.
- merge-конфликт (GitHub 405/409), отсутствие workflow (404), build-фейл gnathology
  (exit-код helper-контейнера + хвост логов) — превращаются в читаемое сообщение.
- Partial-degradation агрегатора (F.2) сохраняется для read-части.

## Тестирование

- **Go (TDD):** write-клиент через `httptest`-мок GitHub API (форма запроса + auth-заголовок),
  по образцу `github_test.go`; audit-helper с моком TG; host-deploy — тест конструкции
  команды и guard-логики (не реальный docker).
- **React:** модалка подтверждения + состояния кнопок (idle/in-flight/error), мок fetch.

## [ALEX]-гейты (прод/секреты — классификатор блокирует, выполняет Alex)

1. Создать `GITHUB_WRITE_TOKEN` (fine-grained PAT, оба репо: `contents` + `pull_requests`
   + `issues` + `actions` : write) → серверный `.env`.
2. Один раз превратить `/opt/apps/gnathology-bot/deploy/` в git-рабочую копию
   (private repo по токену; `.env` + `data/` сохранить и gitignore) — иначе `git pull`
   некуда писать.
3. Пересобрать образ `praktor:f2` с кодом F.3 + `docker restart praktor`.
4. Живые тесты с телефона: approve / merge / deploy (pdai + gnathology).

## Вне scope (YAGNI / будущее)

- Миграция gnathology на Path C (вариант B унификации deploy) — отдельный под-проект.
- CF Access (2-й замок поверх Basic-auth) — ждёт починки сломанного Zero Trust онбординга.
- Rollback-кнопка, история деплоев, diff-просмотр PR в UI — позже по мере боли.

## Открытые вопросы (не блокируют, уточнить при writing-plans)

1. **TG-аудит wiring:** есть ли у `web.Server` доступ к bot-token + `main_chat_id`?
   Если нет — +1 проводок через конфиг.
2. **gnathology helper-контейнер** — самый рисковый кусок F.3; уточнить точную команду
   и образ helper'а (alpine + git + docker-cli vs переиспользовать базовый образ агента).
3. **Какой именно deploy-workflow** дёргать у pdai для `workflow_dispatch` (имя файла).

## Жёсткие правила процесса (в силе, из project_claude_optimization)

1. Каждая фаза/под-проект — явный апрув Alex до старта следующего.
2. Правки `~/.claude/*` — через diff (здесь не затрагиваются — весь код в форке Praktor).
3. Под-проект заканчивается записью в памяти о результате и хвостах.
4. Проблема внутри → стоп → обсуждение → продолжение.
