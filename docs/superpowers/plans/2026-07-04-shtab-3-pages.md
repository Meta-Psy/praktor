# Штаб, этап 3: Миграция страниц на библиотеку компонентов — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Все страницы (кроме Обстановки и Связи) переведены на библиотеку `ui/src/components/ui/*`: единые Card/Button/Badge/Field, ConfirmDialog вместо `confirm()` и самодельных модалок, Skeleton/EmptyState/Toast, русский копирайт. Плюс точечная полировка самой библиотеки по заметкам ревью этапа 1.

**Architecture:** 4 независимых PR с непересекающимися файлами (все ветки от main, мержатся в любом порядке): (A) полировка библиотеки + App.tsx; (B) группа «Работа» — Tasks, Swarms, Intake, Plans; (C) группа «Экосистема» — Projects, Portfolio, Radar, Intel; (D) группа «Система» — Agents, AgentExtensions, Catalog, Secrets, UserProfile. Каждая страница мигрирует целиком, полусостояний нет.

**Tech Stack:** React 19, TypeScript strict, vitest + jsdom + @testing-library/react, библиотека `ui/src/components/ui` (Button, Card, Badge, PageHeader, Field/Input/Textarea/Select, Modal, ConfirmDialog, EmptyState, Spinner/Skeleton, Toast, Tabs — barrel `index.ts`).

**Спека:** `_specs/2026-07-04-shtab-ux-design.md` (§6 паттерны, §8 по-страничные изменения, §10.3). Заметки ревью — в memory `shtab-ux-redesign`.

**Рабочая директория:** worktree `.worktrees/shtab-3` (все команды — из него; git-операции ТОЛЬКО после `cd` в worktree). Тесты/сборка UI — из `ui/`.

---

## Вне объёма (НЕ трогать)

- `ui/src/pages/Dashboard.tsx` — полная переработка в этапе 5.
- `ui/src/pages/Conversations.tsx` — становится чатом в этапе 4.
- `ui/src/components/SwarmGraph.tsx` — тач-редактор в этапе 6. В этом этапе меняется только проп `launchLabel`, передаваемый из Swarms.tsx.
- `ui/src/components/Login.tsx` — вне списка §8.
- Легаси hover-правила в `ui/src/styles/base.css` (`button:hover…`, `[data-hover]…`, `[data-agent-*]…`) — НЕ удалять: ими ещё пользуются Dashboard, Conversations и Login. Удаление — после этапов 4–5 (заметка в memory).
- Алиасы токенов (`--bg-main`, `--bg-primary`…) в tokens.css — остаются по той же причине.
- Поллинг Secrets (5 с) и Projects (30 с / 4 с при деплое) — оставить как есть: изменения приходят не только через WS (CLI, GitHub).
- CSS-класс `form-grid-2col` в base.css — используется формами, остаётся.

## Общие правила миграции (справочник для всех задач)

1. **Импорт компонентов** — только из barrel: `import { Button, Card, ... } from '../components/ui';` (для файлов в `components/` — `'./ui'`).
2. **Карточки**: `<div style={card}>` → `<Card>` (проп `style` — только для отступов типа `marginBottom`). Локальную константу `card` удалить.
3. **Кнопки**: `<button style={btnPrimary}>` → `<Button>`; secondary → `<Button variant="secondary" size="sm">`; опасные → `<Button variant="danger" size="sm">`. Константы `btnPrimary/btnDanger/btnSmall/btn` удалить.
4. **Бейджи**: `badge(color, bg)` / chip-стили → `<Badge tone={...}>`. Тона: running/active/включён → `ok`; completed → `accent`; failed/error → `danger`; pending → `warn`; нейтральное → `neutral`. Функцию `badge` и статические chip-константы удалить.
5. **Формы**: `<label>+<input style={inputStyle}>` → `<Field label="…"><Input …/></Field>`; так же `Textarea`, `Select`. Нативные checkbox остаются нативными (внутри обычного `<label>`).
6. **Подтверждения**: `confirm('…')` и самодельные модалки → `<ConfirmDialog>` + state `confirmTarget`. Кнопка подтверждения опасного действия — `danger`.
7. **Загрузка**: состояние списка — `T[] | null` (null = ещё не загружено) → `<Skeleton lines={4} />`. Надписи "Loading…" удалить.
8. **Пусто**: `<EmptyState title hint action?>` с русской подсказкой «что это и как начать».
9. **Ошибки**: ошибки *действий* (submit/delete/toggle/save) → `useToast().error('Не удалось …: ' + message)`; успешное сохранение → `toast.success('Сохранено')` **только после `res.ok`**. Ошибка *первичной загрузки* — инлайн `<Card style={{ color: 'var(--red)' }}>`.
10. **Заголовок страницы**: `<h1>` → `<PageHeader title subtitle actions>`. У вложенных контентов вкладок (IntakeContent, PlansContent, RadarContent, IntelContent) PageHeader НЕ добавлять — он в Reception/Recon.
11. **Клавиатура**: кликабельные `div`/`span` → `role="button"` + `tabIndex={0}` + `onKeyDown` (Enter/Space → `e.preventDefault()` + действие); toggle-элементы — `aria-pressed`.
12. **Язык**: весь пользовательский текст — русский. Технические термины (cron, MCP, agent id, merge, deploy, CI, audit, PR) не переводим насильно.
13. **Экспорты не ломать**: `parseScheduleForEdit` (Tasks), `swarmToLaunchData` (Swarms), `formatFileSize` (AgentExtensions), `IntakeContent`, `PlansContent`, `RadarContent`, `IntelContent` — на них есть тесты/импорты.
14. **Проверка каждой задачи**: `cd ui && npm run build && npm run test` — build OK, все тесты зелёные.

---

# Часть A — полировка библиотеки (PR 1, ветка `feature/shtab-3-lib`)

### Task A0: Worktree и ветка

- [ ] **Step 1: Создать worktree от свежего main**

```bash
cd C:/Users/Alex/10_Projects/praktor
git worktree add .worktrees/shtab-3 -b feature/shtab-3-lib main
cd .worktrees/shtab-3
cd ui && npm install && cd ..
```

Expected: worktree `.worktrees/shtab-3` на ветке `feature/shtab-3-lib`. Все дальнейшие команды — из `.worktrees/shtab-3` (hard rule Alex: git-операции только после `cd` в worktree).

---

### Task A1: prefers-reduced-motion и :disabled

**Files:**
- Modify: `ui/src/components/ui/Loading.css`
- Modify: `ui/src/components/ui/Field.css`

- [ ] **Step 1: Дописать в конец `ui/src/components/ui/Loading.css`:**

```css
@media (prefers-reduced-motion: reduce) {
  .ui-spinner { animation-duration: 1.6s; }
  .ui-skeleton__line { animation: none; background: var(--bg-elevated); }
}
```

- [ ] **Step 2: Дописать в конец `ui/src/components/ui/Field.css`:**

```css
.ui-input:disabled { opacity: 0.55; cursor: not-allowed; }
```

- [ ] **Step 3: Проверка + commit**

```bash
cd ui && npm run build && npm run test
git add ui/src/components/ui/Loading.css ui/src/components/ui/Field.css
git commit -m "feat(ui): reduced-motion for Skeleton/Spinner, disabled style for inputs"
```

---

### Task A2: Modal — scroll-lock и возврат фокуса

**Files:**
- Modify: `ui/src/components/ui/Modal.tsx`
- Test: `ui/src/components/ui/Modal.test.tsx` (новый)

- [ ] **Step 1: Написать падающий тест `ui/src/components/ui/Modal.test.tsx`**

```tsx
import { render, cleanup } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { Modal } from './Modal';

afterEach(cleanup);

test('открытая модалка блокирует скролл body и возвращает фокус после закрытия', () => {
  const opener = document.createElement('button');
  document.body.appendChild(opener);
  opener.focus();

  const { rerender } = render(
    <Modal open onClose={() => {}} title="Тест"><button>Ок</button></Modal>
  );
  expect(document.body.style.overflow).toBe('hidden');
  expect(document.activeElement?.textContent).toBe('Ок');

  rerender(<Modal open={false} onClose={() => {}} title="Тест"><button>Ок</button></Modal>);
  expect(document.body.style.overflow).toBe('');
  expect(document.activeElement).toBe(opener);

  opener.remove();
});
```

- [ ] **Step 2: Убедиться, что падает**

```bash
cd ui && npx vitest run src/components/ui/Modal.test.tsx
```

Expected: FAIL — `overflow` не 'hidden' / фокус не возвращён.

- [ ] **Step 3: В `ui/src/components/ui/Modal.tsx`** заменить первый `useEffect` (фокус первого элемента) на два эффекта:

```tsx
  // Scroll-lock: пока модалка открыта, body не прокручивается
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; };
  }, [open]);

  // Фокус на первый элемент; при закрытии — возврат туда, откуда открыли
  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    boxRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => { prevFocus?.focus(); };
  }, [open]);
```

Остальное (фокус-ловушка Tab, Escape, разметка) — без изменений.

- [ ] **Step 4: Тесты зелёные + commit**

```bash
cd ui && npx vitest run src/components/ui
git add ui/src/components/ui/Modal.tsx ui/src/components/ui/Modal.test.tsx
git commit -m "feat(ui): Modal scroll-lock and focus restore"
```

---

### Task A3: Toast — TTL ошибок, role=alert, дедупликация

**Files:**
- Modify: `ui/src/components/ui/Toast.tsx`
- Modify: `ui/src/components/ui/Toast.test.tsx`

- [ ] **Step 1: Дописать в `ui/src/components/ui/Toast.test.tsx` два падающих теста** (компонент `Demo` в файле уже есть):

```tsx
test('одинаковые ошибки не дублируются', () => {
  render(
    <ToastProvider>
      <Demo />
    </ToastProvider>
  );
  fireEvent.click(screen.getByText('fire'));
  fireEvent.click(screen.getByText('fire'));
  expect(screen.getAllByText('Не удалось сохранить')).toHaveLength(1);
});

test('ошибка помечена role=alert', () => {
  render(
    <ToastProvider>
      <Demo />
    </ToastProvider>
  );
  fireEvent.click(screen.getByText('fire'));
  expect(screen.getByRole('alert').textContent).toBe('Не удалось сохранить');
});
```

- [ ] **Step 2: Убедиться, что падают**

```bash
cd ui && npx vitest run src/components/ui/Toast.test.tsx
```

Expected: FAIL (2 тоста вместо 1; role=alert нет).

- [ ] **Step 3: В `ui/src/components/ui/Toast.tsx`:**

Заменить `const TOAST_TTL_MS = 4000;` на:

```tsx
const TOAST_TTL_MS: Record<ToastItem['kind'], number> = { success: 4000, error: 8000 };
```

Заменить тело `push` на (дедупликация видимых одинаковых сообщений):

```tsx
  const push = useCallback((kind: ToastItem['kind'], text: string) => {
    const id = nextId.current++;
    setItems((prev) =>
      prev.some((t) => t.kind === kind && t.text === text) ? prev : [...prev, { id, kind, text }]
    );
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), TOAST_TTL_MS[kind]);
  }, []);
```

