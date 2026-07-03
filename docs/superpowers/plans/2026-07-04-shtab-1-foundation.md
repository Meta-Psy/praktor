# Штаб, этап 1: Фундамент (токены + библиотека компонентов) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дизайн-токены в CSS-файлах вместо `<style>` в index.html + библиотека UI-компонентов (`ui/src/components/ui/`) с тестами. Видимый вид приложения не меняется; страницы мигрируют на компоненты в этапе 3.

**Architecture:** Токены (CSS-переменные, обе темы) — `ui/src/styles/tokens.css`; глобальные стили — `ui/src/styles/base.css`; оба импортируются из `main.tsx`, `<style>` из `index.html` удаляется. Компоненты — по файлу на компонент в `ui/src/components/ui/` с co-located CSS (класс-префикс `ui-`) и тестом рядом. Иконки выносятся из App.tsx в `ui/src/components/icons.tsx`.

**Tech Stack:** React 19, TypeScript strict, vitest + jsdom + @testing-library/react (всё уже в devDependencies), обычные CSS-файлы через Vite.

**Спека:** `_specs/2026-07-04-shtab-ux-design.md` (§6 — дизайн-система). Этап 1 из §10.

**Рабочая директория:** все команды — из `C:\Users\Alex\10_Projects\praktor` (пути от корня репо). Тесты/сборка UI запускаются из `ui/`.

---

### Task 0: Ветка

- [ ] **Step 1: Создать ветку от свежего main**

```bash
git checkout main && git pull --ff-only && git checkout -b feature/shtab-1-foundation
```

Expected: ветка `feature/shtab-1-foundation` создана. (Hard rule Alex: никаких коммитов в main.)

---

### Task 1: Дизайн-токены и глобальные стили

**Files:**
- Create: `ui/src/styles/tokens.css`
- Create: `ui/src/styles/base.css`
- Modify: `ui/index.html` (удалить `<style>`)
- Modify: `ui/src/main.tsx` (импорт CSS)

Токены = текущие переменные из `ui/index.html:15-69` + недостающие, на которые уже ссылается код (`--danger`, `--green-light`, `--bg-primary`, `--bg-secondary`, `--bg-main`) + токены радиусов для будущих компонентов.

- [ ] **Step 1: Создать `ui/src/styles/tokens.css`**

```css
/* Дизайн-токены Штаба. Единственный источник цветов/радиусов.
   Тема переключается атрибутом data-theme на <html>. */
:root, [data-theme="dark"] {
  --bg-body: #0b0b0f;
  --bg-sidebar: #101014;
  --bg-card: #15151a;
  --bg-card-hover: #1a1a20;
  --bg-input: #0e0e13;
  --bg-elevated: #1c1c22;
  --border: #1f1f28;
  --border-subtle: #18181f;
  --text-primary: #e4e4ea;
  --text-secondary: #8a8a96;
  --text-tertiary: #5a5a66;
  --text-muted: #44444f;
  --accent: #6366f1;
  --accent-hover: #5558e6;
  --accent-muted: rgba(99, 102, 241, 0.12);
  --green: #22c55e;
  --green-muted: rgba(34, 197, 94, 0.12);
  --green-light: #4ade80;
  --amber: #eab308;
  --amber-muted: rgba(234, 179, 8, 0.12);
  --red: #ef4444;
  --red-muted: rgba(239, 68, 68, 0.12);
  --red-light: #f87171;
  --shadow: 0 1px 3px rgba(0,0,0,0.4);
  --shadow-lg: 0 4px 12px rgba(0,0,0,0.5);
  color-scheme: dark;
}

[data-theme="light"] {
  --bg-body: #f4f4f8;
  --bg-sidebar: #ffffff;
  --bg-card: #ffffff;
  --bg-card-hover: #f8f8fb;
  --bg-input: #f0f0f4;
  --bg-elevated: #f6f6fa;
  --border: #e0e0e8;
  --border-subtle: #e8e8ef;
  --text-primary: #18181b;
  --text-secondary: #6b6b78;
  --text-tertiary: #9b9ba8;
  --text-muted: #b0b0bc;
  --accent: #6366f1;
  --accent-hover: #5558e6;
  --accent-muted: rgba(99, 102, 241, 0.08);
  --green: #16a34a;
  --green-muted: rgba(22, 163, 74, 0.10);
  --green-light: #16a34a;
  --amber: #ca8a04;
  --amber-muted: rgba(202, 138, 4, 0.10);
  --red: #dc2626;
  --red-muted: rgba(220, 38, 38, 0.08);
  --red-light: #dc2626;
  --shadow: 0 1px 3px rgba(0,0,0,0.06);
  --shadow-lg: 0 4px 12px rgba(0,0,0,0.08);
  color-scheme: light;
}

/* Алиасы: код местами ссылается на эти имена (Login, Projects, Agents).
   Указывают на канонические токены — не использовать в новом коде. */
:root {
  --danger: var(--red);
  --danger-muted: var(--red-muted);
  --bg-primary: var(--bg-body);
  --bg-secondary: var(--bg-card);
  --bg-main: var(--bg-input);
}

/* Форма и типографика */
:root {
  --radius-sm: 7px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --font-body: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}
```

