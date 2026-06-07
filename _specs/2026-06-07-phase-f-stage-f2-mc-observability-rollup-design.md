# Phase F.2 — Mission Control cross-project observability roll-up — Design

- **Date:** 2026-06-07
- **Phase:** F (autonomous CC stack scale-out), 2nd sub-project (after F.1 gnathology onboarding).
- **Repo:** `Meta-Psy/praktor` (self-maintained fork). Branch `feature/f2-mc-rollup`.
- **Status:** design approved by Alex 2026-06-07. Next: writing-plans.
- **Source of truth for phase status:** memory `project_claude_optimization`.

## Goal

Один phone-доступный authed экран, показывающий статус ВСЕХ проектов в автономном стеке сразу (сейчас: pdai + gnathology). **Read-only observability** — управление (approve/merge/deploy) сознательно отложено в отдельный под-проект (меньший blast-radius, откладывает auth-сложность, проверяет «болит ли агрегация» до добавления рычагов).

North-star: bot (есть) → **расширенный MC (этот под-проект)** → кастомный лендинг только когда агрегация станет болью.

## Reality-check (свериться, не из памяти)

Текущий MC :8080 — НЕ read-only. Это зрелая React-SPA (`ui/`) + Go API (`internal/web/api.go`, `server.go`) с разделами Dashboard/Agents/Scheduled Tasks/Secrets/Swarms; полноценный read+**write** control plane одного Praktor (start/stop агентов, CRUD задач, vault, swarm, live-WS). «Read-only» в старой памяти относилось к Telegram-боту, не к web-MC. Чего НЕТ: понятия «проект», агрегации GitHub-состояния, approve-из-UI, внешнего доступа (сейчас SSH-forward).

## Architecture decision

**Подход №1 — расширить форк Praktor** (выбран Alex'ом из 3: extend-fork / отдельный-агрегатор / статическая-страница). Обоснование: phone-доступ всё равно требует authed-хостимой поверхности, а MC ею уже является → переиспользуем готовые auth/сессии/хостинг/WS; единая поверхность = North-star; read-only view аддитивен (низкий риск форк-конфликта); та же поверхность под будущие approve-кнопки.

## Components

### 1. Project model (декларативно в конфиге)
Новая секция `projects:` в `praktor.yaml` (hot-reload, как остальной конфиг). Парсится в `config.Config.Projects map[string]ProjectDefinition`:
```yaml
projects:
  pdai:
    repo: Meta-Psy/pdai_calculator
    agents: [coder, notifier, deploy-verifier]
    deploy_url: https://skinlabpro.uz          # HTTP 200 health
  gnathology:
    repo: Meta-Psy/gnathology-bot
    agents: [gnatho-coder]
    health: http://gnathology-bot:8099/health  # внутр. praktor-net
```
`ProjectDefinition{ Repo string; Agents []string; DeployURL string; Health string }`. Проекты явные, не авто-выводятся — контролируемо.

### 2. Aggregator (`/api/projects`, Go — новый файл `internal/web/projects.go`)
Per project собрать `ProjectStatus`:
- **GitHub** (read-PAT): открытые PR (count + [{number,title,url,draft}]), audit-issues (label `audit-report`, count+links), последний CI-run на дефолт-ветке (status/conclusion).
- **Deploy/liveness:** GET `deploy_url` или `health` → ok/ms/code.
- **Agents:** из оркестратора/стора — для каждого agent id: running? last activity ts.
- Токен GitHub: выделенный **read-only PAT** (read на оба репо). Источник для Go-сервера — порядок предпочтения: (a) env `GITHUB_READ_TOKEN` из серверного `.env` (просто, гарантированно работает — Task 1 проверит); (b) vault global-секрет `dashboard-read-token`, если у `*vault.Vault` есть доступный серверу метод чтения global (свериться по коду на Task 1; grep `vault.Get` пуст — не подтверждено). Решение зафиксировать на Task 1 фактом из кода, не из памяти. НЕ agent-env. Кэш ответа агрегатора 30-60с (rate-limit GitHub + дешёвый refresh).
- Эндпоинт `GET /api/projects` (под существующий auth-middleware). Параллельный сбор по проектам, частичная деградация (один источник упал → поле помечается error, не валит всю выдачу — НЕ silent: явный `error` в payload).

### 3. UI — read-only страница Projects (`ui/src/pages/Projects.tsx` + nav)
Новый раздел навигации. Карточка на проект: имя + деплой-индикатор; строки PR / CI / audit / агенты (точка живости). Клик по PR/issue → ссылка на GitHub. Автообновление через существующий WS или polling /api/projects. Только чтение — никаких action-кнопок (управление = следующий под-проект).

### 4. Access — Cloudflare Tunnel
MC :8080 наружу через cloudflared на own_landing (**исходящий** туннель → нет inbound-порта, ufw default-deny цел). Сабдомен `mc.<домен>` (домен выбрать: использовать существующий CF-управляемый). Auth = существующий MC basic/session (`PRAKTOR_WEB_PASSWORD`); опц. слой CF Access. **Стейджинг:** сперва собрать+проверить view через SSH-forward, CF Tunnel — последней стадией.

### 5. Fork-divergence management
Менять upstream-файлы минимально; новое — в НОВЫЕ файлы (`internal/web/projects.go`, `ui/src/pages/Projects.tsx`, отдельный блок `ProjectDefinition` в config.go + регистрация одного маршрута + один nav-пункт). Документировать дельту. Это первый «настоящий feature-форк» → актуализирует open-question **upstream-vs-self-maintain** (решать отдельно, не блокирует; вариант — предложить PR в upstream).

## Risks / carried findings (durable)

- **stale-container/секреты:** не применимо к серверу напрямую (это не агент), но `dashboard-read-token` в vault как global — проверить, что Go-сервер читает global-секрет (а не только agent-scoped); сверить API vault при реализации.
- **GitHub rate-limit:** без токена ~60 req/h, с токеном 5000/h. Кэш обязателен. pdai public (читается и без токена), gnathology private (нужен токен) → токен нужен.
- **Exposure:** CF Tunnel = новый внешний вход в MC (раньше только SSH-forward). Auth обязателен; рассмотреть CF Access как 2-й слой. Это сознательное расширение blast-radius — но read-only (контроль отложен).
- **Fork divergence:** см. §5.

## Verification (gate)

- Go unit: агрегатор с mock GitHub-ответами → корректный `ProjectStatus` (table-driven); парс секции `projects:`; частичная деградация (источник-error не валит выдачу).
- React: render `Projects` с mock-данными (карточки pdai+gnathology).
- **Живой гейт:** через SSH-forward `/api/projects` и страница верно показывают pdai+gnathology (реальные PR/CI/audit/деплой/агенты) → затем тот же экран открывается **с телефона по CF-Tunnel URL** под auth.

## Plan decomposition (стадии, один spec)

1. **Конфиг + агрегатор + эндпоинт** (`ProjectDefinition`, `dashboard-read-token` в vault [ALEX заводит], `internal/web/projects.go`, `/api/projects`, unit-тесты). Гейт: curl `/api/projects` через SSH-forward = верный JSON.
2. **React Projects view** (страница + nav + рендер). Гейт: экран корректен через SSH-forward.
3. **CF Tunnel exposure** (cloudflared на own_landing, сабдомен, auth). Гейт: экран с телефона по URL.

## Out of scope (отдельные под-проекты Phase F)

Approve/merge/deploy из UI (управление), многоагентность, инфра-апгрейд VPS, форк upstream-vs-self решение. Этот под-проект — только read-only наблюдаемость.