В разметке тоста добавить роль (ошибки объявляются screen-reader'ом сразу):

```tsx
            <div key={t.id} className={`ui-toast ui-toast--${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
              {t.text}
            </div>
```

- [ ] **Step 4: Тесты зелёные + commit**

```bash
cd ui && npx vitest run src/components/ui/Toast.test.tsx
git add ui/src/components/ui/Toast.tsx ui/src/components/ui/Toast.test.tsx
git commit -m "feat(ui): Toast error TTL, role=alert, dedupe of visible duplicates"
```

---

### Task A4: Общий Suspense-фолбэк вместо null

**Files:**
- Modify: `ui/src/App.tsx`

- [ ] **Step 1: В `ui/src/App.tsx`** добавить импорт:

```tsx
import { Spinner } from './components/ui';
```

и заменить `<Suspense fallback={null}>` на:

```tsx
        <Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner size={24} /></div>}>
```

- [ ] **Step 2: Проверка + commit + PR**

```bash
cd ui && npm run build && npm run test
git add ui/src/App.tsx
git commit -m "feat(ui): global Suspense fallback spinner"
git push -u origin feature/shtab-3-lib
gh pr create --title "feat(ui): Штаб этап 3a — полировка библиотеки компонентов" --body "Этап 3 по спеке _specs/2026-07-04-shtab-ux-design.md, часть A (заметки ревью этапа 1): prefers-reduced-motion, :disabled для инпутов, scroll-lock и возврат фокуса в Modal, Toast (TTL ошибок 8с, role=alert, дедупликация), общий Suspense-спиннер.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Expected: PR создан. Merge — только Alex.

---

# Часть B — группа «Работа» (PR 2, ветка `feature/shtab-3-rabota`)

### Task B0: Ветка

- [ ] **Step 1: Новая ветка от main (в том же worktree)**

```bash
cd C:/Users/Alex/10_Projects/praktor/.worktrees/shtab-3
git checkout main && git pull --ff-only && git checkout -b feature/shtab-3-rabota
```

Файлы части B не пересекаются с частью A — PR независимы.

---

### Task B1: Дежурства (Tasks.tsx)

**Files:**
- Modify: `ui/src/pages/Tasks.tsx` (полная замена, экспорт `parseScheduleForEdit` сохраняется)
- Test: `ui/src/pages/Tasks.test.tsx` (новый)

- [ ] **Step 1: Написать падающий тест `ui/src/pages/Tasks.test.tsx`**

```tsx
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ToastProvider } from '../components/ui';
import { WebSocketProvider } from '../contexts/WebSocketContext';
import Tasks from './Tasks';

class FakeWebSocket {
  static OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: unknown) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close() {}
}

const task = {
  id: 't1',
  name: 'Сводка',
  schedule: '{"kind":"cron","cron_expr":"0 9 * * *"}',
  schedule_display: '0 9 * * *',
  enabled: true,
  status: 'active',
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/tasks' && !init?.method) {
      return Promise.resolve(new Response(JSON.stringify([task])));
    }
    if (url === '/api/agents/definitions') {
      return Promise.resolve(new Response(JSON.stringify([])));
    }
    return Promise.resolve(new Response('{}'));
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPage() {
  return render(
    <WebSocketProvider>
      <ToastProvider>
        <Tasks />
      </ToastProvider>
    </WebSocketProvider>
  );
}

test('удаление идёт через ConfirmDialog, DELETE только после подтверждения', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Удалить' }));

  // диалог открыт, DELETE ещё не ушёл
  const dialog = screen.getByRole('dialog');
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(0);

  fireEvent.click(within(dialog).getByRole('button', { name: 'Удалить' }));
  await waitFor(() => {
    const del = fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE');
    expect(del).toHaveLength(1);
    expect(del[0][0]).toBe('/api/tasks/t1');
  });
});
```

- [ ] **Step 2: Убедиться, что падает**

```bash
cd ui && npx vitest run src/pages/Tasks.test.tsx
```

Expected: FAIL — кнопки «Удалить» нет (в старом UI «Delete», диалога нет).

- [ ] **Step 3: Полностью заменить `ui/src/pages/Tasks.tsx` на:**

```tsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, PageHeader,
  Select, Skeleton, Textarea, useToast,
} from '../components/ui';

interface Task {
  id: string;
  name: string;
  schedule: string;
  schedule_display?: string;
  agent_id?: string;
  agent_name?: string;
  prompt?: string;
  enabled: boolean;
  status: string;
  last_run?: string;
  next_run?: string;
}

interface TaskForm {
  name: string;
  schedule: string;
  agent_id: string;
  prompt: string;
  enabled: boolean;
}

interface Agent {
  id: string;
  name: string;
}

const emptyForm: TaskForm = { name: '', schedule: '', agent_id: '', prompt: '', enabled: true };

const STATUS_LABEL: Record<string, string> = {
  active: 'активно',
  paused: 'пауза',
  completed: 'завершено',
};

const statusTone = (s: string): 'ok' | 'accent' | 'neutral' =>
  s === 'active' ? 'ok' : s === 'completed' ? 'accent' : 'neutral';

/** Extract user-friendly schedule string from schedule JSON for editing. */
export function parseScheduleForEdit(scheduleJSON: string): string {
  try {
    const s = JSON.parse(scheduleJSON);
    if (s.kind === 'cron' && s.cron_expr) return s.cron_expr;
    if (s.kind === 'interval' && s.interval_ms > 0) {
      const ms = s.interval_ms;
      if (ms % 3600000 === 0) return `+${ms / 3600000}h`;
      if (ms % 60000 === 0) return `+${ms / 60000}m`;
      return `+${ms / 1000}s`;
    }
    if (s.kind === 'once' && s.at_ms) {
      const d = new Date(s.at_ms);
      return d.toLocaleString();
    }
  } catch { /* not JSON */ }
  return scheduleJSON;
}

type ConfirmTarget = { kind: 'one'; id: string } | { kind: 'completed' } | null;

function Tasks() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [form, setForm] = useState<TaskForm>(emptyForm);
  const [editing, setEditing] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const toast = useToast();
  const { events } = useWebSocket();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const fetchTasks = useCallback(() => {
    fetch('/api/tasks')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setTasks(Array.isArray(data) ? data : []);
        setLoadError(null);
      })
      .catch((err) => setLoadError(err.message));
  }, []);

  const fetchAgents = useCallback(() => {
    fetch('/api/agents/definitions')
      .then((res) => res.json())
      .then((data) => setAgents(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchTasks();
    fetchAgents();
  }, [fetchTasks, fetchAgents]);

  // Re-fetch on relevant WebSocket events (debounced)
  useEffect(() => {
    if (events.length === 0) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchTasks, 500);
  }, [events.length, fetchTasks]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const url = editing ? `/api/tasks/${editing}` : '/api/tasks';
      const method = editing ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      toast.success(editing ? 'Дежурство обновлено' : 'Дежурство создано');
      setForm(emptyForm);
      setEditing(null);
      setShowForm(false);
      fetchTasks();
    } catch (err) {
      toast.error(`Не удалось сохранить: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const confirmDelete = async () => {
    if (!confirmTarget) return;
    setConfirmBusy(true);
    try {
      const url = confirmTarget.kind === 'one' ? `/api/tasks/${confirmTarget.id}` : '/api/tasks/completed';
      const res = await fetch(url, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setConfirmTarget(null);
      fetchTasks();
    } catch (err) {
      toast.error(`Не удалось удалить: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setConfirmBusy(false);
    }
  };

  const handleEdit = (task: Task) => {
    setForm({
      name: task.name,
      schedule: parseScheduleForEdit(task.schedule),
      agent_id: task.agent_id ?? '',
      prompt: task.prompt ?? '',
      enabled: task.enabled,
    });
    setEditing(task.id);
    setShowForm(true);
  };

  // Оптимистичное переключение с откатом при ошибке (спека §6)
  const handleToggle = async (task: Task) => {
    if (task.status === 'completed') return;
    const prev = tasks;
    const nextEnabled = !task.enabled;
    setTasks((ts) => (ts ?? []).map((t) =>
      t.id === task.id ? { ...t, enabled: nextEnabled, status: nextEnabled ? 'active' : 'paused' } : t,
    ));
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fetchTasks();
    } catch (err) {
      setTasks(prev);
      toast.error(`Не удалось переключить: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const list = tasks ?? [];
  const hasCompleted = list.some((t) => t.status === 'completed');

  return (
    <div>
      <PageHeader
        title="Дежурства"
        subtitle="Задачи по расписанию: cron, интервалы и разовые запуски"
        actions={
          <>
            {hasCompleted && (
              <Button variant="danger" onClick={() => setConfirmTarget({ kind: 'completed' })}>
                Удалить выполненные
              </Button>
            )}
            <Button onClick={() => { setForm(emptyForm); setEditing(null); setShowForm(!showForm); }}>
              {showForm ? 'Отмена' : '+ Новое дежурство'}
            </Button>
          </>
        }
      />

      {loadError && (
        <Card style={{ color: 'var(--red)', marginBottom: 16 }}>
          Не удалось загрузить дежурства: {loadError}
        </Card>
      )}

      {showForm && (
        <Card style={{ marginBottom: 20 }}>
          <form onSubmit={handleSubmit}>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
              {editing ? 'Изменить дежурство' : 'Новое дежурство'}
            </h3>
            <div className="form-grid-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <Field label="Название">
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Ежедневная сводка"
                  required
                />
              </Field>
              <Field label="Расписание (cron, +5m, +2h)">
                <Input
                  value={form.schedule}
                  onChange={(e) => setForm({ ...form, schedule: e.target.value })}
                  placeholder="0 9 * * *"
                  required
                />
              </Field>
              <Field label="Агент">
                <Select value={form.agent_id} onChange={(e) => setForm({ ...form, agent_id: e.target.value })}>
                  <option value="">Выберите агента…</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </Select>
              </Field>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                  />
                  Включено
                </label>
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <Field label="Промпт">
                <Textarea
                  value={form.prompt}
                  onChange={(e) => setForm({ ...form, prompt: e.target.value })}
                  placeholder="Что должен сделать агент?"
                />
              </Field>
            </div>
            <Button type="submit">{editing ? 'Сохранить' : 'Создать'}</Button>
          </form>
        </Card>
      )}

      {tasks === null && !loadError && <Skeleton lines={4} />}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {list.map((task) => (
          <Card key={task.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{ fontSize: 16, fontWeight: 600 }}>{task.name}</span>
                  <Badge
                    tone={statusTone(task.status)}
                    role={task.status === 'completed' ? undefined : 'button'}
                    tabIndex={task.status === 'completed' ? undefined : 0}
                    title={task.status === 'completed' ? undefined : 'Включить или поставить на паузу'}
                    style={{ cursor: task.status === 'completed' ? 'default' : 'pointer' }}
                    onClick={() => handleToggle(task)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleToggle(task); }
                    }}
                  >
                    {STATUS_LABEL[task.status] ?? task.status}
                  </Badge>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8, fontSize: 13.5, color: 'var(--text-secondary)' }}>
                  <span>{task.schedule_display || task.schedule}</span>
                  {task.agent_id && <Badge tone="accent">{task.agent_name || task.agent_id}</Badge>}
                </div>

                {task.prompt && (
                  <div style={{ fontSize: 13.5, color: 'var(--text-tertiary)', marginBottom: 8, maxWidth: 600 }}>
                    {task.prompt.length > 120 ? task.prompt.slice(0, 120) + '…' : task.prompt}
                  </div>
                )}

                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', display: 'flex', gap: 16 }}>
                  {task.last_run && <span>Последний запуск: {task.last_run}</span>}
                  {task.next_run && <span>Следующий: {task.next_run}</span>}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginLeft: 16 }}>
                <Button variant="secondary" size="sm" onClick={() => handleEdit(task)}>Изменить</Button>
                <Button variant="danger" size="sm" onClick={() => setConfirmTarget({ kind: 'one', id: task.id })}>Удалить</Button>
              </div>
            </div>
          </Card>
        ))}
        {tasks !== null && list.length === 0 && !loadError && (
          <EmptyState
            title="Дежурств пока нет"
            hint="Дежурство — задача по расписанию: cron-выражение, интервал (+30m) или разовый запуск. Агент выполнит её и пришлёт результат в Telegram."
            action={
              <Button onClick={() => { setForm(emptyForm); setEditing(null); setShowForm(true); }}>
                + Новое дежурство
              </Button>
            }
          />
        )}
      </div>

      <ConfirmDialog
        open={confirmTarget !== null}
        title={confirmTarget?.kind === 'completed' ? 'Удалить все выполненные дежурства?' : 'Удалить дежурство?'}
        confirmLabel="Удалить"
        danger
        busy={confirmBusy}
        onConfirm={confirmDelete}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
}

export default Tasks;
```

- [ ] **Step 4: Тесты зелёные + commit**

```bash
cd ui && npx vitest run src/pages/Tasks.test.tsx src/__tests__/parse-schedule-for-edit.test.ts && npm run build
git add ui/src/pages/Tasks.tsx ui/src/pages/Tasks.test.tsx
git commit -m "feat(ui): migrate Tasks page to ui library (ConfirmDialog, optimistic toggle, toasts)"
```

---

### Task B2: Отряды (Swarms.tsx)

**Files:**
- Modify: `ui/src/pages/Swarms.tsx` (полная замена, экспорты `Swarm` и `swarmToLaunchData` сохраняются)

Изменения: Card/Button/Badge/PageHeader/Skeleton/EmptyState; **новое подтверждение удаления отряда** (ConfirmDialog, спека §6); ошибки действий → toast; русский копирайт; строка-заголовок карточки доступна с клавиатуры. `MiniTopology` (SVG) оставляет свою локальную карту цветов. Проп для SwarmGraph: `launchLabel="Сохранить и запустить"`.

- [ ] **Step 1: Полностью заменить `ui/src/pages/Swarms.tsx` на:**

```tsx
import { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import SwarmGraph, { type SwarmLaunchData } from '../components/SwarmGraph';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, PageHeader, Skeleton, useToast,
} from '../components/ui';

interface SwarmAgentResult {
  role: string;
  status: string;
  output?: string;
  error?: string;
}

interface SwarmSynapse {
  from: string;
  to: string;
  bidirectional: boolean;
}

export interface Swarm {
  id: string;
  name: string;
  lead_agent: string;
  status: string;
  task: string;
  agents?: Array<{ agent_id: string; role: string; prompt: string; workspace: string }>;
  synapses?: SwarmSynapse[];
  results?: SwarmAgentResult[];
  started_at?: string;
  completed_at?: string;
}

const STATUS_TONE: Record<string, 'ok' | 'accent' | 'danger' | 'warn'> = {
  running: 'ok',
  completed: 'accent',
  failed: 'danger',
  error: 'danger',
  pending: 'warn',
};