- [ ] **Step 2: Создать `ui/src/styles/base.css`** — перенос остального `<style>` из index.html без изменений поведения:

```css
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: var(--font-body);
  background: var(--bg-body);
  color: var(--text-primary);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Scrollbar */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }

/* Плавная смена темы */
body, aside, main, div, span, h1, h2, h3, h4, p, a, button, input, textarea, select, form, label {
  transition: background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}

/* Hover-эффекты (легаси-атрибуты страниц; уйдут в этапе 3) */
button, a, [data-hover] {
  transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease, filter 0.15s ease;
}
button:hover:not(:disabled) {
  filter: brightness(1.15);
  border-color: var(--text-muted) !important;
}
nav a:not(.active):hover {
  background: var(--bg-card-hover) !important;
  color: var(--text-primary) !important;
}
[data-hover]:hover {
  background: var(--bg-card-hover) !important;
  border-color: var(--text-muted) !important;
}
[data-agent-start]:hover { color: var(--green) !important; filter: none !important; border-color: transparent !important; }
[data-agent-stop]:hover { color: var(--red) !important; filter: none !important; border-color: transparent !important; }

/* Мобильная база */
@media (max-width: 768px) {
  .sidebar { transform: translateX(-100%); transition: transform 0.25s ease; }
  .sidebar.open { transform: translateX(0); }
  .main-content { margin-left: 0 !important; padding: 16px !important; padding-top: 64px !important; }
  .hamburger { display: flex !important; }
  .sidebar-backdrop { display: block !important; }
  .stats-grid { grid-template-columns: 1fr !important; }
  .conversations-layout { flex-direction: column; height: auto !important; min-height: 0 !important; }
  .conversations-agents { width: 100% !important; max-height: 150px; }
  .form-grid-2col { grid-template-columns: 1fr !important; }
}
```

- [ ] **Step 3: Подключить CSS в `ui/src/main.tsx`** — добавить первыми строками импортов:

```ts
import './styles/tokens.css';
import './styles/base.css';
```

- [ ] **Step 4: Удалить весь блок `<style>…</style>` из `ui/index.html`** (строки 12–155). Остальное (meta, favicon, title) не трогать.

- [ ] **Step 5: Проверить сборку и вид**

```bash
cd ui && npm run build && npm run test
```

Expected: build OK, существующие тесты (`*Status.test.ts` и пр.) зелёные.

```bash
cd ui && npm run dev
```

Открыть http://localhost:5173 — вид идентичен прежнему (обе темы переключаются, hover'ы работают, мобильный сайдбар открывается). Остановить dev-сервер.

- [ ] **Step 6: Commit**

```bash
git add ui/src/styles ui/index.html ui/src/main.tsx
git commit -m "refactor(ui): extract design tokens and base styles from index.html"
```

---

### Task 2: Иконки — из App.tsx в модуль

**Files:**
- Create: `ui/src/components/icons.tsx`
- Modify: `ui/src/App.tsx`

- [ ] **Step 1: Создать `ui/src/components/icons.tsx`** — перенести **без изменений** все 17 функций-иконок из `ui/src/App.tsx:21-204` (IconDashboard, IconAgents, IconConversations, IconTasks, IconSwarms, IconSecrets, IconUser, IconGitHub, IconSun, IconMoon, IconLogout, IconProjects, IconPortfolio, IconIntake, IconPlans, IconCatalog, IconRadar, IconIntel), добавив каждой `export`:

```tsx
export function IconDashboard() {
  // ... тело без изменений из App.tsx
}
// ... и так все 17
```

- [ ] **Step 2: В `ui/src/App.tsx`** удалить эти функции и добавить именованный импорт:

```tsx
import {
  IconDashboard, IconAgents, IconConversations, IconTasks, IconSwarms,
  IconSecrets, IconUser, IconGitHub, IconSun, IconMoon, IconLogout,
  IconProjects, IconPortfolio, IconIntake, IconPlans, IconCatalog,
  IconRadar, IconIntel,
} from './components/icons';
```

- [ ] **Step 3: Проверка и commit**

```bash
cd ui && npm run build
git add ui/src/components/icons.tsx ui/src/App.tsx
git commit -m "refactor(ui): move nav icons to components/icons module"
```

---

### Task 3: Button

**Files:**
- Create: `ui/src/components/ui/Button.tsx`
- Create: `ui/src/components/ui/Button.css`
- Test: `ui/src/components/ui/Button.test.tsx`

- [ ] **Step 1: Написать падающий тест `ui/src/components/ui/Button.test.tsx`**

```tsx
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { Button } from './Button';

afterEach(cleanup);

test('рендерит текст и variant-класс', () => {
  render(<Button variant="danger">Удалить</Button>);
  const btn = screen.getByRole('button', { name: 'Удалить' });
  expect(btn.className).toContain('ui-btn--danger');
});

test('primary по умолчанию', () => {
  render(<Button>Ок</Button>);
  expect(screen.getByRole('button').className).toContain('ui-btn--primary');
});

test('busy блокирует кнопку', () => {
  render(<Button busy>Сохранить</Button>);
  expect(screen.getByRole('button')).toBeDisabled();
});
```

В этом же шаге (обязательно, иначе матчеры jest-dom не зарегистрированы — в `vitest.config.ts` сейчас нет `setupFiles`): создать `ui/src/test-setup.ts` с содержимым `import '@testing-library/jest-dom/vitest';` и добавить в блок `test` файла `ui/vitest.config.ts` строку `setupFiles: ['./src/test-setup.ts'],`. Последующие задачи этим пользуются.

- [ ] **Step 2: Убедиться, что тест падает**

```bash
cd ui && npx vitest run src/components/ui/Button.test.tsx
```

Expected: FAIL — `Cannot find module './Button'`.

- [ ] **Step 3: Создать `ui/src/components/ui/Button.tsx`**

```tsx
import type { ButtonHTMLAttributes } from 'react';
import './Button.css';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'sm' | 'md';
  busy?: boolean;
};

export function Button({
  variant = 'primary',
  size = 'md',
  busy = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  const cls = ['ui-btn', `ui-btn--${variant}`, `ui-btn--${size}`, className]
    .filter(Boolean)
    .join(' ');
  return (
    <button className={cls} disabled={disabled || busy} {...rest}>
      {busy && <span className="ui-btn__spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
```

- [ ] **Step 4: Создать `ui/src/components/ui/Button.css`**

```css
.ui-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.ui-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.ui-btn--md { padding: 8px 16px; font-size: 14px; }
.ui-btn--sm { padding: 5px 12px; font-size: 12.5px; }
.ui-btn--primary { background: var(--accent); color: #fff; }
.ui-btn--primary:hover:not(:disabled) { background: var(--accent-hover); }
.ui-btn--secondary { background: transparent; border-color: var(--border); color: var(--text-secondary); }
.ui-btn--secondary:hover:not(:disabled) { color: var(--text-primary); }
.ui-btn--danger { background: transparent; border-color: var(--red-muted); color: var(--red); }
.ui-btn--danger:hover:not(:disabled) { background: var(--red-muted); }
.ui-btn__spinner {
  width: 12px; height: 12px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: ui-spin 0.7s linear infinite;
}
@keyframes ui-spin { to { transform: rotate(360deg); } }
```