const STATUS_LABEL: Record<string, string> = {
  running: 'выполняется',
  completed: 'завершён',
  failed: 'сбой',
  error: 'ошибка',
  pending: 'ожидает',
};

// Цвета статусов для SVG-мини-топологии (Badge в SVG не вставить)
const SVG_STATUS: Record<string, { color: string; bg: string }> = {
  running: { color: 'var(--green)', bg: 'var(--green-muted)' },
  completed: { color: 'var(--accent)', bg: 'var(--accent-muted)' },
  failed: { color: 'var(--red)', bg: 'var(--red-muted)' },
  error: { color: 'var(--red)', bg: 'var(--red-muted)' },
  pending: { color: 'var(--amber)', bg: 'var(--amber-muted)' },
};

export function swarmToLaunchData(swarm: Swarm): SwarmLaunchData {
  return {
    name: swarm.name || 'Swarm',
    task: swarm.task,
    lead_agent: swarm.lead_agent,
    agents: (swarm.agents || []).map((a) => ({
      agent_id: a.agent_id,
      role: a.role,
      prompt: a.prompt || '',
      workspace: a.workspace || a.agent_id,
    })),
    synapses: (swarm.synapses || []).map((s) => ({
      from: s.from,
      to: s.to,
      bidirectional: s.bidirectional,
    })),
  };
}