- [ ] **Step 5: Тест зелёный + commit**

```bash
cd ui && npx vitest run src/components/ui/Button.test.tsx
```

Expected: PASS (3 теста).

```bash
git add ui/src/components/ui/Button.tsx ui/src/components/ui/Button.css ui/src/components/ui/Button.test.tsx ui/src/test-setup.ts ui/vitest.config.ts
git commit -m "feat(ui): Button component (primary/secondary/danger, busy state)"
```

(`test-setup.ts`/`vitest.config.ts` — только если менялись в Step 1.)

---

### Task 4: Card, Badge, PageHeader

**Files:**
- Create: `ui/src/components/ui/Card.tsx`, `Card.css`
- Create: `ui/src/components/ui/Badge.tsx`, `Badge.css`
- Create: `ui/src/components/ui/PageHeader.tsx`, `PageHeader.css`
- Test: `ui/src/components/ui/Badge.test.tsx`

- [ ] **Step 1: Падающий тест `ui/src/components/ui/Badge.test.tsx`**

```tsx
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { Badge } from './Badge';

afterEach(cleanup);

test('tone задаёт класс', () => {
  render(<Badge tone="ok">вкл</Badge>);
  expect(screen.getByText('вкл').className).toContain('ui-badge--ok');
});

test('neutral по умолчанию', () => {
  render(<Badge>выкл</Badge>);
  expect(screen.getByText('выкл').className).toContain('ui-badge--neutral');
});
```

- [ ] **Step 2: Убедиться, что падает**

```bash
cd ui && npx vitest run src/components/ui/Badge.test.tsx
```

Expected: FAIL — `Cannot find module './Badge'`.

- [ ] **Step 3: Создать компоненты**

`ui/src/components/ui/Badge.tsx`:

```tsx
import type { HTMLAttributes } from 'react';
import './Badge.css';

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: 'ok' | 'warn' | 'danger' | 'accent' | 'neutral';
};

export function Badge({ tone = 'neutral', className, children, ...rest }: BadgeProps) {
  const cls = ['ui-badge', `ui-badge--${tone}`, className].filter(Boolean).join(' ');
  return (
    <span className={cls} {...rest}>
      {children}
    </span>
  );
}
```

`ui/src/components/ui/Badge.css`:

```css
.ui-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 600;
  line-height: 1.6;
}
.ui-badge--ok { background: var(--green-muted); color: var(--green); }
.ui-badge--warn { background: var(--amber-muted); color: var(--amber); }
.ui-badge--danger { background: var(--red-muted); color: var(--red); }
.ui-badge--accent { background: var(--accent-muted); color: var(--accent); }
.ui-badge--neutral { background: var(--bg-elevated); color: var(--text-secondary); }
```

`ui/src/components/ui/Card.tsx`:

```tsx
import type { HTMLAttributes } from 'react';
import './Card.css';

type CardProps = HTMLAttributes<HTMLDivElement> & {
  interactive?: boolean;
};

export function Card({ interactive = false, className, children, ...rest }: CardProps) {
  const cls = ['ui-card', interactive ? 'ui-card--interactive' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} {...(interactive ? { 'data-hover': true } : {})} {...rest}>
      {children}
    </div>
  );
}
```

`ui/src/components/ui/Card.css`:

```css
.ui-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 16px;
}
.ui-card--interactive { cursor: pointer; }
```

`ui/src/components/ui/PageHeader.tsx`:

```tsx
import type { ReactNode } from 'react';
import './PageHeader.css';

type PageHeaderProps = {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
};

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="ui-page-header">
      <div>
        <h1 className="ui-page-header__title">{title}</h1>
        {subtitle && <div className="ui-page-header__subtitle">{subtitle}</div>}
      </div>
      {actions && <div className="ui-page-header__actions">{actions}</div>}
    </header>
  );
}
```

`ui/src/components/ui/PageHeader.css`:

```css
.ui-page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}
.ui-page-header__title { font-size: 22px; font-weight: 700; letter-spacing: -0.01em; }
.ui-page-header__subtitle { color: var(--text-secondary); font-size: 13.5px; margin-top: 4px; }
.ui-page-header__actions { display: flex; gap: 8px; flex-shrink: 0; }
```

- [ ] **Step 4: Тесты зелёные + commit**

```bash
cd ui && npx vitest run src/components/ui
```

Expected: PASS (Button + Badge).

```bash
git add ui/src/components/ui
git commit -m "feat(ui): Card, Badge, PageHeader components"
```

---

### Task 5: Поля форм — Field, Input, Textarea, Select

**Files:**
- Create: `ui/src/components/ui/Field.tsx`, `Field.css`

- [ ] **Step 1: Создать `ui/src/components/ui/Field.tsx`** (обёртка с label + стилизованные нативные элементы; React 19 — ref передаётся обычным пропом, forwardRef не нужен):

```tsx
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import './Field.css';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="ui-field">
      <span className="ui-field__label">{label}</span>
      {children}
    </label>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={['ui-input', className].filter(Boolean).join(' ')} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={['ui-input', 'ui-input--area', className].filter(Boolean).join(' ')} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={['ui-input', className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </select>
  );
}
```

- [ ] **Step 2: Создать `ui/src/components/ui/Field.css`**

```css
.ui-field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
.ui-field__label { color: var(--text-secondary); font-weight: 500; }
.ui-input {
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font: inherit;
  font-size: 14px;
  padding: 8px 11px;
  width: 100%;
  min-height: 38px;
}
.ui-input:focus { outline: none; border-color: var(--accent); }
.ui-input--area { resize: vertical; min-height: 90px; }
```

- [ ] **Step 3: Сборка + commit**

```bash
cd ui && npm run build
git add ui/src/components/ui/Field.tsx ui/src/components/ui/Field.css
git commit -m "feat(ui): Field, Input, Textarea, Select form components"
```

---

### Task 6: Modal и ConfirmDialog

**Files:**
- Create: `ui/src/components/ui/Modal.tsx`, `Modal.css`
- Create: `ui/src/components/ui/ConfirmDialog.tsx`
- Test: `ui/src/components/ui/ConfirmDialog.test.tsx`

- [ ] **Step 1: Падающий тест `ui/src/components/ui/ConfirmDialog.test.tsx`**

```tsx
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

afterEach(cleanup);

test('closed — ничего не рендерит', () => {
  render(
    <ConfirmDialog open={false} title="Удалить?" onConfirm={() => {}} onCancel={() => {}} />
  );
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('confirm вызывает onConfirm', () => {
  const onConfirm = vi.fn();
  render(
    <ConfirmDialog open title="Удалить отряд?" confirmLabel="Удалить" danger onConfirm={onConfirm} onCancel={() => {}} />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
  expect(onConfirm).toHaveBeenCalledOnce();
});

test('Escape вызывает onCancel', () => {
  const onCancel = vi.fn();
  render(<ConfirmDialog open title="Удалить?" onConfirm={() => {}} onCancel={onCancel} />);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onCancel).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Убедиться, что падает**

```bash
cd ui && npx vitest run src/components/ui/ConfirmDialog.test.tsx
```

Expected: FAIL — `Cannot find module './ConfirmDialog'`.

- [ ] **Step 3: Создать `ui/src/components/ui/Modal.tsx`**

```tsx
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './Modal.css';

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
};