function Swarms() {
  const [swarms, setSwarms] = useState<Swarm[] | null>(null);
  const [view, setView] = useState<'list' | 'create' | 'edit'>('list');
  const [editData, setEditData] = useState<SwarmLaunchData | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const toast = useToast();
  const { events } = useWebSocket();

  const fetchSwarms = useCallback(() => {
    fetch('/api/swarms')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setSwarms(Array.isArray(data) ? data : []);
        setLoadError(null);
      })
      .catch((err) => setLoadError(err.message));
  }, []);

  useEffect(() => {
    fetchSwarms();
  }, [fetchSwarms]);

  // React to WebSocket swarm events
  useEffect(() => {
    const latest = events[events.length - 1];
    if (!latest) return;
    const t = latest.type as string;
    if (t.startsWith('swarm_')) {
      fetchSwarms();
    }
  }, [events, fetchSwarms]);

  const launchSwarm = async (data: SwarmLaunchData) => {
    try {
      const res = await fetch('/api/swarms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setView('list');
      setEditData(null);
      fetchSwarms();
    } catch (err) {
      toast.error(`Не удалось запустить отряд: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const replaySwarm = (swarm: Swarm) => {
    launchSwarm(swarmToLaunchData(swarm));
  };

  const editSwarm = (swarm: Swarm) => {
    setEditData(swarmToLaunchData(swarm));
    setView('edit');
  };

  const confirmDelete = async () => {
    if (!confirmDeleteId) return;
    setConfirmBusy(true);
    try {
      const res = await fetch(`/api/swarms/${confirmDeleteId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setConfirmDeleteId(null);
      fetchSwarms();
    } catch (err) {
      toast.error(`Не удалось удалить: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setConfirmBusy(false);
    }
  };

  const list = swarms ?? [];

  return (
    <div>
      <PageHeader
        title="Отряды"
        subtitle="Группы агентов: параллельно, конвейером или в совместном чате"
        actions={
          <Button
            onClick={() => {
              if (view === 'list') {
                setEditData(null);
                setView('create');
              } else {
                setView('list');
                setEditData(null);
              }
            }}
          >
            {view === 'list' ? '+ Новый отряд' : 'К списку'}
          </Button>
        }
      />

      {loadError && (
        <Card style={{ color: 'var(--red)', marginBottom: 16 }}>
          Не удалось загрузить отряды: {loadError}
        </Card>
      )}

      {view === 'create' ? (
        <SwarmGraph onLaunch={launchSwarm} />
      ) : view === 'edit' && editData ? (
        <SwarmGraph onLaunch={launchSwarm} initialData={editData} launchLabel="Сохранить и запустить" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {swarms === null && !loadError && <Skeleton lines={4} />}
          {list.map((swarm) => {
            const isExpanded = expanded === swarm.id;
            const agents = swarm.agents || [];
            const results = swarm.results || [];
            const synapses = swarm.synapses || [];

            return (
              <Card key={swarm.id}>
                <div
                  role="button"
                  tabIndex={0}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                  onClick={() => setExpanded(isExpanded ? null : swarm.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(isExpanded ? null : swarm.id); }
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                      <span style={{ fontSize: 16, fontWeight: 600 }}>{swarm.name || 'Отряд'}</span>
                      <Badge tone={STATUS_TONE[swarm.status] ?? 'neutral'}>
                        {STATUS_LABEL[swarm.status] ?? swarm.status}
                      </Badge>
                      {swarm.lead_agent && (
                        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                          Ведущий: {swarm.lead_agent}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', maxWidth: 600 }}>
                      {swarm.task.length > 120 ? swarm.task.slice(0, 120) + '…' : swarm.task}
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 6, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                      {agents.length > 0 && <span>агентов: {agents.length}</span>}
                      {synapses.length > 0 && <span>связей: {synapses.length}</span>}
                      {swarm.started_at && <span>Запущен: {swarm.started_at}</span>}
                      {swarm.completed_at && <span>Завершён: {swarm.completed_at}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 12 }}>
                    {swarm.status !== 'running' && (
                      <>
                        <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); replaySwarm(swarm); }}>
                          Повторить
                        </Button>
                        <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); editSwarm(swarm); }}>
                          Изменить
                        </Button>
                        <Button variant="danger" size="sm" onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(swarm.id); }}>
                          Удалить
                        </Button>
                      </>
                    )}
                    <span style={{
                      color: 'var(--text-tertiary)',
                      fontSize: 15,
                      transform: isExpanded ? 'rotate(90deg)' : 'none',
                      transition: 'transform 0.15s',
                      marginLeft: 4,
                    }}>
                      {'▶'}
                    </span>
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                    {agents.length > 0 && (
                      <MiniTopology agents={agents} synapses={synapses} results={results} leadAgent={swarm.lead_agent} />
                    )}

                    {results.length > 0 && (
                      <div style={{ marginTop: 16 }}>
                        <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10 }}>
                          Результаты
                        </h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {results.map((r, i) => (
                            <div key={i} style={{ padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: 8 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                <span style={{ fontWeight: 600, fontSize: 13.5 }}>{r.role}</span>
                                <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>
                                  {STATUS_LABEL[r.status] ?? r.status}
                                </Badge>
                              </div>
                              {r.output && (
                                <pre style={{
                                  fontSize: 12.5,
                                  color: 'var(--text-secondary)',
                                  whiteSpace: 'pre-wrap',
                                  wordBreak: 'break-word',
                                  maxHeight: 200,
                                  overflowY: 'auto',
                                  margin: 0,
                                }}>
                                  {r.output}
                                </pre>
                              )}
                              {r.error && (
                                <div style={{ fontSize: 12.5, color: 'var(--red)' }}>{r.error}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
          {swarms !== null && list.length === 0 && !loadError && (
            <EmptyState
              title="Запусков отрядов ещё не было"
              hint="Отряд — граф агентов: без связей они работают параллельно, стрелка передаёт результат по конвейеру, двунаправленная связь открывает общий чат. Соберите граф в редакторе и запустите."
              action={<Button onClick={() => { setEditData(null); setView('create'); }}>+ Новый отряд</Button>}
            />
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Удалить отряд?"
        message="Запись о запуске и его результаты будут удалены."
        confirmLabel="Удалить"
        danger
        busy={confirmBusy}
        onConfirm={confirmDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}

/* ── Mini read-only graph visualization ── */
function MiniTopology({
  agents,
  synapses,
  results,
  leadAgent,
}: {
  agents: Array<{ role: string }>;
  synapses: SwarmSynapse[];
  results: SwarmAgentResult[];
  leadAgent: string;
}) {
  const resultMap = new Map(results.map((r) => [r.role, r.status]));
  const nodeW = 100;
  const nodeH = 36;
  const padding = 20;

  // Simple grid layout
  const cols = Math.min(agents.length, 4);
  const nodes = agents.map((a, i) => ({
    role: a.role,
    x: padding + (i % cols) * (nodeW + 40),
    y: padding + Math.floor(i / cols) * (nodeH + 30),
  }));

  const svgW = padding * 2 + cols * (nodeW + 40);
  const svgH = padding * 2 + Math.ceil(agents.length / cols) * (nodeH + 30);

  return (
    <svg width={Math.min(svgW, 600)} height={Math.min(svgH, 200)} style={{ display: 'block', marginBottom: 8 }}>
      <defs>
        <marker id="mini-arrow" markerWidth="6" markerHeight="5" refX="6" refY="2.5" orient="auto">
          <path d="M0,0 L6,2.5 L0,5" fill="var(--text-muted)" />
        </marker>
      </defs>

      {/* Edges */}
      {synapses.map((s, i) => {
        const from = nodes.find((n) => n.role === s.from);
        const to = nodes.find((n) => n.role === s.to);
        if (!from || !to) return null;
        return (
          <line
            key={`e-${i}`}
            x1={from.x + nodeW / 2} y1={from.y + nodeH / 2}
            x2={to.x + nodeW / 2} y2={to.y + nodeH / 2}
            stroke="var(--text-muted)"
            strokeWidth={1}
            markerEnd={s.bidirectional ? undefined : 'url(#mini-arrow)'}
            strokeDasharray={s.bidirectional ? '4,3' : undefined}
          />
        );
      })}

      {/* Nodes */}
      {nodes.map((n) => {
        const status = resultMap.get(n.role);
        const sc = status
          ? (SVG_STATUS[status] ?? { color: 'var(--text-tertiary)', bg: 'var(--accent-muted)' })
          : { color: 'var(--text-tertiary)', bg: 'var(--bg-elevated)' };
        const isLead = n.role === leadAgent;
        return (
          <g key={n.role}>
            <rect
              x={n.x} y={n.y} width={nodeW} height={nodeH} rx={6}
              fill={sc.bg}
              stroke={isLead ? 'var(--amber)' : 'var(--border)'}
              strokeWidth={isLead ? 2 : 1}
            />
            <text
              x={n.x + nodeW / 2} y={n.y + nodeH / 2 + 4}
              textAnchor="middle" fontSize={13} fontWeight={600}
              fill={sc.color}
            >
              {n.role.length > 12 ? n.role.slice(0, 10) + '..' : n.role}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default Swarms;
```

- [ ] **Step 2: Проверка + commit**

```bash
cd ui && npx vitest run src/__tests__/swarm-to-launch-data.test.ts && npm run build && npm run test
git add ui/src/pages/Swarms.tsx
git commit -m "feat(ui): migrate Swarms page to ui library (delete confirmation, russian labels)"
```

---

### Task B3: Приёмная — Входящие (Intake.tsx)

**Files:**
- Modify: `ui/src/pages/Intake.tsx` (полная замена, экспорт `IntakeContent` сохраняется)

Логика записи голоса и отправки FormData не меняется. UI: Card/Field/Button/Badge/Skeleton/EmptyState; `msg` → toast; PageHeader не добавлять (он в Reception).

- [ ] **Step 1: Полностью заменить `ui/src/pages/Intake.tsx` на:**

```tsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { routeLabel, statusLabel, type IntakeItem, type IntakeList } from './intakeStatus';
import { Badge, Button, Card, EmptyState, Input, Skeleton, Textarea, useToast } from '../components/ui';

// Тон бейджа статуса по смыслу (набор статусов открытый — подстрочные проверки)
function statusTone(status: string): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (/done|approved|completed/.test(status)) return 'ok';
  if (/reject|fail|error/.test(status)) return 'danger';
  if (/await|progress|plan/.test(status)) return 'warn';
  return 'neutral';
}

export function IntakeContent() {
  const [doc, setDoc] = useState<IntakeList | null>(null);
  const [text, setText] = useState('');
  const [project, setProject] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const audio = useRef<Blob | null>(null);

  const fetchList = useCallback(() => {
    fetch('/api/intake')
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then(setDoc)
      .catch(() => setDoc({ items: [] }));
  }, []);

  useEffect(() => {
    fetchList();
    const id = setInterval(fetchList, 60000);
    return () => clearInterval(id);
  }, [fetchList]);

  useEffect(() => {
    return () => {
      if (recorder.current && recorder.current.state !== 'inactive') {
        recorder.current.stop(); // onstop освобождает дорожки микрофона
      }
    };
  }, []);

  const startRec = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream);
    chunks.current = [];
    mr.ondataavailable = (e) => chunks.current.push(e.data);
    mr.onstop = () => {
      audio.current = new Blob(chunks.current, { type: 'audio/ogg' });
      stream.getTracks().forEach((t) => t.stop());
    };
    recorder.current = mr;
    mr.start();
    setRecording(true);
  }, []);

  const stopRec = useCallback(() => {
    recorder.current?.stop();
    setRecording(false);
  }, []);

  const submit = useCallback(async () => {
    setBusy(true);
    const fd = new FormData();
    if (text.trim()) fd.append('text', text.trim());
    if (project.trim()) fd.append('project', project.trim());
    if (photo) fd.append('photo', photo);
    if (audio.current) fd.append('audio', audio.current, 'voice.ogg');
    try {
      const res = await fetch('/api/intake', { method: 'POST', body: fd });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setText(''); setProject(''); setPhoto(null); audio.current = null;
      toast.success('Принято в очередь');
      fetchList();
    } catch (e) {
      toast.error(`Не удалось отправить: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [text, project, photo, fetchList, toast]);

  const items = doc?.items ?? [];

  return (
    <div>
      <Card style={{ marginBottom: 12 }}>
        <Textarea
          style={{ marginBottom: 8 }}
          placeholder="Задача Claude'у…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Input
          style={{ marginBottom: 8 }}
          placeholder="проект (опц.) — пусто = триаж определит"
          value={project}
          onChange={(e) => setProject(e.target.value)}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          {!recording
            ? <Button variant="secondary" size="sm" onClick={startRec}>🎙 Запись</Button>
            : <Button variant="danger" size="sm" onClick={stopRec}>⏹ Стоп</Button>}
          {audio.current && <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>голос готов</span>}
          <Button style={{ marginLeft: 'auto' }} busy={busy} onClick={submit}>Отправить</Button>
        </div>
      </Card>

      {doc?.stale && (
        <div style={{ color: 'var(--amber)', marginBottom: 12 }}>
          ⚠ данные могли устареть{doc.fetch_error ? `: ${doc.fetch_error}` : ''}
        </div>
      )}

      {doc === null && <Skeleton lines={3} />}

      {items.map((it: IntakeItem) => (
        <Card key={it.id} style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{it.source === 'telegram' ? '✈' : '🌐'}</span>
            <strong style={{ flex: 1, fontSize: 13.5, minWidth: 200 }}>{it.raw_text.slice(0, 120) || '(медиа)'}</strong>
            {it.target_project && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{it.target_project}</span>}
            <Badge tone="accent">{routeLabel(it.route)}</Badge>
            <Badge tone={statusTone(it.status)}>{statusLabel(it.status)}</Badge>
          </div>
        </Card>
      ))}

      {doc !== null && items.length === 0 && (
        <EmptyState
          title="Входящих нет"
          hint="Всё разобрано. Новые задачи попадают сюда из Telegram и формы выше: триаж определит маршрут и проект."
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Проверка + commit**

```bash
cd ui && npx vitest run src/pages/Reception.test.tsx src/pages/__tests__/intakeStatus.test.ts && npm run build
git add ui/src/pages/Intake.tsx
git commit -m "feat(ui): migrate Intake content to ui library (toasts, skeleton, empty state)"
```

Внимание: `Reception.test.tsx` рендерит IntakeContent — если он падает из-за отсутствия ToastProvider в тесте, обернуть рендер в тесте в `<ToastProvider>` (импорт из `../components/ui`), поведение теста не менять.

---

### Task B4: Приёмная — Планы (Plans.tsx)

**Files:**
- Modify: `ui/src/pages/Plans.tsx` (полная замена, экспорт `PlansContent` сохраняется)

Инлайн-модалка подтверждения → ConfirmDialog (текстовое поле причины отклонения передаётся через `message`); кнопки → Button; ошибки → toast.

- [ ] **Step 1: Полностью заменить `ui/src/pages/Plans.tsx` на:**

```tsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { awaitingPlans, type PlanItem } from './planStatus';
import type { IntakeList } from './intakeStatus';
import { approvePlan, rejectPlan } from './actions';
import { Button, Card, ConfirmDialog, EmptyState, Skeleton, Textarea, useToast } from '../components/ui';

export function PlansContent() {
  const [items, setItems] = useState<PlanItem[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [planHtml, setPlanHtml] = useState('');
  const [confirm, setConfirm] = useState<{ id: string; action: 'approve' | 'reject' } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const fetchList = useCallback(() => {
    fetch('/api/intake')
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((d: IntakeList) => setItems(awaitingPlans(d.items || [])))
      .catch(() => setItems([]));
  }, []);
  useEffect(() => { fetchList(); }, [fetchList]);

  const activeId = useRef<string | null>(null);

  const openPlan = useCallback((id: string) => {
    if (openId === id) { setOpenId(null); activeId.current = null; return; }
    setOpenId(id);
    activeId.current = id;
    setPlanHtml('');
    fetch(`/api/intake/${id}/plan`)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error('no plan'))))
      .then((md) => {
        if (activeId.current !== id) return; // a newer card was opened; ignore
        const html = DOMPurify.sanitize(marked.parse(md, { async: false }), {
          ALLOWED_TAGS: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li',
            'code', 'pre', 'strong', 'em', 'del', 'a', 'blockquote', 'hr', 'br',
            'table', 'thead', 'tbody', 'tr', 'th', 'td'],
          ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
        });
        setPlanHtml(html);
      })
      .catch(() => { if (activeId.current === id) setPlanHtml('<p>План недоступен.</p>'); });
  }, [openId]);

  const doAction = useCallback(async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.action === 'approve') await approvePlan(confirm.id);
      else await rejectPlan(confirm.id, reason);
      setConfirm(null); setReason(''); setOpenId(null);
      fetchList();
    } catch (e) {
      toast.error(`Не удалось выполнить: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [confirm, reason, fetchList, toast]);

  const list = items ?? [];

  return (
    <div>
      {items === null && <Skeleton lines={3} />}
      {items !== null && list.length === 0 && (
        <EmptyState
          title="Нет планов, ожидающих одобрения"
          hint="Когда агент подготовит план по задаче из Входящих, он появится здесь на подпись."
        />
      )}
      {list.map((it) => (
        <Card key={it.id} style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <strong>{it.raw_text.split('\n')[0]}</strong>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {it.target_project || '—'} · {it.created_at.slice(0, 10)}
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={() => openPlan(it.id)}>
              {openId === it.id ? 'Скрыть' : 'План'}
            </Button>
          </div>
          {openId === it.id && (
            <>
              <div
                style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}
                dangerouslySetInnerHTML={{ __html: planHtml || '<p style="color:var(--text-secondary)">Загрузка…</p>' }}
              />
              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <Button onClick={() => setConfirm({ id: it.id, action: 'approve' })}>Одобрить</Button>
                <Button variant="secondary" onClick={() => setConfirm({ id: it.id, action: 'reject' })}>Отклонить</Button>
              </div>
            </>
          )}
        </Card>
      ))}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.action === 'approve' ? 'Одобрить план?' : 'Отклонить план?'}
        message={confirm?.action === 'approve'
          ? 'Локальный CC начнёт исполнение.'
          : (
            <Textarea
              placeholder="Причина (что переделать)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        confirmLabel={confirm?.action === 'approve' ? 'Одобрить' : 'Отклонить'}
        danger={confirm?.action === 'reject'}
        busy={busy}
        onConfirm={doAction}
        onCancel={() => { setConfirm(null); setReason(''); }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Проверка + commit + PR части B**

```bash
cd ui && npm run build && npm run test
git add ui/src/pages/Plans.tsx
git commit -m "feat(ui): migrate Plans content to ui library (ConfirmDialog with reject reason)"
```

Ручная проверка (`cd ui && npm run dev`, десктоп + мобильная ширина): Дежурства (форма, toggle-бейдж, удаление через диалог), Отряды (список, удаление, редактор открывается), Приёмная (обе вкладки, отправка формы без бэка даст toast-ошибку — это норм). Остановить dev-сервер.

```bash
git push -u origin feature/shtab-3-rabota
gh pr create --title "feat(ui): Штаб этап 3b — миграция группы «Работа»" --body "Этап 3 по спеке _specs/2026-07-04-shtab-ux-design.md (§8): Дежурства, Отряды, Приёмная (Входящие+Планы) на библиотеке компонентов. ConfirmDialog вместо confirm() и инлайн-модалки, оптимистичный toggle дежурств, скелетоны/EmptyState/Toast, русский копирайт.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Expected: PR создан. Merge — только Alex.

---

# Часть C — группа «Экосистема» (PR 3, ветка `feature/shtab-3-ecosystem`)

### Task C0: Ветка

- [ ] **Step 1:**

```bash
cd C:/Users/Alex/10_Projects/praktor/.worktrees/shtab-3
git checkout main && git pull --ff-only && git checkout -b feature/shtab-3-ecosystem
```

---

### Task C1: Операции (Projects.tsx)

**Files:**
- Modify: `ui/src/pages/Projects.tsx` (полная замена)

Главное: **починка сломанной модалки** (классы `.modal*` не определены) — на ConfirmDialog. Названия команд (merge, approve, deploy, CI, audit) не переводим.

- [ ] **Step 1: Полностью заменить `ui/src/pages/Projects.tsx` на:**

```tsx
import { useState, useEffect, useCallback } from 'react';
import { ciLabel, deployLabel, deployRunLabel, type ProjectStatus } from './projectStatus';
import { approve, mergePR, deploy } from './actions';
import { Button, Card, ConfirmDialog, EmptyState, PageHeader, Skeleton } from '../components/ui';

function Projects() {
  const [projects, setProjects] = useState<ProjectStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fetchProjects = useCallback(() => {
    fetch('/api/projects')
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then(setProjects)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    fetchProjects();
    const id = setInterval(fetchProjects, 30000);
    return () => clearInterval(id);
  }, [fetchProjects]);

  // While any deploy is running, poll faster so the card status feels live.
  const anyRunning = (projects ?? []).some((p) => p.deploy_run?.state === 'running');
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(fetchProjects, 4000);
    return () => clearInterval(id);
  }, [anyRunning, fetchProjects]);

  const [pending, setPending] = useState<null | { label: string; run: () => Promise<void> }>(null);
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

  async function confirmRun() {
    if (!pending) return;
    setBusy(true);
    setActionErr(null);
    try {
      await pending.run();
      setPending(null);
      fetchProjects();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Операции" subtitle="Проекты: PR, CI, audit-issues и деплой" />

      {error && (
        <Card style={{ color: 'var(--red)', marginBottom: 16 }}>Не удалось загрузить: {error}</Card>
      )}

      {projects === null && !error && <Skeleton lines={4} />}

      {projects !== null && projects.length === 0 && !error && (
        <EmptyState
          title="Проекты не настроены"
          hint="Раздел показывает статус репозиториев: открытые PR, CI, audit-issues и деплой. Проекты настраиваются в конфигурации гейтвея."
        />
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {(projects ?? []).map((p) => (
          <Card key={p.name} style={{ minWidth: 280 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong style={{ fontSize: 16 }}>{p.name}</strong>
              <span title={p.deploy.error || ''} style={{ color: p.deploy.ok ? 'var(--accent)' : 'var(--red)' }}>
                {deployLabel(p.deploy)}
              </span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{p.repo}</div>
            <div style={{ marginTop: 10, display: 'grid', gap: 4, fontSize: 13.5 }}>
              <div>PR: {p.pr_error ? <span title={p.pr_error}>ошибка</span> : (p.prs?.length ?? 0)} откр.</div>
              <div>CI: {ciLabel(p.ci)}</div>
              <div>audit: {p.audit_error ? <span title={p.audit_error}>ошибка</span> : (p.audit_issues?.length ?? 0)}</div>
              <div>агенты: {(p.agents ?? []).map((a) => (
                <span key={a.id} style={{ marginRight: 8 }}>{a.id} {a.running ? '●' : '○'}</span>
              ))}</div>
              {deployRunLabel(p.deploy_run) && (
                <div style={{ color: p.deploy_run?.state === 'failed' ? 'var(--red)' : 'var(--text-secondary)' }}>
                  {deployRunLabel(p.deploy_run)}
                </div>
              )}
            </div>
            {(p.prs ?? []).length > 0 && (
              <ul style={{ marginTop: 8, paddingLeft: 16, fontSize: 13 }}>
                {p.prs!.map((pr) => (
                  <li key={pr.number} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <a href={pr.url} target="_blank" rel="noopener noreferrer">#{pr.number} {pr.title}{pr.draft ? ' (draft)' : ''}</a>
                    <Button variant="secondary" size="sm" onClick={() => setPending({
                      label: `merge ${p.repo}#${pr.number}`,
                      run: () => mergePR(p.name, pr.number),
                    })}>merge</Button>
                  </li>
                ))}
              </ul>
            )}
            {(p.audit_issues ?? []).length > 0 && (
              <div style={{ marginTop: 8, display: 'grid', gap: 4, fontSize: 13 }}>
                {p.audit_issues!.map((iss) => (
                  <div key={iss.number} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>audit #{iss.number}</span>
                    <Button variant="secondary" size="sm" onClick={() => setPending({
                      label: `approve trivial on ${p.repo}#${iss.number}`,
                      run: () => approve(p.name, 'trivial', iss.number),
                    })}>approve trivial</Button>
                    <Button variant="secondary" size="sm" onClick={() => setPending({
                      label: `approve ALL on ${p.repo}#${iss.number}`,
                      run: () => approve(p.name, 'all', iss.number),
                    })}>approve all</Button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop: 10 }}>
              <Button size="sm" disabled={p.deploy_run?.state === 'running'} onClick={() => setPending({
                label: `deploy ${p.name}`,
                run: () => deploy(p.name),
              })}>deploy</Button>
            </div>
          </Card>
        ))}
      </div>

      <ConfirmDialog
        open={pending !== null}
        title="Подтвердить действие"
        message={
          <>
            <div style={{ fontWeight: 600 }}>{pending?.label}</div>
            {actionErr && <div style={{ color: 'var(--red)', marginTop: 8 }}>{actionErr}</div>}
          </>
        }
        confirmLabel="Подтвердить"
        busy={busy}
        onConfirm={confirmRun}
        onCancel={() => { setPending(null); setActionErr(null); }}
      />
    </div>
  );
}

export default Projects;
```

- [ ] **Step 2: Проверка + commit**

```bash
cd ui && npx vitest run src/__tests__/project-status.test.ts src/__tests__/actions.test.ts && npm run build
git add ui/src/pages/Projects.tsx
git commit -m "fix(ui): Projects confirm modal on ConfirmDialog (broken .modal classes), migrate to ui library"
```

---

### Task C2: Задачи (Portfolio.tsx)

**Files:**
- Modify: `ui/src/pages/Portfolio.tsx` (полная замена)

Цвет `paused` — через токен `var(--amber)` (спека §8); строка проекта доступна с клавиатуры; Skeleton/EmptyState.

- [ ] **Step 1: Полностью заменить `ui/src/pages/Portfolio.tsx` на:**

```tsx
import { useState, useEffect, useCallback } from 'react';
import { percent, groupByLane, type Portfolio as PortfolioDoc, type PortfolioProject } from './portfolioStatus';
import { ciLabel, deployLabel, type ProjectStatus } from './projectStatus';
import { Card, EmptyState, PageHeader, Skeleton } from '../components/ui';

const STATUS_COLOR: Record<string, string> = {
  active: 'var(--accent)',
  paused: 'var(--amber)',
  done: 'var(--text-secondary)',
};

const LANE_LABEL: Record<'planned' | 'doing' | 'done', string> = {
  planned: 'план',
  doing: 'в работе',
  done: 'готово',
};

function Portfolio() {
  const [doc, setDoc] = useState<PortfolioDoc | null>(null);
  const [live, setLive] = useState<Record<string, ProjectStatus>>({});
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const fetchAll = useCallback(() => {
    fetch('/api/portfolio')
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then(setDoc)
      .catch((err) => setError(err.message));
    fetch('/api/projects')
      .then((res) => (res.ok ? res.json() : []))
      .then((arr: ProjectStatus[]) => {
        const map: Record<string, ProjectStatus> = {};
        for (const p of arr) map[p.name] = p;
        setLive(map);
      })
      .catch(() => { /* live chip is best-effort */ });
  }, []);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 60000);
    return () => clearInterval(id);
  }, [fetchAll]);

  return (
    <div>
      <PageHeader title="Задачи" subtitle="Роадмап проектов: направления и прогресс" />

      {error && <Card style={{ color: 'var(--red)', marginBottom: 16 }}>Не удалось загрузить: {error}</Card>}
      {doc === null && !error && <Skeleton lines={4} />}

      {doc?.stale && (
        <div style={{ color: 'var(--amber)', marginBottom: 12 }}>
          ⚠ данные могли устареть{doc.fetch_error ? `: ${doc.fetch_error}` : ''}
        </div>
      )}

      {doc !== null && doc.projects.length === 0 && (
        <EmptyState
          title="Роадмап пуст"
          hint="Здесь появятся проекты с направлениями и прогрессом, когда роадмап будет заполнен."
        />
      )}

      {(doc?.projects ?? []).map((p: PortfolioProject) => {
        const pct = percent(p.directions);
        const lv = p.mc_key ? live[p.mc_key] : undefined;
        const isOpen = open === p.key;
        const lanes = groupByLane(p.directions);
        return (
          <Card key={p.key} style={{ marginBottom: 12 }}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => setOpen(isOpen ? null : p.key)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(isOpen ? null : p.key); }
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 4, background: STATUS_COLOR[p.status] || 'var(--text-secondary)' }} />
              <strong style={{ fontSize: 15, flex: 1 }}>{p.name}</strong>
              {lv && <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>CI {ciLabel(lv.ci)} · {deployLabel(lv.deploy)}</span>}
              <span style={{ fontSize: 13, color: 'var(--text-secondary)', minWidth: 36, textAlign: 'right' }}>{pct}%</span>
            </div>
            <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, marginTop: 8 }}>
              <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', borderRadius: 2 }} />
            </div>
            {p.next_action && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6 }}>дальше: {p.next_action}</div>}
            {isOpen && (
              <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
                {(['planned', 'doing', 'done'] as const).map((k) => (
                  <div key={k} style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 4 }}>
                      {LANE_LABEL[k]}
                    </div>
                    {lanes[k].map((d, i) => (
                      <div key={i} style={{ fontSize: 13, padding: '4px 0', borderTop: '1px solid var(--border)' }}>{d.title}</div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

export default Portfolio;
```

- [ ] **Step 2: Проверка + commit**

```bash
cd ui && npx vitest run src/__tests__/portfolioStatus.test.ts && npm run build
git add ui/src/pages/Portfolio.tsx
git commit -m "feat(ui): migrate Portfolio page to ui library (amber token for paused, a11y rows)"
```

---

### Task C3: Разведка — Радар (Radar.tsx)

**Files:**
- Modify: `ui/src/pages/Radar.tsx` (полная замена, экспорт `RadarContent` сохраняется)

- [ ] **Step 1: Полностью заменить `ui/src/pages/Radar.tsx` на:**

```tsx
import { useState, useEffect, useCallback } from 'react';
import { formatStars, type RadarResponse, type RadarItem } from './radarStatus';
import { Badge, Card, EmptyState, Skeleton } from '../components/ui';

function RadarRow({ it }: { it: RadarItem }) {
  return (
    <Card style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <a href={it.html_url} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>
            {it.full_name}
          </a>
          {it.is_new && <Badge tone="accent" style={{ marginLeft: 8 }}>новое</Badge>}
          <Badge tone="neutral" style={{ marginLeft: 8 }}>{it.topic}</Badge>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
            {it.description || '—'}
          </div>
        </div>
        <div style={{ whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontSize: 13 }}>
          ★ {formatStars(it.stars)}
        </div>
      </div>
    </Card>
  );
}

export function RadarContent() {
  const [items, setItems] = useState<RadarItem[] | null>(null);

  const fetchData = useCallback(() => {
    fetch('/api/radar')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('load failed'))))
      .then((d: RadarResponse) => setItems(d.items || []))
      .catch(() => setItems([]));
  }, []);
  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div>
      {items === null && <Skeleton lines={3} />}
      {items !== null && items.length === 0 && (
        <EmptyState
          title="Радар пуст или выключен"
          hint="Радар отслеживает свежие GitHub-репозитории по темам разведки. Источники настраиваются в конфигурации."
        />
      )}
      {(items ?? []).map((it) => <RadarRow key={it.full_name} it={it} />)}
    </div>
  );
}
```

- [ ] **Step 2: Проверка + commit**

```bash
cd ui && npx vitest run src/pages/Recon.test.tsx src/pages/__tests__/radarStatus.test.ts && npm run build
git add ui/src/pages/Radar.tsx
git commit -m "feat(ui): migrate Radar content to ui library"
```

---

### Task C4: Разведка — Сводки (Intel.tsx)

**Files:**
- Modify: `ui/src/pages/Intel.tsx` (полная замена, экспорт `IntelContent` сохраняется)

- [ ] **Step 1: Полностью заменить `ui/src/pages/Intel.tsx` на:**

```tsx
import { useState, useEffect, useCallback } from 'react';
import { snapshotStatus, type IntelSource } from './intelStatus';
import { Badge, Card, EmptyState, Skeleton } from '../components/ui';

const STATUS_TONE: Record<string, 'ok' | 'danger' | 'neutral'> = {
  ok: 'ok',
  error: 'danger',
  empty: 'neutral',
};

function IntelCard({ src }: { src: IntelSource }) {
  const st = snapshotStatus(src.latest);
  return (
    <Card style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <span style={{ fontWeight: 600 }}>{src.key}</span>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 8 }}>{src.project}</span>
          <Badge tone={STATUS_TONE[st] ?? 'neutral'} style={{ marginLeft: 8 }}>{st}</Badge>
          {src.latest?.ok && src.latest.change_note && (
            <div style={{ marginTop: 8, fontSize: 13.5 }}>
              {src.latest.change_note}
            </div>
          )}
          {src.latest?.ok && src.latest.payload && (
            <pre style={{
              marginTop: 8, padding: '8px 12px', borderRadius: 6,
              background: 'var(--bg-sidebar)', fontSize: 12,
              overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            }}>{src.latest.payload}</pre>
          )}
          {src.latest && !src.latest.ok && (
            <div style={{ marginTop: 8, fontSize: 13, color: 'var(--red)' }}>
              Сбой сбора: {src.latest.error}
            </div>
          )}
        </div>
      </div>
      {src.history.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)', userSelect: 'none' }}>
            История ({src.history.length})
          </summary>
          <ul style={{ margin: '8px 0 0', padding: '0 0 0 16px', fontSize: 13, color: 'var(--text-secondary)' }}>
            {src.history.map((h, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                {new Date(h.captured_at * 1000).toISOString().slice(0, 16).replace('T', ' ')}{' '}—{' '}
                {h.ok ? (h.change_note || '—') : `сбой: ${h.error}`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

export function IntelContent() {
  const [sources, setSources] = useState<IntelSource[] | null>(null);

  const fetchData = useCallback(() => {
    fetch('/api/intel')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('load failed'))))
      .then((d: { sources: IntelSource[] }) => setSources(d.sources || []))
      .catch(() => setSources([]));
  }, []);
  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div>
      {sources === null && <Skeleton lines={3} />}
      {sources !== null && sources.length === 0 && (
        <EmptyState
          title="Нет источников или снимков"
          hint="Разведсводки собираются по расписанию из настроенных источников; изменения появятся здесь."
        />
      )}
      {(sources ?? []).map((s) => <IntelCard key={s.key} src={s} />)}
    </div>
  );
}
```

- [ ] **Step 2: Проверка + commit + PR части C**

```bash
cd ui && npm run build && npm run test
git add ui/src/pages/Intel.tsx
git commit -m "feat(ui): migrate Intel content to ui library"
```

Ручная проверка (`npm run dev`, десктоп + мобильная): Операции (карточки, модалка подтверждения открывается и закрывается), Задачи (раскрытие проекта, прогресс), Разведка (обе вкладки). Остановить.

```bash
git push -u origin feature/shtab-3-ecosystem
gh pr create --title "feat(ui): Штаб этап 3c — миграция группы «Экосистема»" --body "Этап 3 по спеке _specs/2026-07-04-shtab-ux-design.md (§8): Операции, Задачи, Разведка (Радар+Сводки) на библиотеке компонентов. Починена сломанная модалка подтверждения в Операциях (классы .modal* не были определены), paused — через токен, скелетоны/EmptyState.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Expected: PR создан. Merge — только Alex.

---

# Часть D — группа «Система» (PR 4, ветка `feature/shtab-3-system`)

### Task D0: Ветка

- [ ] **Step 1:**

```bash
cd C:/Users/Alex/10_Projects/praktor/.worktrees/shtab-3
git checkout main && git pull --ff-only && git checkout -b feature/shtab-3-system
```

---

### Task D1: Агенты (Agents.tsx)

**Files:**
- Modify: `ui/src/pages/Agents.tsx` (полная замена)

Главное: честный «Сохранено» для AGENT.md (сейчас `saveAgentMd` не проверяет `res.ok`), ошибки start/stop → toast, карточки доступны с клавиатуры. Кнопки start/stop сохраняют атрибуты `data-agent-start`/`data-agent-stop` (hover-правила base.css) и получают `aria-label`.

- [ ] **Step 1: Полностью заменить `ui/src/pages/Agents.tsx` на:**

```tsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import AgentExtensions from '../components/AgentExtensions';
import {
  Badge, Button, Card, EmptyState, PageHeader, Skeleton, Textarea, useToast,
} from '../components/ui';

interface Agent {
  id: string;
  name: string;
  description?: string;
  model?: string;
  image?: string;
  workspace?: string;
  agent_status?: string;
  default_agent?: boolean;
  message_count?: number;
  last_active?: string;
}

const STATUS_LABEL: Record<string, string> = {
  running: 'работает',
  stopped: 'остановлен',
};

function Agents() {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [selected, setSelected] = useState<Agent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [agentMd, setAgentMd] = useState('');
  const [agentMdSaving, setAgentMdSaving] = useState(false);
  const [agentMdLoading, setAgentMdLoading] = useState(false);
  const toast = useToast();
  const { events } = useWebSocket();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const fetchAgents = useCallback(() => {
    fetch('/api/agents/definitions')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setAgents(Array.isArray(data) ? data : []);
        setLoadError(null);
      })
      .catch((err) => setLoadError(err.message));
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  // Re-fetch on relevant WebSocket events (debounced)
  useEffect(() => {
    if (events.length === 0) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchAgents, 500);
  }, [events.length, fetchAgents]);

  useEffect(() => {
    if (!selected) return;
    setAgentMdLoading(true);
    fetch(`/api/agents/definitions/${selected.id}/agent-md`)
      .then((res) => res.json())
      .then((data) => setAgentMd(data.content || ''))
      .catch(() => setAgentMd(''))
      .finally(() => setAgentMdLoading(false));
  }, [selected?.id]);

  const saveAgentMd = async () => {
    if (!selected) return;
    setAgentMdSaving(true);
    try {
      const res = await fetch(`/api/agents/definitions/${selected.id}/agent-md`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: agentMd }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Сохранено');
    } catch (err) {
      toast.error(`Не удалось сохранить AGENT.md: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAgentMdSaving(false);
    }
  };

  const toggleAgent = async (agent: Agent, action: 'start' | 'stop') => {
    try {
      const res = await fetch(`/api/agents/definitions/${agent.id}/${action}`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fetchAgents();
    } catch (err) {
      toast.error(`Не удалось ${action === 'start' ? 'запустить' : 'остановить'} агента: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const list = agents ?? [];

  return (
    <div>
      <PageHeader title="Агенты" subtitle="Определения агентов: статусы контейнеров, AGENT.md и расширения" />

      {loadError && (
        <Card style={{ color: 'var(--red)', marginBottom: 16 }}>
          Не удалось загрузить агентов: {loadError}
        </Card>
      )}

      {agents === null && !loadError && <Skeleton lines={4} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
        {[...list].sort((a, b) => a.name.localeCompare(b.name)).map((agent) => (
          <Card
            key={agent.id}
            interactive
            role="button"
            tabIndex={0}
            style={{ borderColor: selected?.id === agent.id ? 'var(--accent)' : undefined }}
            onClick={() => setSelected(selected?.id === agent.id ? null : agent)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setSelected(selected?.id === agent.id ? null : agent);
              }
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 16, fontWeight: 600 }}>{agent.name}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {agent.default_agent && <Badge tone="accent">основной</Badge>}
                {agent.agent_status && (
                  <Badge tone={agent.agent_status === 'running' ? 'ok' : 'neutral'}>
                    {STATUS_LABEL[agent.agent_status] ?? agent.agent_status}
                  </Badge>
                )}
                {agent.agent_status === 'running' ? (
                  <button
                    data-agent-stop
                    title="Остановить агента"
                    aria-label="Остановить агента"
                    onClick={(e) => { e.stopPropagation(); toggleAgent(agent, 'stop'); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-muted)', lineHeight: 1 }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                  </button>
                ) : (
                  <button
                    data-agent-start
                    title="Запустить агента"
                    aria-label="Запустить агента"
                    onClick={(e) => { e.stopPropagation(); toggleAgent(agent, 'start'); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-muted)', lineHeight: 1 }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="7,5 19,12 7,19" /></svg>
                  </button>
                )}
              </div>
            </div>
            {agent.description && (
              <div style={{ fontSize: 13.5, color: 'var(--text-tertiary)', marginBottom: 4 }}>{agent.description}</div>
            )}
            {agent.model && (
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 4 }}>Модель: {agent.model}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-tertiary)' }}>
              <span>сообщений: {agent.message_count ?? 0}</span>
              {agent.last_active && <span>{agent.last_active}</span>}
            </div>
          </Card>
        ))}
      </div>

      {agents !== null && list.length === 0 && !loadError && (
        <EmptyState
          title="Агентов нет"
          hint="Агенты определяются в YAML-конфигурации гейтвея (секция agents) и появляются здесь после перезагрузки конфига."
        />
      )}

      {selected && (
        <div style={{ marginTop: 28 }}>
          <Card>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: 'var(--accent)' }}>
              {selected.name}
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 14 }}>
              <div>
                <span style={{ color: 'var(--text-tertiary)' }}>ID: </span>
                <span style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{selected.id}</span>
              </div>
              {selected.description && (
                <div>
                  <span style={{ color: 'var(--text-tertiary)' }}>Описание: </span>
                  <span>{selected.description}</span>
                </div>
              )}
              {selected.model && (
                <div>
                  <span style={{ color: 'var(--text-tertiary)' }}>Модель: </span>
                  <span>{selected.model}</span>
                </div>
              )}
              {selected.workspace && (
                <div>
                  <span style={{ color: 'var(--text-tertiary)' }}>Рабочая область: </span>
                  <span>{selected.workspace}</span>
                </div>
              )}
              <div>
                <span style={{ color: 'var(--text-tertiary)' }}>Статус: </span>
                <span>{selected.agent_status ? (STATUS_LABEL[selected.agent_status] ?? selected.agent_status) : 'неизвестно'}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-tertiary)' }}>Сообщений: </span>
                <span>{selected.message_count ?? 0}</span>
              </div>
              {selected.last_active && (
                <div>
                  <span style={{ color: 'var(--text-tertiary)' }}>Последняя активность: </span>
                  <span>{selected.last_active}</span>
                </div>
              )}
            </div>
          </Card>

          <Card style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Личность агента</h3>
                <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
                  Инструкции и роль этого агента — AGENT.md
                </p>
              </div>
              {!agentMdLoading && (
                <Button onClick={saveAgentMd} busy={agentMdSaving}>Сохранить</Button>
              )}
            </div>
            {agentMdLoading ? (
              <Skeleton lines={3} />
            ) : (
              <Textarea
                value={agentMd}
                onChange={(e) => setAgentMd(e.target.value)}
                style={{ minHeight: 180, fontFamily: 'monospace', fontSize: 13.5, lineHeight: 1.6 }}
              />
            )}
          </Card>

          <div style={{ marginTop: 16 }}>
            <AgentExtensions agentId={selected.id} />
          </div>
        </div>
      )}
    </div>
  );
}

export default Agents;
```

- [ ] **Step 2: Проверка + commit**

```bash
cd ui && npm run build && npm run test
git add ui/src/pages/Agents.tsx
git commit -m "feat(ui): migrate Agents page to ui library (honest save, toasts, keyboard access)"
```

---

### Task D2: Расширения агента (AgentExtensions.tsx)

**Files:**
- Modify: `ui/src/components/AgentExtensions.tsx` (полная замена, экспорт `formatFileSize` сохраняется — на нём тест)

Стили-константы → компоненты; самодельные вкладки → `Tabs`; `alert('Invalid JSON')` → toast; «Saved» → toast (проверка `res.ok` уже есть — сохранить); русификация. Кнопка загрузки файлов остаётся `<label>` (клик должен открывать нативный file-диалог) и стилизуется классами библиотеки `ui-btn ui-btn--secondary ui-btn--sm`.

- [ ] **Step 1: Полностью заменить `ui/src/components/AgentExtensions.tsx` на:**

```tsx
import { useState, useEffect } from 'react';
import { Badge, Button, Card, Input, Skeleton, Tabs, Textarea, useToast } from './ui';

interface MCPServerConfig {
  type: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

interface MarketplaceConfig {
  source: string;
  name?: string;
}

interface PluginConfig {
  name: string;
  disabled?: boolean;
  requires?: string[];
}

interface SkillConfig {
  description: string;
  content: string;
  requires?: string[];
  files?: Record<string, string>; // relative path -> base64-encoded content
}

interface PluginStatus {
  name: string;
  enabled: boolean;
}

interface ExtensionStatus {
  marketplaces?: string[];
  plugins?: PluginStatus[];
}

interface AgentExtensions {
  mcp_servers?: Record<string, MCPServerConfig>;
  marketplaces?: MarketplaceConfig[];
  plugins?: PluginConfig[];
  skills?: Record<string, SkillConfig>;
  _status?: ExtensionStatus;
}

const itemBox: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 12,
  marginBottom: 12,
  background: 'var(--bg-input)',
};

const rowBox: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '8px 12px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  marginBottom: 8,
  background: 'var(--bg-input)',
};

const mono: React.CSSProperties = { fontFamily: 'monospace' };

// MCP Servers tab
function MCPServersTab({
  servers,
  onChange,
}: {
  servers: Record<string, MCPServerConfig>;
  onChange: (servers: Record<string, MCPServerConfig>) => void;
}) {
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'' | 'stdio' | 'http'>('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editJSON, setEditJSON] = useState('');
  const toast = useToast();

  const addServer = () => {
    if (!newName.trim() || !newType) return;
    const base: MCPServerConfig =
      newType === 'stdio'
        ? { type: 'stdio', command: '', args: [], env: {} }
        : { type: newType, url: '', headers: {} };
    onChange({ ...servers, [newName.trim()]: base });
    setNewName('');
    setEditing(newName.trim());
    setEditJSON(JSON.stringify(base, null, 2));
  };

  const removeServer = (name: string) => {
    const next = { ...servers };
    delete next[name];
    onChange(next);
    if (editing === name) setEditing(null);
  };

  const saveEdit = () => {
    if (!editing) return;
    try {
      const parsed = JSON.parse(editJSON);
      onChange({ ...servers, [editing]: parsed });
      setEditing(null);
    } catch {
      toast.error('Некорректный JSON');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Имя сервера"
          style={{ width: 200 }}
          onKeyDown={(e) => e.key === 'Enter' && addServer()}
        />
        <select
          className="ui-input"
          value={newType}
          onChange={(e) => setNewType(e.target.value as 'stdio' | 'http')}
          style={{ width: 130 }}
        >
          <option value="" disabled>Транспорт</option>
          <option value="http">http</option>
          <option value="stdio">stdio</option>
        </select>
        <Button variant="secondary" size="sm" onClick={addServer}>Добавить</Button>
      </div>

      {Object.entries(servers).map(([name, srv]) => (
        <div key={name} style={itemBox}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div>
              <span style={{ fontWeight: 600 }}>{name}</span>
              <Badge tone="accent" style={{ marginLeft: 8 }}>{srv.type}</Badge>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setEditing(editing === name ? null : name);
                  setEditJSON(JSON.stringify(srv, null, 2));
                }}
              >
                {editing === name ? 'Отмена' : 'Изменить'}
              </Button>
              <Button variant="danger" size="sm" onClick={() => removeServer(name)}>Удалить</Button>
            </div>
          </div>
          {srv.type === 'stdio' && editing !== name && (
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', ...mono }}>
              {srv.command} {(srv.args || []).join(' ')}
            </div>
          )}
          {srv.type === 'http' && editing !== name && (
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', ...mono }}>{srv.url}</div>
          )}
          {editing === name && (
            <div style={{ marginTop: 8 }}>
              <Textarea
                value={editJSON}
                onChange={(e) => setEditJSON(e.target.value)}
                style={{ minHeight: 150, ...mono }}
              />
              <Button size="sm" style={{ marginTop: 8 }} onClick={saveEdit}>Применить</Button>
            </div>
          )}
        </div>
      ))}

      {Object.keys(servers).length === 0 && (
        <div style={{ color: 'var(--text-tertiary)', fontSize: 14 }}>MCP-серверы не настроены</div>
      )}
    </div>
  );
}

// Plugins tab (with marketplaces section)
function PluginsTab({
  marketplaces,
  plugins,
  status,
  onChangeMarketplaces,
  onChangePlugins,
}: {
  marketplaces: MarketplaceConfig[];
  plugins: PluginConfig[];
  status?: ExtensionStatus;
  onChangeMarketplaces: (marketplaces: MarketplaceConfig[]) => void;
  onChangePlugins: (plugins: PluginConfig[]) => void;
}) {
  const [newSource, setNewSource] = useState('');
  const [newPlugin, setNewPlugin] = useState('');

  const addMarketplace = () => {
    if (!newSource.trim()) return;
    onChangeMarketplaces([...marketplaces, { source: newSource.trim() }]);
    setNewSource('');
  };

  const removeMarketplace = (idx: number) => {
    onChangeMarketplaces(marketplaces.filter((_, i) => i !== idx));
  };

  const deriveName = (source: string): string => {
    return source.replace(/^https?:\/\//, '').replace(/[/.:]+/g, '-').replace(/-+$/, '');
  };

  const addPlugin = () => {
    if (!newPlugin.trim()) return;
    onChangePlugins([...plugins, { name: newPlugin.trim() }]);
    setNewPlugin('');
  };

  const removePlugin = (idx: number) => {
    onChangePlugins(plugins.filter((_, i) => i !== idx));
  };

  return (
    <div>
      <h4 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px' }}>Маркетплейсы</h4>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
        Добавьте источник (например, owner/repo) до установки его плагинов. Маркетплейс <code style={{ fontSize: 12 }}>claude-plugins-official</code> зарегистрирован по умолчанию.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <Input
          value={newSource}
          onChange={(e) => setNewSource(e.target.value)}
          placeholder="owner/repo или https://example.com/marketplace.json"
          style={{ flex: 1 }}
          onKeyDown={(e) => e.key === 'Enter' && addMarketplace()}
        />
        <Button variant="secondary" size="sm" onClick={addMarketplace}>Добавить</Button>
      </div>

      {marketplaces.map((m, i) => {
        const isInstalled = status?.marketplaces?.some(
          (line) => line.includes(m.source) || line.includes(m.name || deriveName(m.source))
        );
        return (
          <div key={i} style={rowBox}>
            <div>
              <span style={{ fontSize: 14, ...mono }}>{m.source}</span>
              <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-tertiary)' }}>
                ({m.name || deriveName(m.source)})
              </span>
              {isInstalled && <Badge tone="ok" style={{ marginLeft: 8 }}>зарегистрирован</Badge>}
            </div>
            <Button variant="danger" size="sm" onClick={() => removeMarketplace(i)}>Удалить</Button>
          </div>
        );
      })}

      {marketplaces.length === 0 && (
        <div style={{ color: 'var(--text-tertiary)', fontSize: 14, marginBottom: 16 }}>Дополнительных маркетплейсов нет</div>
      )}

      <h4 style={{ fontSize: 14, fontWeight: 600, margin: '20px 0 8px' }}>Плагины</h4>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <Input
          value={newPlugin}
          onChange={(e) => setNewPlugin(e.target.value)}
          placeholder="plugin-name@marketplace"
          style={{ flex: 1 }}
          onKeyDown={(e) => e.key === 'Enter' && addPlugin()}
        />
        <Button variant="secondary" size="sm" onClick={addPlugin}>Добавить</Button>
      </div>

      {plugins.map((p, i) => {
        const pluginBase = p.name.split('@')[0];
        const pluginStatus = status?.plugins?.find(
          (ps) => ps?.name && (ps.name === p.name || ps.name === pluginBase || ps.name.startsWith(pluginBase + '@'))
        );
        return (
          <div key={i} style={{ ...rowBox, opacity: p.disabled ? 0.6 : 1 }}>
            <div>
              <span style={{ fontSize: 14, ...mono }}>{p.name}</span>
              {pluginStatus && !p.disabled && <Badge tone="ok" style={{ marginLeft: 8 }}>установлен</Badge>}
              {p.disabled && <Badge tone="warn" style={{ marginLeft: 8 }}>отключён</Badge>}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const updated = [...plugins];
                  updated[i] = { ...p, disabled: !p.disabled };
                  onChangePlugins(updated);
                }}
              >
                {p.disabled ? 'Включить' : 'Отключить'}
              </Button>
              <Button variant="danger" size="sm" onClick={() => removePlugin(i)}>Удалить</Button>
            </div>
          </div>
        );
      })}

      {plugins.length === 0 && (
        <div style={{ color: 'var(--text-tertiary)', fontSize: 14 }}>Плагины не настроены</div>
      )}
    </div>
  );
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Skills tab
function SkillsTab({
  skills,
  onChange,
}: {
  skills: Record<string, SkillConfig>;
  onChange: (skills: Record<string, SkillConfig>) => void;
}) {
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editDesc, setEditDesc] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editFiles, setEditFiles] = useState<Record<string, string>>({});

  const addSkill = () => {
    if (!newName.trim()) return;
    const name = newName.trim().replace(/[^a-zA-Z0-9_-]/g, '-');
    onChange({ ...skills, [name]: { description: '', content: '' } });
    setNewName('');
    setEditing(name);
    setEditDesc('');
    setEditContent('');
    setEditFiles({});
  };

  const removeSkill = (name: string) => {
    const next = { ...skills };
    delete next[name];
    onChange(next);
    if (editing === name) setEditing(null);
  };

  const saveEdit = () => {
    if (!editing) return;
    const skill: SkillConfig = {
      description: editDesc,
      content: editContent,
      ...(skills[editing]?.requires ? { requires: skills[editing].requires } : {}),
      ...(Object.keys(editFiles).length > 0 ? { files: editFiles } : {}),
    };
    onChange({ ...skills, [editing]: skill });
    setEditing(null);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList) return;
    const newFiles = { ...editFiles };
    Array.from(fileList).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const arrayBuffer = reader.result as ArrayBuffer;
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const b64 = btoa(binary);
        newFiles[file.name] = b64;
        setEditFiles({ ...newFiles });
      };
      reader.readAsArrayBuffer(file);
    });
    e.target.value = '';
  };

  const removeFile = (path: string) => {
    const next = { ...editFiles };
    delete next[path];
    setEditFiles(next);
  };

  const renameFile = (oldPath: string, newPath: string) => {
    if (!newPath || newPath === oldPath) return;
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(editFiles)) {
      next[k === oldPath ? newPath : k] = v;
    }
    setEditFiles(next);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Имя навыка (например, code-review)"
          style={{ width: 300 }}
          onKeyDown={(e) => e.key === 'Enter' && addSkill()}
        />
        <Button variant="secondary" size="sm" onClick={addSkill}>Добавить</Button>
      </div>

      {Object.entries(skills).map(([name, skill]) => (
        <div key={name} style={itemBox}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div>
              <span style={{ fontWeight: 600 }}>{name}</span>
              {skill.files && Object.keys(skill.files).length > 0 && (
                <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-tertiary)' }}>
                  файлов: {Object.keys(skill.files).length}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  if (editing === name) {
                    setEditing(null);
                  } else {
                    setEditing(name);
                    setEditDesc(skill.description);
                    setEditContent(skill.content);
                    setEditFiles(skill.files ? { ...skill.files } : {});
                  }
                }}
              >
                {editing === name ? 'Отмена' : 'Изменить'}
              </Button>
              <Button variant="danger" size="sm" onClick={() => removeSkill(name)}>Удалить</Button>
            </div>
          </div>
          {editing !== name && skill.description && (
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{skill.description}</div>
          )}
          {editing === name && (
            <div style={{ marginTop: 8 }}>
              <Input
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                placeholder="Описание"
                style={{ marginBottom: 8 }}
              />
              <Textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                placeholder="Содержимое навыка (тело SKILL.md)"
                style={{ minHeight: 120, ...mono }}
              />

              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>Файлы</span>
                  <input
                    type="file"
                    multiple
                    onChange={handleFileUpload}
                    style={{ display: 'none' }}
                    id={`skill-files-${name}`}
                  />
                  <label htmlFor={`skill-files-${name}`} className="ui-btn ui-btn--secondary ui-btn--sm" style={{ display: 'inline-flex' }}>
                    Загрузить файлы
                  </label>
                </div>

                {Object.entries(editFiles).map(([path, b64]) => {
                  const sizeBytes = Math.floor(b64.length * 3 / 4);
                  return (
                    <div
                      key={path}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 10px',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        marginBottom: 6,
                        background: 'var(--bg-card)',
                      }}
                    >
                      <Input
                        defaultValue={path}
                        onBlur={(e) => renameFile(path, e.target.value.trim())}
                        style={{ flex: 1, fontSize: 13, ...mono }}
                        title="Относительный путь файла (например, scripts/search.sh)"
                      />
                      <span style={{ fontSize: 12, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                        {formatFileSize(sizeBytes)}
                      </span>
                      <Button variant="danger" size="sm" onClick={() => removeFile(path)}>Удалить</Button>
                    </div>
                  );
                })}

                {Object.keys(editFiles).length === 0 && (
                  <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
                    Дополнительных файлов нет. Загрузите скрипты или конфиги, которые пойдут рядом со SKILL.md.
                  </div>
                )}
              </div>

              <Button size="sm" style={{ marginTop: 8 }} onClick={saveEdit}>Применить</Button>
            </div>
          )}
        </div>
      ))}

      {Object.keys(skills).length === 0 && (
        <div style={{ color: 'var(--text-tertiary)', fontSize: 14 }}>Навыки не настроены</div>
      )}
    </div>
  );
}

// Main component
export default function AgentExtensionsPanel({ agentId }: { agentId: string }) {
  const [ext, setExt] = useState<AgentExtensions>({});
  const [tab, setTab] = useState('mcp');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/agents/definitions/${agentId}/extensions`)
      .then((res) => res.json())
      .then((data) => setExt(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [agentId]);

  const save = () => {
    setSaving(true);
    setError(null);
    // Strip _status (read-only runtime data) before saving
    const { _status, ...payload } = ext;
    fetch(`/api/agents/definitions/${agentId}/extensions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        toast.success('Сохранено');
      })
      .catch((err) => toast.error(`Не удалось сохранить расширения: ${err.message}`))
      .finally(() => setSaving(false));
  };

  if (loading) {
    return (
      <Card>
        <Skeleton lines={3} />
      </Card>
    );
  }

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Расширения</h3>
          <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
            MCP-серверы, плагины и навыки
          </p>
        </div>
        <Button onClick={save} busy={saving}>Сохранить</Button>
      </div>

      {error && (
        <div
          style={{
            padding: '8px 12px',
            background: 'var(--red-muted)',
            border: '1px solid var(--red)',
            borderRadius: 6,
            color: 'var(--red)',
            fontSize: 14,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      <Tabs
        tabs={[
          { id: 'mcp', label: 'MCP' },
          { id: 'plugins', label: 'Плагины' },
          { id: 'skills', label: 'Навыки' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'mcp' && (
        <MCPServersTab
          servers={ext.mcp_servers || {}}
          onChange={(servers) => setExt({ ...ext, mcp_servers: servers })}
        />
      )}
      {tab === 'plugins' && (
        <PluginsTab
          marketplaces={ext.marketplaces || []}
          plugins={ext.plugins || []}
          status={ext._status}
          onChangeMarketplaces={(marketplaces) => setExt({ ...ext, marketplaces })}
          onChangePlugins={(plugins) => setExt({ ...ext, plugins })}
        />
      )}
      {tab === 'skills' && (
        <SkillsTab skills={ext.skills || {}} onChange={(skills) => setExt({ ...ext, skills })} />
      )}
    </Card>
  );
}
```

Примечание: у `Select` из библиотеки нет варианта с шириной 130px без обёртки Field — для селектора транспорта оставлен нативный `<select className="ui-input">` (тот же вид). `_status` в деструктуризации `save` может дать предупреждение об unused-переменной — если `npm run build` ругается, заменить на `const payload = { ...ext }; delete payload._status;`.

- [ ] **Step 2: Проверка + commit**

```bash
cd ui && npx vitest run src/__tests__/format-file-size.test.ts && npm run build && npm run test
git add ui/src/components/AgentExtensions.tsx
git commit -m "feat(ui): migrate AgentExtensions to ui library (Tabs, toasts, russian labels)"
```

---

### Task D3: Арсенал (Catalog.tsx)

**Files:**
- Modify: `ui/src/pages/Catalog.tsx` (полная замена)

- [ ] **Step 1: Полностью заменить `ui/src/pages/Catalog.tsx` на:**

```tsx
import { useState, useEffect, useCallback } from 'react';
import {
  formatMemory, capabilityGroups,
  type CatalogResponse, type AgentCapabilities,
} from './catalogStatus';
import { Badge, Button, Card, EmptyState, PageHeader, Skeleton } from '../components/ui';

function AgentCard({ a }: { a: AgentCapabilities }) {
  const [open, setOpen] = useState(false);
  return (
    <Card style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <strong>{a.agent_id}</strong>
          {a.restricted && <Badge tone="danger" style={{ marginLeft: 8 }}>ограничен</Badge>}
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {a.model} · память: {formatMemory(a.memory)}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {capabilityGroups(a).map((g) => (
              <Badge key={g} tone="neutral">{g}</Badge>
            ))}
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setOpen((v) => !v)}>
          {open ? 'Скрыть' : 'Детали'}
        </Button>
      </div>
      {open && (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12, fontSize: 13.5 }}>
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
              : `MCP: ${a.extensions.mcp_servers.join(', ') || '—'}; навыки: ${a.extensions.skills.join(', ') || '—'}; плагины: ${a.extensions.plugins.join(', ') || '—'}`}
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
    </Card>
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
      <PageHeader title="Арсенал" subtitle="Каталог возможностей агентов: инструменты, память, расширения" />
      <Card style={{ marginBottom: 12, color: 'var(--text-secondary)' }}>
        Профиль пользователя: {data?.user_profile_present ? 'задан' : 'не задан'}
      </Card>
      {data === null && <Skeleton lines={3} />}
      {data !== null && data.agents.length === 0 && (
        <EmptyState
          title="Нет агентов"
          hint="Каталог собирается из определений агентов и их отчётов о памяти."
        />
      )}
      {(data?.agents ?? []).map((a) => <AgentCard key={a.agent_id} a={a} />)}
    </div>
  );
}

export default Catalog;
```

- [ ] **Step 2: Проверка + commit**

```bash
cd ui && npx vitest run src/pages/__tests__/catalogStatus.test.ts && npm run build
git add ui/src/pages/Catalog.tsx
git commit -m "feat(ui): migrate Catalog page to ui library"
```

---

### Task D4: Сейф (Secrets.tsx)

**Files:**
- Modify: `ui/src/pages/Secrets.tsx` (полная замена)

`confirm()` → ConfirmDialog; чипы назначения агентов (label + скрытый checkbox) → настоящие кнопки с `aria-pressed`; поллинг 5 с сохраняется (изменения приходят из CLI).

- [ ] **Step 1: Полностью заменить `ui/src/pages/Secrets.tsx` на:**

```tsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, PageHeader,
  Select, Skeleton, Textarea, useToast,
} from '../components/ui';

interface Secret {
  id: string;
  name: string;
  description: string;
  kind: string;
  filename?: string;
  global: boolean;
  agent_ids: string[];
  created_at: string;
  updated_at: string;
}

interface Agent {
  id: string;
  name: string;
}

interface SecretForm {
  name: string;
  description: string;
  kind: string;
  filename: string;
  value: string;
  global: boolean;
  agent_ids: string[];
}

const emptyForm: SecretForm = { name: '', description: '', kind: 'string', filename: '', value: '', global: false, agent_ids: [] };

function Secrets() {
  const [secrets, setSecrets] = useState<Secret[] | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [form, setForm] = useState<SecretForm>(emptyForm);
  const [editing, setEditing] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const toast = useToast();
  const { events } = useWebSocket();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const fetchSecrets = useCallback(() => {
    fetch('/api/secrets')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setSecrets(Array.isArray(data) ? data : []);
        setLoadError(null);
      })
      .catch((err) => setLoadError(err.message));
  }, []);

  const fetchAgents = useCallback(() => {
    fetch('/api/agents/definitions')
      .then((res) => res.json())
      .then((data) => setAgents(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchSecrets();
    fetchAgents();
    // Poll for changes from external sources (CLI, etc.)
    const interval = setInterval(fetchSecrets, 5000);
    return () => clearInterval(interval);
  }, [fetchSecrets, fetchAgents]);

  // Re-fetch immediately on WebSocket secret events (debounced)
  useEffect(() => {
    if (events.length === 0) return;
    const last = events[events.length - 1];
    if (typeof last.type === 'string' && last.type.startsWith('events.secret.')) {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(fetchSecrets, 500);
    }
  }, [events.length, fetchSecrets]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const url = editing ? `/api/secrets/${editing}` : '/api/secrets';
      const method = editing ? 'PUT' : 'POST';

      const body: Record<string, unknown> = {
        name: form.name,
        description: form.description,
        kind: form.kind,
        global: form.global,
        agent_ids: form.agent_ids,
      };

      if (form.kind === 'file') {
        body.filename = form.filename;
      }

      // Only send value if creating or if value was provided (not empty)
      if (!editing || form.value) {
        body.value = form.value;
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      toast.success(editing ? 'Секрет обновлён' : 'Секрет создан');
      setForm(emptyForm);
      setEditing(null);
      setShowForm(false);
      fetchSecrets();
    } catch (err) {
      toast.error(`Не удалось сохранить: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const confirmDelete = async () => {
    if (!confirmDeleteId) return;
    setConfirmBusy(true);
    try {
      const res = await fetch(`/api/secrets/${confirmDeleteId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setConfirmDeleteId(null);
      fetchSecrets();
    } catch (err) {
      toast.error(`Не удалось удалить: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setConfirmBusy(false);
    }
  };

  const handleEdit = (secret: Secret) => {
    const validAgentIds = new Set(agents.map((a) => a.id));
    setForm({
      name: secret.name,
      description: secret.description || '',
      kind: secret.kind,
      filename: secret.filename || '',
      value: '',
      global: secret.global,
      agent_ids: (secret.agent_ids || []).filter((id) => validAgentIds.has(id)),
    });
    setEditing(secret.id);
    setShowForm(true);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setForm((f) => ({ ...f, filename: file.name }));
    const reader = new FileReader();
    reader.onload = () => {
      setForm((f) => ({ ...f, value: reader.result as string }));
    };
    reader.readAsText(file);
  };

  const toggleAgent = (agentId: string) => {
    setForm((f) => ({
      ...f,
      agent_ids: f.agent_ids.includes(agentId)
        ? f.agent_ids.filter((id) => id !== agentId)
        : [...f.agent_ids, agentId],
    }));
  };

  const agentNameMap = agents.reduce<Record<string, string>>((acc, a) => {
    acc[a.id] = a.name;
    return acc;
  }, {});

  const list = secrets ?? [];

  return (
    <div>
      <PageHeader
        title="Сейф"
        subtitle="Секреты: зашифрованы AES-256-GCM, передаются агентам как переменные окружения или файлы"
        actions={
          <Button onClick={() => { setForm(emptyForm); setEditing(null); setShowForm(!showForm); }}>
            {showForm ? 'Отмена' : '+ Новый секрет'}
          </Button>
        }
      />

      {loadError && (
        <Card style={{ color: 'var(--red)', marginBottom: 16 }}>
          Не удалось загрузить секреты: {loadError}
        </Card>
      )}

      {showForm && (
        <Card style={{ marginBottom: 20 }}>
          <form onSubmit={handleSubmit}>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
              {editing ? 'Изменить секрет' : 'Новый секрет'}
            </h3>
            <div className="form-grid-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <Field label="Название">
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="github-token"
                  required
                  disabled={!!editing}
                />
              </Field>
              <Field label="Тип">
                <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                  <option value="string">строка</option>
                  <option value="file">файл</option>
                </Select>
              </Field>
              <div style={{ gridColumn: '1 / -1' }}>
                <Field label="Описание">
                  <Input
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Необязательное описание"
                  />
                </Field>
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <Field label={editing ? 'Значение (пусто — оставить прежнее)' : 'Значение'}>
                {form.kind === 'file' ? (
                  <input
                    type="file"
                    onChange={handleFileChange}
                    style={{ fontSize: 14, color: 'var(--text-primary)' }}
                  />
                ) : (
                  <Textarea
                    value={form.value}
                    onChange={(e) => setForm({ ...form, value: e.target.value })}
                    placeholder="Значение секрета"
                    required={!editing}
                  />
                )}
              </Field>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.global}
                  onChange={(e) => setForm({ ...form, global: e.target.checked })}
                />
                Общий (доступен всем агентам)
              </label>
            </div>

            {agents.length > 0 && !form.global && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500, marginBottom: 8 }}>
                  Назначить агентам
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {agents.map((a) => {
                    const active = form.agent_ids.includes(a.id);
                    return (
                      <Button
                        key={a.id}
                        type="button"
                        variant="secondary"
                        size="sm"
                        aria-pressed={active}
                        style={active ? { background: 'var(--accent-muted)', color: 'var(--accent)', borderColor: 'var(--accent)' } : undefined}
                        onClick={() => toggleAgent(a.id)}
                      >
                        {a.name}
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}

            <Button type="submit">{editing ? 'Сохранить' : 'Создать'}</Button>
          </form>
        </Card>
      )}

      {secrets === null && !loadError && <Skeleton lines={4} />}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {list.map((secret) => (
          <Card key={secret.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{ fontSize: 16, fontWeight: 600 }}>{secret.name}</span>
                  <Badge tone={secret.kind === 'string' ? 'accent' : 'warn'}>
                    {secret.kind === 'string' ? 'строка' : 'файл'}
                  </Badge>
                  {secret.global && <Badge tone="ok">общий</Badge>}
                </div>

                {secret.description && (
                  <div style={{ fontSize: 13.5, color: 'var(--text-tertiary)', marginBottom: 8 }}>
                    {secret.description}
                  </div>
                )}

                <div style={{ fontSize: 13.5, color: 'var(--text-muted)', marginBottom: 4, fontFamily: 'monospace' }}>
                  {'*'.repeat(12)}
                </div>

                {secret.agent_ids && secret.agent_ids.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                    {secret.agent_ids.map((id) => (
                      <Badge key={id} tone="neutral">{agentNameMap[id] || id}</Badge>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginLeft: 16 }}>
                <Button variant="secondary" size="sm" onClick={() => handleEdit(secret)}>Изменить</Button>
                <Button variant="danger" size="sm" onClick={() => setConfirmDeleteId(secret.id)}>Удалить</Button>
              </div>
            </div>
          </Card>
        ))}
        {secrets !== null && list.length === 0 && !loadError && (
          <EmptyState
            title="Сейф пуст"
            hint="Секреты хранятся в зашифрованном виде и никогда не показываются агентам напрямую: они подставляются в контейнер как переменные окружения (secret:имя) или файлы."
            action={
              <Button onClick={() => { setForm(emptyForm); setEditing(null); setShowForm(true); }}>
                + Новый секрет
              </Button>
            }
          />
        )}
      </div>

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Удалить секрет?"
        message="Агенты, которым он назначен, потеряют к нему доступ при следующем запуске."
        confirmLabel="Удалить"
        danger
        busy={confirmBusy}
        onConfirm={confirmDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}

export default Secrets;
```

- [ ] **Step 2: Проверка + commit**

```bash
cd ui && npm run build && npm run test
git add ui/src/pages/Secrets.tsx
git commit -m "feat(ui): migrate Secrets page to ui library (ConfirmDialog, aria-pressed agent chips)"
```

---

### Task D5: Досье (UserProfile.tsx)

**Files:**
- Modify: `ui/src/pages/UserProfile.tsx` (полная замена)

Честный «Сохранено» (сейчас `res.ok` не проверяется, «Saved» показывается всегда); `console.error` → toast; русский подзаголовок.

- [ ] **Step 1: Полностью заменить `ui/src/pages/UserProfile.tsx` на:**

```tsx
import { useState, useEffect, useCallback } from 'react';
import { Button, Card, PageHeader, Skeleton, Textarea, useToast } from '../components/ui';

export default function UserProfile() {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const fetchProfile = useCallback(async () => {
    try {
      const res = await fetch('/api/user-profile');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setContent(data.content || '');
    } catch (err) {
      toast.error(`Не удалось загрузить досье: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/user-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Сохранено');
    } catch (err) {
      toast.error(`Не удалось сохранить: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Досье"
        subtitle="Личная информация, доступная всем агентам через USER.md"
        actions={<Button onClick={handleSave} busy={saving} disabled={loading}>Сохранить</Button>}
      />

      <Card>
        {loading ? (
          <Skeleton lines={6} />
        ) : (
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            style={{ minHeight: 400, fontFamily: 'monospace', fontSize: 14, lineHeight: 1.6 }}
            placeholder="# User Profile&#10;&#10;## Name&#10;..."
          />
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Проверка + commit + PR части D**

```bash
cd ui && npm run build && npm run test
git add ui/src/pages/UserProfile.tsx
git commit -m "feat(ui): migrate UserProfile page to ui library (honest save with res.ok check)"
```

Ручная проверка (`npm run dev`, десктоп + мобильная): Агенты (карточки, выбор, AGENT.md, вкладки расширений), Арсенал, Сейф (форма, чипы агентов, удаление через диалог), Досье (сохранение). Остановить.

```bash
git push -u origin feature/shtab-3-system
gh pr create --title "feat(ui): Штаб этап 3d — миграция группы «Система»" --body "Этап 3 по спеке _specs/2026-07-04-shtab-ux-design.md (§8): Агенты (+Расширения), Арсенал, Сейф, Досье на библиотеке компонентов. Честный «Сохранено» после res.ok (Agents/Досье), ConfirmDialog вместо confirm(), toggle-чипы агентов — настоящие кнопки с aria-pressed, русский копирайт.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Expected: PR создан. Merge — только Alex.

---

## Что НЕ входит в этот план

- **Этап 4** — чат «Связь» (backend-endpoint + миграция Conversations).
- **Этап 5** — новая «Обстановка» (Dashboard).
- **Этап 6** — тач-редактор SwarmGraph и мобильная полировка; **там же** — удаление легаси hover-правил из base.css и алиасов токенов (после того как Dashboard/Conversations/Login перестанут ими пользоваться).
- Изменения бэкенда — их в этапе 3 нет вовсе.

## Заметки для исполнителей

- Если какой-то файл на момент исполнения отличается от приведённого «старого» состояния (main мог уехать) — сначала `git log --oneline -3 -- <файл>`, понять что изменилось, и перенести это изменение в новую версию, а не затирать.
- Тесты `Reception.test.tsx`/`Recon.test.tsx` могут потребовать обёртку `<ToastProvider>` после миграции контентов — оборачивать рендер, не менять проверяемое поведение.
- После merge всех 4 PR: пометить в memory `shtab-ux-redesign` этап 3 завершённым, следующий — план этапа 4 («Связь»).