const FOCUSABLE = 'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, children }: ModalProps) {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const box = boxRef.current;
    box?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Tab' && box) {
        // Фокус-ловушка: Tab циклится внутри модалки
        const items = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="ui-modal-backdrop" onClick={onClose}>
      <div
        className="ui-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={boxRef}
        onClick={(e) => e.stopPropagation()}
      >
        {title && <h3 className="ui-modal__title">{title}</h3>}
        {children}
      </div>
    </div>,
    document.body
  );
}
```

- [ ] **Step 4: Создать `ui/src/components/ui/Modal.css`**

```css
.ui-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 20px;
}
.ui-modal {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: 20px;
  width: 100%;
  max-width: 440px;
  max-height: 85vh;
  overflow-y: auto;
}
.ui-modal__title { font-size: 16px; font-weight: 700; margin-bottom: 12px; }
@media (max-width: 768px) {
  /* bottom-sheet на телефоне */
  .ui-modal-backdrop { align-items: flex-end; padding: 0; }
  .ui-modal { max-width: none; border-radius: var(--radius-lg) var(--radius-lg) 0 0; }
}
```

- [ ] **Step 5: Создать `ui/src/components/ui/ConfirmDialog.tsx`**

```tsx
import type { ReactNode } from 'react';
import { Button } from './Button';
import { Modal } from './Modal';

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Подтвердить',
  cancelLabel = 'Отмена',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      {message && <div style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 16 }}>{message}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} busy={busy}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 6: Тесты зелёные + commit**

```bash
cd ui && npx vitest run src/components/ui/ConfirmDialog.test.tsx
```

Expected: PASS (3 теста).

```bash
git add ui/src/components/ui/Modal.tsx ui/src/components/ui/Modal.css ui/src/components/ui/ConfirmDialog.tsx ui/src/components/ui/ConfirmDialog.test.tsx
git commit -m "feat(ui): Modal with focus trap and ConfirmDialog"
```

---

### Task 7: EmptyState, Spinner, Skeleton

**Files:**
- Create: `ui/src/components/ui/EmptyState.tsx`, `EmptyState.css`
- Create: `ui/src/components/ui/Loading.tsx`, `Loading.css`

- [ ] **Step 1: Создать `ui/src/components/ui/EmptyState.tsx`**

```tsx
import type { ReactNode } from 'react';
import './EmptyState.css';

type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
};

export function EmptyState({ icon, title, hint, action }: EmptyStateProps) {
  return (
    <div className="ui-empty">
      {icon && <div className="ui-empty__icon">{icon}</div>}
      <div className="ui-empty__title">{title}</div>
      {hint && <div className="ui-empty__hint">{hint}</div>}
      {action && <div className="ui-empty__action">{action}</div>}
    </div>
  );
}
```

`ui/src/components/ui/EmptyState.css`:

```css
.ui-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 48px 20px;
  gap: 8px;
}
.ui-empty__icon { font-size: 28px; opacity: 0.6; }
.ui-empty__title { font-weight: 600; font-size: 15px; }
.ui-empty__hint { color: var(--text-secondary); font-size: 13px; max-width: 420px; line-height: 1.5; }
.ui-empty__action { margin-top: 10px; }
```

- [ ] **Step 2: Создать `ui/src/components/ui/Loading.tsx`**

```tsx
import './Loading.css';

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <span
      className="ui-spinner"
      style={{ width: size, height: size }}
      role="status"
      aria-label="Загрузка"
    />
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="ui-skeleton" role="status" aria-label="Загрузка">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="ui-skeleton__line" />
      ))}
    </div>
  );
}
```

`ui/src/components/ui/Loading.css`:

```css
.ui-spinner {
  display: inline-block;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: ui-spin 0.7s linear infinite;
}
.ui-skeleton { display: flex; flex-direction: column; gap: 10px; }
.ui-skeleton__line {
  height: 14px;
  border-radius: 6px;
  background: linear-gradient(90deg, var(--bg-card) 25%, var(--bg-elevated) 50%, var(--bg-card) 75%);
  background-size: 200% 100%;
  animation: ui-shimmer 1.4s ease infinite;
}
.ui-skeleton__line:nth-child(2n) { width: 85%; }
.ui-skeleton__line:nth-child(3n) { width: 65%; }
@keyframes ui-shimmer { to { background-position: -200% 0; } }
```

(`ui-spin` уже объявлен в Button.css — Vite собирает всё в один бандл, keyframes глобальны; повторно не объявлять.)

- [ ] **Step 3: Сборка + commit**

```bash
cd ui && npm run build
git add ui/src/components/ui/EmptyState.tsx ui/src/components/ui/EmptyState.css ui/src/components/ui/Loading.tsx ui/src/components/ui/Loading.css
git commit -m "feat(ui): EmptyState, Spinner, Skeleton components"
```

---

### Task 8: Toast

**Files:**
- Create: `ui/src/components/ui/Toast.tsx`, `Toast.css`
- Test: `ui/src/components/ui/Toast.test.tsx`
- Modify: `ui/src/main.tsx` (обернуть приложение в ToastProvider)

- [ ] **Step 1: Падающий тест `ui/src/components/ui/Toast.test.tsx`**

```tsx
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { ToastProvider, useToast } from './Toast';

afterEach(cleanup);

function Demo() {
  const toast = useToast();
  return (
    <button onClick={() => toast.error('Не удалось сохранить')}>fire</button>
  );
}

test('показывает сообщение об ошибке', () => {
  render(
    <ToastProvider>
      <Demo />
    </ToastProvider>
  );
  fireEvent.click(screen.getByText('fire'));
  expect(screen.getByText('Не удалось сохранить')).toBeInTheDocument();
});
```

- [ ] **Step 2: Убедиться, что падает**

```bash
cd ui && npx vitest run src/components/ui/Toast.test.tsx
```

Expected: FAIL — `Cannot find module './Toast'`.

- [ ] **Step 3: Создать `ui/src/components/ui/Toast.tsx`**

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import './Toast.css';

type ToastItem = { id: number; kind: 'success' | 'error'; text: string };

type ToastApi = {
  success: (text: string) => void;
  error: (text: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const TOAST_TTL_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const push = useCallback((kind: ToastItem['kind'], text: string) => {
    const id = nextId.current++;
    setItems((prev) => [...prev, { id, kind, text }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), TOAST_TTL_MS);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (text) => push('success', text),
      error: (text) => push('error', text),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="ui-toasts" aria-live="polite">
          {items.map((t) => (
            <div key={t.id} className={`ui-toast ui-toast--${t.kind}`}>
              {t.text}
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast требует <ToastProvider> выше по дереву');
  return ctx;
}
```

- [ ] **Step 4: Создать `ui/src/components/ui/Toast.css`**

```css
.ui-toasts {
  position: fixed;
  bottom: 20px;
  right: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 200;
  max-width: min(360px, calc(100vw - 40px));
}
.ui-toast {
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  font-size: 13.5px;
  font-weight: 500;
  box-shadow: var(--shadow-lg);
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-primary);
  animation: ui-toast-in 0.18s ease;
}
.ui-toast--success { border-color: var(--green-muted); }
.ui-toast--error { border-color: var(--red); color: var(--red-light); }
@keyframes ui-toast-in {
  from { transform: translateY(8px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
```

- [ ] **Step 5: Обернуть приложение в `ui/src/main.tsx`** — импортировать `ToastProvider` из `./components/ui/Toast` и обернуть `<App />` (внутри BrowserRouter):

```tsx
<BrowserRouter>
  <ToastProvider>
    <App />
  </ToastProvider>
</BrowserRouter>
```

- [ ] **Step 6: Тесты зелёные + commit**

```bash
cd ui && npx vitest run src/components/ui/Toast.test.tsx && npm run build
```

Expected: PASS, build OK.

```bash
git add ui/src/components/ui/Toast.tsx ui/src/components/ui/Toast.css ui/src/components/ui/Toast.test.tsx ui/src/main.tsx
git commit -m "feat(ui): Toast notifications (provider + useToast hook)"
```

---

### Task 9: Tabs

**Files:**
- Create: `ui/src/components/ui/Tabs.tsx`, `Tabs.css`
- Test: `ui/src/components/ui/Tabs.test.tsx`

- [ ] **Step 1: Падающий тест `ui/src/components/ui/Tabs.test.tsx`**

```tsx
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { Tabs } from './Tabs';

afterEach(cleanup);

const tabs = [
  { id: 'inbox', label: 'Входящие' },
  { id: 'plans', label: 'Планы' },
];

test('активная вкладка помечена aria-selected', () => {
  render(<Tabs tabs={tabs} active="plans" onChange={() => {}} />);
  expect(screen.getByRole('tab', { name: 'Планы' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('tab', { name: 'Входящие' }).getAttribute('aria-selected')).toBe('false');
});

test('клик зовёт onChange с id', () => {
  const onChange = vi.fn();
  render(<Tabs tabs={tabs} active="inbox" onChange={onChange} />);
  fireEvent.click(screen.getByRole('tab', { name: 'Планы' }));
  expect(onChange).toHaveBeenCalledWith('plans');
});
```

- [ ] **Step 2: Убедиться, что падает**

```bash
cd ui && npx vitest run src/components/ui/Tabs.test.tsx
```

Expected: FAIL — `Cannot find module './Tabs'`.

- [ ] **Step 3: Создать `ui/src/components/ui/Tabs.tsx`**

```tsx
import './Tabs.css';

type TabDef = { id: string; label: string; count?: number };

type TabsProps = {
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
};

export function Tabs({ tabs, active, onChange }: TabsProps) {
  return (
    <div className="ui-tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={t.id === active}
          className={`ui-tab${t.id === active ? ' ui-tab--active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {typeof t.count === 'number' && <span className="ui-tab__count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Создать `ui/src/components/ui/Tabs.css`**

```css
.ui-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 20px;
  overflow-x: auto;
}
.ui-tab {
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  padding: 8px 14px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  white-space: nowrap;
}
.ui-tab:hover { color: var(--text-primary); filter: none; border-color: transparent; border-bottom-color: var(--border); }
.ui-tab--active { color: var(--text-primary); border-bottom-color: var(--accent); }
.ui-tab__count {
  background: var(--bg-elevated);
  color: var(--text-secondary);
  border-radius: 999px;
  font-size: 11px;
  padding: 1px 7px;
}
.ui-tab--active .ui-tab__count { background: var(--accent-muted); color: var(--accent); }
```

- [ ] **Step 5: Тесты зелёные + commit**

```bash
cd ui && npx vitest run src/components/ui/Tabs.test.tsx
```

Expected: PASS (2 теста).

```bash
git add ui/src/components/ui/Tabs.tsx ui/src/components/ui/Tabs.css ui/src/components/ui/Tabs.test.tsx
git commit -m "feat(ui): Tabs component"
```

---

### Task 10: Индексный экспорт и финальная проверка

**Files:**
- Create: `ui/src/components/ui/index.ts`

- [ ] **Step 1: Создать `ui/src/components/ui/index.ts`** — одна точка импорта для страниц (этап 3 будет импортировать отсюда):

```ts
export { Button } from './Button';
export { Card } from './Card';
export { Badge } from './Badge';
export { PageHeader } from './PageHeader';
export { Field, Input, Textarea, Select } from './Field';
export { Modal } from './Modal';
export { ConfirmDialog } from './ConfirmDialog';
export { EmptyState } from './EmptyState';
export { Spinner, Skeleton } from './Loading';
export { ToastProvider, useToast } from './Toast';
export { Tabs } from './Tabs';
```

- [ ] **Step 2: Полная проверка**

```bash
cd ui && npm run test && npm run build
```

Expected: все тесты зелёные (старые `*Status` + новые компонентные), build OK.

```bash
cd ui && npm run dev
```

Ручная проверка на http://localhost:5173: вид приложения не изменился (тема, hover, мобильный сайдбар). Остановить.

- [ ] **Step 3: Commit + PR**

```bash
git add ui/src/components/ui/index.ts
git commit -m "feat(ui): barrel export for ui component library"
git push -u origin feature/shtab-1-foundation
gh pr create --title "feat(ui): Штаб этап 1 — дизайн-токены и библиотека компонентов" --body "Этап 1 по спеке _specs/2026-07-04-shtab-ux-design.md (§6, §10.1): токены+base.css вынесены из index.html, библиотека ui-компонентов с тестами. Видимых изменений нет; миграция страниц — этап 3.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Expected: PR создан. Merge — только Alex (финальный gate).

---

## Что НЕ входит в этот план

Этапы 2–6 спеки (каркас «Штаба» с русской навигацией, миграция страниц, чат «Связь» с backend, «Обстановка», тач/мобильная полировка) — отдельные планы, пишутся после приземления предыдущего этапа.
