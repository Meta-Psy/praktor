# Штаб, этап 6: «Тач/мобильная полировка» — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть этап 6 спеки `_specs/2026-07-04-shtab-ux-design.md` (§7, §8, §12): тач-редактор графа отрядов на pointer-events с режимом «Связать» и пан/зумом, мессенджер-режим «Связи» на телефоне, миграция Login на ui-библиотеку, снос легаси hover-правил и алиас-токенов, тач-зоны ≥44px, плюс все восемь унаследованных находок ревью этапов 3–5 (Toast TTL, Tabs a11y + потеря ввода, fetch-гонки, баннеры ошибок, пустая причина отклонения, дебаунс Swarms, времена ленты).

**Architecture:** Чисто фронтенд-этап, Go не трогаем. Геометрия пан/зума выносится в чистый модуль `swarmGraphMath.ts` (vitest без DOM); SwarmGraph переписывается на pointer-events c трансформом `<g translate/scale>`; вкладки получают `TabPanel` (скрытие через `hidden` вместо размонтирования); hover-стили переезжают из глобальных `!important`-правил base.css в классы компонентов.

**Tech Stack:** React 19 + TypeScript strict, react-router-dom, vitest + testing-library, библиотека `ui/src/components/ui/*`, CSS-токены `ui/src/styles/tokens.css`.

---

## Контекст для исполнителя (прочитать перед началом)

- Рабочая копия — worktree `.worktrees/shtab-6`, ветка `feature/shtab-6-touch-mobile` от `origin/main` (`git checkout main` в worktree невозможен — основная копия держит main). Git-операции ТОЛЬКО после `cd` в worktree (или `git -C`).
- Windows-окружение: `go` может быть не в PATH — полный путь `C:\Program Files\Go\bin\go.exe`. UI-команды: `cd ui && npm test -- --run`, `npm run build`. В свежем worktree обязателен `cd ui && npm install`. UI-suite изредка флачит пулом воркеров vitest — при странном падении перепрогнать.
- **Не коммитить в main. Не пушить без запроса.** Коммиты — Conventional Commits.
- Язык UI — русский. В TypeScript запрещён `any` (используй `unknown` + сужение).
- Отчётам субагентов о тестах не верить — контролёр прогоняет полный suite сам.

### Утверждённые дизайн-решения этапа 6 (не самодеятельность)

1. **Соединение узлов** — только явный режим: кнопка «Связать» → тап/клик по двум узлам. Рисование рёбер перетаскиванием за круглые хэндлы удаляется полностью (вместе с хэндлами). Одно соединение за включение режима, после создания режим выключается.
2. **Пан/зум холста:** колесо мыши — зум к курсору (нативный listener с `passive: false` — React вешает `wheel` пассивно и `preventDefault` в `onWheel` не работает); один палец/зажатая мышь по пустому холсту — пан; два пальца — пинч-зум. Матрица вида `{x, y, scale}` в состоянии, узлы хранятся в графовых координатах, рендер через `<g transform="translate(...) scale(...)">`. `touch-action: none` на svg.
3. **Вкладки keep-mounted:** панели скрываются атрибутом `hidden` (компонент `TabPanel`), а не размонтируются — несохранённый ввод переживает переключение. Цена: фоновая вкладка продолжает поллинг (Intake — 60 с) — принято осознанно.
4. **Времена ленты «Обстановки»:** всё — локальное время браузера из ISO-меток (`created_at` / `timestamp`); серверная строка `time` — только fallback, когда `created_at` отсутствует (старые записи БД).
5. **Тач-зоны ≥44px** — через `@media (pointer: coarse)`: на десктопе размеры не меняются вообще.
6. **«Связь» на телефоне:** карточка со списком агентов скрывается, выбор агента — `Select` в шапке чата; высота layout — `100dvh` (динамическая высота вьюпорта учитывает клавиатуру), поле ввода прижато к низу карточки, отступ снизу с `env(safe-area-inset-bottom)`; в `index.html` добавляется `viewport-fit=cover`.
7. **Легаси-блок hover** (base.css строки 22–39: `button:hover:not(...)`, `nav a:hover`, `[data-hover]`, `[data-agent-*]`) удаляется целиком; hover переезжает в классы: `.ui-card--interactive:hover` (Card.css), `.nav-item` (сайдбар: и NavLink, и кнопки футера), `.hamburger:hover`, `.agent-select` (список агентов «Связи»), `.icon-action` (запуск/остановка агента), `.swarm-editor__agent` (палитра редактора). Плавность переходов сохраняется правилом base.css:18–20 (там уже перечислены button/a).
8. **Русификация остатков английского:** Login («Пароль», «Войти», «Неверный пароль», «Нет связи с сервером»), футер сайдбара («Светлая тема»/«Тёмная тема», «Выйти», aria-label «Открыть меню»), весь SwarmGraph (палитра, свойства, легенда, кнопка запуска).
9. **Fallback риска §12 спеки:** если ручная проверка покажет, что тач-редактор неюзабелен — упрощение мобильного варианта до просмотра топологии + текстового конструктора решает Alex отдельно; в этом плане только pointer-вариант.
10. **Секреты/чипы не трогаем:** маска секрета (12 звёздочек) не переполняется; чипы Dashboard — не интерактивные `span`, 44px им не нужен.

### Известные грабли из ревью прошлых этапов (не повторять)

- Зависимость эффекта от `events.length` — БАГ после переполнения буфера 500; зависимость — сам массив `events`.
- Перекрывающиеся fetch должны отбрасывать устаревшие завершения — паттерн epoch (`fetchEpoch` из Conversations.tsx:48,73–89).
- Ошибку загрузки не глотать молча — отдельное error-состояние + баннер (эталон: Dashboard.tsx:274–278).
- Inline-`style` в JSX бьёт CSS-класс без `!important` — при переносе hover в классы переносить из inline и сам перекрываемый props (background/color), иначе hover не проявится.

## Структура файлов

| Файл | Действие | Ответственность |
|---|---|---|
| `ui/src/components/ui/Toast.tsx` | правка | таймеры в Map, продление TTL при повторе, очистка при размонтировании |
| `ui/src/components/ui/Toast.test.tsx` | правка | тест продления TTL |
| `ui/src/components/ui/Tabs.tsx` | правка | id/aria-controls, roving tabindex, стрелки/Home/End, новый `TabPanel` |
| `ui/src/components/ui/Tabs.test.tsx` | правка | тесты клавиатуры и связи tab↔panel |
| `ui/src/components/ui/index.ts` | правка | экспорт `TabPanel` |
| `ui/src/pages/Reception.tsx`, `ui/src/pages/Recon.tsx` | правка | вкладки на TabPanel (keep-mounted) |
| `ui/src/components/AgentExtensions.tsx` | правка | TabPanel; epoch-guard загрузки; word-break у mono-строк |
| `ui/src/pages/Agents.tsx` | правка | epoch-guard agent-md; классы `.icon-action`; word-break у ID |
| `ui/src/pages/Catalog.tsx`, `ui/src/pages/Radar.tsx`, `ui/src/pages/Intel.tsx` | правка | error-состояние + баннер |
| `ui/src/components/ui/ConfirmDialog.tsx` (+`.test.tsx`) | правка | новый prop `confirmDisabled` |
| `ui/src/pages/Plans.tsx`, `ui/src/pages/Dashboard.tsx` | правка | блокировка «Отклонить» при пустой причине |
| `ui/src/pages/Swarms.tsx` | правка | дебаунс WS-рефетча; `overflow-x` у pre вывода |
| `ui/src/pages/dashboardStatus.ts` (+тест) | правка | локальное время из ISO в ленте |
| `ui/src/components/Login.tsx` | переписать | ui-библиотека, канонические токены, русский |
| `ui/src/styles/tokens.css` | правка | удалить блок алиасов |
| `ui/src/App.tsx` | правка | классы `.nav-item`/`.hamburger`, русский футер |
| `ui/src/components/ui/Card.tsx` (+`Card.css`) | правка | hover без `data-hover` |
| `ui/src/pages/Conversations.tsx` | правка | классы agent-select/поиск/композер; мобильный Select агента |
| `ui/src/styles/base.css` | правка | снос легаси-блока; классы каркаса; мобильный блок «Связи»; тач-зоны |
| `ui/index.html` | правка | `viewport-fit=cover` |
| `ui/src/components/swarmGraphMath.ts` | создать | чистая геометрия пан/зум/пинч |
| `ui/src/components/swarmGraphMath.test.ts` | создать | vitest на геометрию |
| `ui/src/components/SwarmGraph.tsx` | переписать | pointer-events, режим «Связать», пан/зум, ui-компоненты, русский |
| `ui/src/components/SwarmGraph.css` | создать | layout редактора + мобильная раскладка |
| `CLAUDE.md` | правка | строка про SwarmGraph (тач-редактор) |

---

### Task 0: Подготовка worktree

- [ ] **Step 0.1:** Из основной копии:

```powershell
git -C C:\Users\Alex\10_Projects\praktor fetch origin
git -C C:\Users\Alex\10_Projects\praktor worktree add .worktrees\shtab-6 -b feature/shtab-6-touch-mobile origin/main
cd C:\Users\Alex\10_Projects\praktor\.worktrees\shtab-6\ui
npm install
```

- [ ] **Step 0.2:** Проверка чистоты: `git -C C:\Users\Alex\10_Projects\praktor\.worktrees\shtab-6 status` → `nothing to commit`; `npm test -- --run` в `ui/` → все зелёные (флак — перепрогнать).

Все последующие пути — относительно корня worktree.

---

### Task 1: Toast — повтор продлевает TTL

**Files:**
- Modify: `ui/src/components/ui/Toast.tsx`
- Test: `ui/src/components/ui/Toast.test.tsx`

Сейчас (Toast.tsx:28–34) при дедупликации повторный `setTimeout` ставится на несуществующий id, а таймер первого показа не сбрасывается — повторная ошибка исчезает по расписанию первой. Таймеры и не чистятся при размонтировании.

- [ ] **Step 1.1: Написать падающий тест** — добавить в конец `Toast.test.tsx`:

```tsx
test('повтор той же ошибки продлевает TTL', () => {
  vi.useFakeTimers();
  render(
    <ToastProvider>
      <Demo />
    </ToastProvider>
  );
  fireEvent.click(screen.getByText('fire'));           // t=0, TTL error = 8000
  act(() => { vi.advanceTimersByTime(5000); });        // t=5000
  fireEvent.click(screen.getByText('fire'));           // повтор — TTL должен перезапуститься
  act(() => { vi.advanceTimersByTime(4000); });        // t=9000 (> исходных 8000)
  expect(screen.getByText('Не удалось сохранить')).toBeInTheDocument();
  act(() => { vi.advanceTimersByTime(4000); });        // t=13000 = 5000+8000
  expect(screen.queryByText('Не удалось сохранить')).toBeNull();
});
```

- [ ] **Step 1.2:** `cd ui && npm test -- --run src/components/ui/Toast.test.tsx` → новый тест FAIL (тост исчез на t=9000), остальные PASS.

- [ ] **Step 1.3: Реализация** — заменить в `Toast.tsx` тело `ToastProvider` до `const api = ...` (строки 25–34) на:

```tsx
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const itemsRef = useRef<ToastItem[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const remove = useCallback((id: number) => {
    timers.current.delete(id);
    itemsRef.current = itemsRef.current.filter((t) => t.id !== id);
    setItems(itemsRef.current);
  }, []);

  const push = useCallback((kind: ToastItem['kind'], text: string) => {
    // Повтор того же тоста не дублируется, но продлевает время показа
    const existing = itemsRef.current.find((t) => t.kind === kind && t.text === text);
    if (existing) {
      clearTimeout(timers.current.get(existing.id));
      timers.current.set(existing.id, setTimeout(() => remove(existing.id), TOAST_TTL_MS[kind]));
      return;
    }
    const id = nextId.current++;
    itemsRef.current = [...itemsRef.current, { id, kind, text }];
    setItems(itemsRef.current);
    timers.current.set(id, setTimeout(() => remove(id), TOAST_TTL_MS[kind]));
  }, [remove]);

  useEffect(() => {
    const map = timers.current;
    return () => { map.forEach(clearTimeout); };
  }, []);
```

В импорт React добавить `useEffect` (сейчас Toast.tsx его не импортирует). Остальное (api/useMemo/JSX) — без изменений.

- [ ] **Step 1.4:** `npm test -- --run src/components/ui/Toast.test.tsx` → все PASS (включая старый тест «success живёт 4с…»).

- [ ] **Step 1.5: Commit**

```powershell
git add ui/src/components/ui/Toast.tsx ui/src/components/ui/Toast.test.tsx
git commit -m "fix(ui): повтор тоста продлевает TTL, таймеры чистятся при размонтировании"
```

---

### Task 2: Tabs — aria-связь, стрелки, TabPanel без размонтирования

**Files:**
- Modify: `ui/src/components/ui/Tabs.tsx`, `ui/src/components/ui/index.ts`
- Modify: `ui/src/pages/Reception.tsx`, `ui/src/pages/Recon.tsx`, `ui/src/components/AgentExtensions.tsx`
- Test: `ui/src/components/ui/Tabs.test.tsx`

- [ ] **Step 2.1: Падающие тесты** — добавить в `Tabs.test.tsx` (импорт дополнить `TabPanel`):

```tsx
test('ArrowRight/ArrowLeft/Home/End переключают вкладки', () => {
  const onChange = vi.fn();
  render(<Tabs tabs={tabs} active="inbox" onChange={onChange} />);
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Входящие' }), { key: 'ArrowRight' });
  expect(onChange).toHaveBeenCalledWith('plans');
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Входящие' }), { key: 'End' });
  expect(onChange).toHaveBeenLastCalledWith('plans');
});

test('roving tabindex: только активная вкладка в tab-порядке', () => {
  render(<Tabs tabs={tabs} active="plans" onChange={() => {}} />);
  expect(screen.getByRole('tab', { name: 'Планы' }).getAttribute('tabindex')).toBe('0');
  expect(screen.getByRole('tab', { name: 'Входящие' }).getAttribute('tabindex')).toBe('-1');
});

test('вкладка связана с панелью aria-controls/aria-labelledby', () => {
  render(
    <>
      <Tabs tabs={tabs} active="inbox" onChange={() => {}} />
      <TabPanel id="inbox" active><div>контент</div></TabPanel>
    </>
  );
  const tab = screen.getByRole('tab', { name: 'Входящие' });
  const panel = screen.getByRole('tabpanel');
  expect(tab.getAttribute('aria-controls')).toBe(panel.id);
  expect(panel.getAttribute('aria-labelledby')).toBe(tab.id);
});

test('неактивная панель скрыта, но остаётся смонтированной (ввод не теряется)', () => {
  render(<TabPanel id="plans" active={false}><input placeholder="черновик" /></TabPanel>);
  expect(screen.getByPlaceholderText('черновик')).toBeInTheDocument();
  expect(screen.queryByRole('tabpanel')).toBeNull(); // hidden убирает из a11y-дерева
});
```

- [ ] **Step 2.2:** `npm test -- --run src/components/ui/Tabs.test.tsx` → FAIL (нет TabPanel, нет клавиатуры).

- [ ] **Step 2.3: Реализация** — заменить `Tabs.tsx` целиком:

```tsx
import { useRef } from 'react';
import type { ReactNode } from 'react';
import './Tabs.css';

type TabDef = { id: string; label: string; count?: number };

type TabsProps = {
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
};

export function Tabs({ tabs, active, onChange }: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const idx = tabs.findIndex((t) => t.id === active);
    let next: number;
    if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    onChange(tabs[next].id);
    listRef.current?.querySelectorAll<HTMLButtonElement>('.ui-tab')[next]?.focus();
  };

  return (
    <div className="ui-tabs" role="tablist" ref={listRef} onKeyDown={onKeyDown}>
      {tabs.map((t) => (
        <button
          key={t.id}
          id={`ui-tab-${t.id}`}
          type="button"
          role="tab"
          aria-selected={t.id === active}
          aria-controls={`ui-tabpanel-${t.id}`}
          tabIndex={t.id === active ? 0 : -1}
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

// Панель вкладки: скрывается hidden-атрибутом, НЕ размонтируется —
// несохранённый ввод переживает переключение вкладок
export function TabPanel({ id, active, children }: { id: string; active: boolean; children: ReactNode }) {
  return (
    <div
      id={`ui-tabpanel-${id}`}
      role="tabpanel"
      aria-labelledby={`ui-tab-${id}`}
      hidden={!active}
    >
      {children}
    </div>
  );
}
```

В `ui/src/components/ui/index.ts` строку `export { Tabs } from './Tabs';` заменить на `export { Tabs, TabPanel } from './Tabs';`.

- [ ] **Step 2.4:** `npm test -- --run src/components/ui/Tabs.test.tsx` → PASS.

- [ ] **Step 2.5: Потребители.** В `Reception.tsx` импорт `{ PageHeader, Tabs }` дополнить `TabPanel` и заменить строку 23:

```tsx
      <TabPanel id="inbox" active={tab === 'inbox'}><IntakeContent /></TabPanel>
      <TabPanel id="plans" active={tab === 'plans'}><PlansContent /></TabPanel>
```

В `Recon.tsx` аналогично (строка 23):

```tsx
      <TabPanel id="radar" active={tab === 'radar'}><RadarContent /></TabPanel>
      <TabPanel id="intel" active={tab === 'intel'}><IntelContent /></TabPanel>
```

В `AgentExtensions.tsx` (строки 617–634) — три условных блока `{tab === 'mcp' && (...)}`, `{tab === 'plugins' && (...)}`, `{tab === 'skills' && (...)}` заменить на те же JSX-поддеревья, обёрнутые в TabPanel (импорт `TabPanel` добавить к импорту ui):

```tsx
      <TabPanel id="mcp" active={tab === 'mcp'}>
        <MCPServersTab
          servers={ext.mcp_servers || {}}
          onChange={(servers) => setExt({ ...ext, mcp_servers: servers })}
        />
      </TabPanel>
      <TabPanel id="plugins" active={tab === 'plugins'}>
        <PluginsTab
          marketplaces={ext.marketplaces || []}
          plugins={ext.plugins || []}
          status={ext._status}
          onChangeMarketplaces={(marketplaces) => setExt({ ...ext, marketplaces })}
          onChangePlugins={(plugins) => setExt({ ...ext, plugins })}
        />
      </TabPanel>
      <TabPanel id="skills" active={tab === 'skills'}>
        <SkillsTab skills={ext.skills || {}} onChange={(skills) => setExt({ ...ext, skills })} />
      </TabPanel>
```

- [ ] **Step 2.6:** `npm test -- --run` (весь suite) → PASS (Reception/Recon-тесты проверяют aria-selected — не задеты).

- [ ] **Step 2.7: Commit**

```powershell
git add ui/src/components/ui/Tabs.tsx ui/src/components/ui/Tabs.test.tsx ui/src/components/ui/index.ts ui/src/pages/Reception.tsx ui/src/pages/Recon.tsx ui/src/components/AgentExtensions.tsx
git commit -m "fix(ui): Tabs — стрелки, roving tabindex, aria-связь; TabPanel сохраняет ввод при переключении"
```

---

### Task 3: Fetch-гонки — epoch-guard в Agents и AgentExtensions

**Files:**
- Modify: `ui/src/pages/Agents.tsx:61-69`
- Modify: `ui/src/components/AgentExtensions.tsx:540-548`

Эталон — `fetchEpoch` из Conversations.tsx:48,73–89. Компонентных тестов на гонку не пишем (тайминг-flaky); фикс механический по эталону.

- [ ] **Step 3.1:** В `Agents.tsx` рядом с `debounceRef` (строка 35) добавить `const agentMdEpoch = useRef(0);` и заменить эффект строк 61–69 на:

```tsx
  useEffect(() => {
    if (!selected) return;
    setAgentMdLoading(true);
    const epoch = ++agentMdEpoch.current;
    fetch(`/api/agents/definitions/${selected.id}/agent-md`)
      .then((res) => res.json())
      .then((data) => {
        if (agentMdEpoch.current !== epoch) return;
        setAgentMd(data.content || '');
      })
      .catch(() => {
        if (agentMdEpoch.current !== epoch) return;
        setAgentMd('');
      })
      .finally(() => {
        if (agentMdEpoch.current !== epoch) return;
        setAgentMdLoading(false);
      });
  }, [selected?.id]);
```

(`useRef` уже импортирован в Agents.tsx.)

- [ ] **Step 3.2:** В `AgentExtensions.tsx` внутри `AgentExtensionsPanel` (перед useEffect строки 540) добавить `const loadEpoch = useRef(0);` (добавить `useRef` в импорт react, если его там нет) и заменить эффект строк 540–548 на:

```tsx
  useEffect(() => {
    setLoading(true);
    setError(null);
    const epoch = ++loadEpoch.current;
    fetch(`/api/agents/definitions/${agentId}/extensions`)
      .then((res) => res.json())
      .then((data) => { if (loadEpoch.current === epoch) setExt(data); })
      .catch((err) => { if (loadEpoch.current === epoch) setError(err.message); })
      .finally(() => { if (loadEpoch.current === epoch) setLoading(false); });
  }, [agentId]);
```

- [ ] **Step 3.3:** `npm test -- --run` → PASS; `npm run build` → OK.

- [ ] **Step 3.4: Commit**

```powershell
git add ui/src/pages/Agents.tsx ui/src/components/AgentExtensions.tsx
git commit -m "fix(ui): epoch-guard на загрузке AGENT.md и расширений — гонка при переключении агента"
```

---

### Task 4: Баннеры сетевых ошибок — Catalog, Radar, Intel

**Files:**
- Modify: `ui/src/pages/Catalog.tsx:63-90`, `ui/src/pages/Radar.tsx:27-50`, `ui/src/pages/Intel.tsx:58-81`

Эталон баннера — Dashboard.tsx:274–278. Ошибка больше не подменяется пустым результатом.

- [ ] **Step 4.1: Catalog.** В компоненте `Catalog` добавить состояние и переписать `fetchData` (строки 64–72):

```tsx
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    fetch('/api/agents/capabilities')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((d: CatalogResponse) => { setData(d); setLoadError(null); })
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, []);
```

В JSX сразу после `<PageHeader …/>` добавить баннер, а скелетон/EmptyState обусловить отсутствием ошибки (строки 80–86):

```tsx
      {loadError && (
        <Card style={{ color: 'var(--red)', marginBottom: 12 }}>
          Не удалось загрузить каталог: {loadError}
        </Card>
      )}
      {data === null && !loadError && <Skeleton lines={3} />}
      {data !== null && data.agents.length === 0 && (
        <EmptyState
          title="Нет агентов"
          hint="Каталог собирается из определений агентов и их отчётов о памяти."
        />
      )}
```

- [ ] **Step 4.2: Radar.** В `RadarContent` (строки 28–47) то же самое:

```tsx
  const [items, setItems] = useState<RadarItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    fetch('/api/radar')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((d: RadarResponse) => { setItems(d.items || []); setLoadError(null); })
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, []);
```

и в JSX:

```tsx
      {loadError && (
        <Card style={{ color: 'var(--red)', marginBottom: 12 }}>
          Не удалось загрузить радар: {loadError}
        </Card>
      )}
      {items === null && !loadError && <Skeleton lines={3} />}
      {items !== null && items.length === 0 && (
```

- [ ] **Step 4.3: Intel.** В `IntelContent` (строки 59–78) аналогично: состояние `loadError`, `fetchData` с `setSources(d.sources || []); setLoadError(null);` и `.catch((err) => setLoadError(...))`, баннер «Не удалось загрузить сводки: …», `{sources === null && !loadError && <Skeleton lines={3} />}`.

- [ ] **Step 4.4:** `npm test -- --run` → PASS (тесты Recon стабят fetch с `ok: true`). `npm run build` → OK.

- [ ] **Step 4.5: Commit**

```powershell
git add ui/src/pages/Catalog.tsx ui/src/pages/Radar.tsx ui/src/pages/Intel.tsx
git commit -m "fix(ui): баннеры сетевых ошибок в Арсенале и Разведке вместо ложного пустого состояния"
```

---

### Task 5: Пустая причина отклонения плана блокируется

**Files:**
- Modify: `ui/src/components/ui/ConfirmDialog.tsx`
- Modify: `ui/src/pages/Plans.tsx`, `ui/src/pages/Dashboard.tsx`
- Test: `ui/src/components/ui/ConfirmDialog.test.tsx`

- [ ] **Step 5.1: Падающий тест** в `ConfirmDialog.test.tsx`:

```tsx
test('confirmDisabled блокирует кнопку подтверждения', () => {
  const onConfirm = vi.fn();
  render(
    <ConfirmDialog open title="Отклонить план?" confirmLabel="Отклонить" confirmDisabled onConfirm={onConfirm} onCancel={() => {}} />
  );
  const btn = screen.getByRole('button', { name: 'Отклонить' });
  expect(btn).toBeDisabled();
  fireEvent.click(btn);
  expect(onConfirm).not.toHaveBeenCalled();
});
```

- [ ] **Step 5.2:** `npm test -- --run src/components/ui/ConfirmDialog.test.tsx` → FAIL (нет prop).

- [ ] **Step 5.3:** В `ConfirmDialog.tsx`: в тип props добавить `confirmDisabled?: boolean;`, в деструктуризацию — `confirmDisabled = false,`, у confirm-кнопки:

```tsx
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} busy={busy} disabled={confirmDisabled}>
```

(`Button` дизейблится при `disabled || busy` — busy-поведение не меняется.)

- [ ] **Step 5.4:** `npm test -- --run src/components/ui/ConfirmDialog.test.tsx` → PASS.

- [ ] **Step 5.5: Потребители.** `Plans.tsx` — в `<ConfirmDialog …>` (строки 102–119) добавить prop:

```tsx
        confirmDisabled={confirm?.action === 'reject' && !reason.trim()}
```

`Dashboard.tsx` — в `<ConfirmDialog …>` (строки 337–346) добавить:

```tsx
        confirmDisabled={pending?.kind === 'plan-reject' && !reason.trim()}
```

- [ ] **Step 5.6:** `npm test -- --run` → PASS.

- [ ] **Step 5.7: Commit**

```powershell
git add ui/src/components/ui/ConfirmDialog.tsx ui/src/components/ui/ConfirmDialog.test.tsx ui/src/pages/Plans.tsx ui/src/pages/Dashboard.tsx
git commit -m "fix(ui): отклонение плана требует непустую причину (Приёмная и Обстановка)"
```

---

### Task 6: Swarms — дебаунс рефетча по WS-событиям

**Files:**
- Modify: `ui/src/pages/Swarms.tsx:1,106-114`

- [ ] **Step 6.1:** В импорт react добавить `useRef` (строка 1: `import { useState, useEffect, useCallback, useRef } from 'react';`). Заменить эффект строк 106–114 на (эталон — Dashboard.tsx:188–194):

```tsx
  // React to WebSocket swarm events (с дебаунсом — поток swarm_* не должен бить по API каждым событием).
  // Cleanup только на размонтирование: per-run cleanup стирал бы ожидающий таймер,
  // когда следующее событие в потоке не swarm_* — и рефетч терялся бы насовсем.
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const latest = events[events.length - 1];
    if (!latest || !latest.type.startsWith('swarm_')) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchSwarms, 500);
  }, [events, fetchSwarms]);
  useEffect(() => () => clearTimeout(debounceRef.current), []);
```

> Примечание ревью: первая редакция плана ставила `return () => clearTimeout(...)` внутрь основного эффекта — это теряло отложенный рефетч, если следующим событием в потоке было не-swarm (cleanup стирал таймер, ранний return не взводил новый). Исправлено в ходе quality-ревью.

- [ ] **Step 6.2:** `npm test -- --run` → PASS; `npm run build` → OK.

- [ ] **Step 6.3: Commit**

```powershell
git add ui/src/pages/Swarms.tsx
git commit -m "fix(ui): дебаунс 500мс на рефетч отрядов по swarm_* событиям"
```

---

### Task 7: Лента «Обстановки» — единое локальное время

**Files:**
- Modify: `ui/src/pages/dashboardStatus.ts:136-139,187-193`
- Test: `ui/src/pages/__tests__/dashboardStatus.test.ts`

Сейчас seed-сообщения показывают серверный `HH:MM` (TZ сервера), остальные события — локальный. Решение №4: локальное время из ISO, серверная строка — fallback.

- [ ] **Step 7.1: Падающие тесты** — в `describe('buildFeed', …)` добавить:

```ts
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  test('seed с created_at: время форматируется локально', () => {
    const seeded: RecentMessage[] = [
      { id: '3', agent: 'dev', role: 'assistant', text: 'x', time: '23:59', created_at: '2026-07-05T07:10:00Z' },
    ];
    const out = buildFeed(seeded, [], {});
    expect(out[0].time).toBe(fmt('2026-07-05T07:10:00Z'));
  });

  test('WS message: время из timestamp события, не из серверного data.time', () => {
    const out = buildFeed([], [
      ev('message', { id: '5', role: 'assistant', text: 'x', time: '23:59' }, { agent_id: 'dev', timestamp: '2026-07-05T07:10:00Z' }),
    ], { dev: 'dev' });
    expect(out[0].time).toBe(fmt('2026-07-05T07:10:00Z'));
  });
```

- [ ] **Step 7.2:** `npm test -- --run src/pages/__tests__/dashboardStatus.test.ts` → два новых FAIL.

- [ ] **Step 7.3: Реализация.** В `eventToFeedItem` ветку `message` (строки 136–139) заменить на:

```ts
    case 'message': {
      if (data.role !== 'assistant') return null;
      // Локальное время из ISO-метки события; серверный HH:MM — только запасной вариант
      const time = fmtTime(e.timestamp) || (typeof data.time === 'string' ? data.time : '');
      return { key: `msg-${String(data.id)}`, time, icon: '💬', text: `${agent} ответил` };
    }
```

В `buildFeed` seed-цикл (строки 187–193) заменить на:

```ts
  for (const m of [...seed].reverse()) {
    if (m.role !== 'assistant') continue;
    entries.push({
      sort: m.created_at ?? '',
      item: {
        key: `msg-${m.id}`,
        // Локальное время из created_at; старые записи без created_at показывают серверный HH:MM
        time: m.created_at ? fmtTime(m.created_at) : m.time,
        icon: '💬',
        text: `${m.agent} ответил`,
      },
    });
  }
```

- [ ] **Step 7.4:** `npm test -- --run src/pages/__tests__/dashboardStatus.test.ts` → PASS (старый тест `time: '07:10'` без created_at остаётся валидным — fallback).

- [ ] **Step 7.5: Commit**

```powershell
git add ui/src/pages/dashboardStatus.ts ui/src/pages/__tests__/dashboardStatus.test.ts
git commit -m "fix(ui): лента Обстановки показывает единое локальное время из ISO-меток"
```

---

### Task 8: Login — миграция на ui-библиотеку, русский, снос алиас-токенов

**Files:**
- Rewrite: `ui/src/components/Login.tsx`
- Modify: `ui/src/styles/tokens.css:61-69`

Login — последний потребитель алиасов `--bg-primary`/`--bg-secondary` (Login.tsx:43,51,88); `--danger*`/`--bg-main` не используются нигде. После миграции блок алиасов удаляется.

- [ ] **Step 8.1:** Заменить `Login.tsx` целиком:

```tsx
import { useState, type FormEvent } from 'react';
import { Button, Card, Field, Input } from './ui';

interface LoginProps {
  onLogin: () => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        onLogin();
      } else {
        setError('Неверный пароль');
        setPassword('');
      }
    } catch {
      setError('Нет связи с сервером');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: 'var(--bg-body)',
      padding: 16,
    }}>
      <Card style={{ width: 320, padding: 32 }}>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              <svg width="18" height="18" viewBox="0 0 128 128">
                <polygon fill="#fff" points="0,8 124,4 128,28 4,32"/>
                <polygon fill="#fff" points="14,40 42,38 28,122 0,124"/>
                <polygon fill="#fff" points="72,36 100,34 86,118 58,120"/>
              </svg>
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
              Штаб
            </div>
          </div>

          <Field label="Пароль">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </Field>

          {error && (
            <div style={{ color: 'var(--red)', fontSize: 13 }}>{error}</div>
          )}

          <Button type="submit" busy={loading} disabled={!password}>
            Войти
          </Button>
        </form>
      </Card>
    </div>
  );
}
```

- [ ] **Step 8.2:** Из `tokens.css` удалить блок строк 61–69 (комментарий «Алиасы: …» и правило `:root { --danger: … --bg-main: … }`) целиком.

- [ ] **Step 8.3: Проверка отсутствия потребителей:**

```powershell
cd ui; npx --no-install vite --version > $null  # noop
Select-String -Path src -Pattern 'var\(--(danger|bg-primary|bg-secondary|bg-main)' -Recurse
```

Ожидание: ни одного совпадения. (Классы `ui-btn--danger`/`ui-badge--danger` — имена классов, не токены; они не совпадут с шаблоном.)

- [ ] **Step 8.4:** `npm test -- --run && npm run build` → PASS/OK.

- [ ] **Step 8.5: Commit**

```powershell
git add ui/src/components/Login.tsx ui/src/styles/tokens.css
git commit -m "refactor(ui): Login на ui-библиотеке и русском; алиас-токены удалены"
```

---

### Task 9: Снос легаси-hover: классы каркаса, Card, Связь, Агенты

**Files:**
- Modify: `ui/src/styles/base.css`
- Modify: `ui/src/App.tsx`, `ui/src/components/ui/Card.tsx`, `ui/src/components/ui/Card.css`, `ui/src/pages/Conversations.tsx:244-263`, `ui/src/pages/Agents.tsx:138-158`

После Task 8 у легаси-блока base.css:22–39 остаются потребители: App.tsx (hamburger:105, тема:261, выход:281, NavLink-hover через `nav a`), Card (`data-hover`), Conversations (кнопка агента:244), Agents (`data-agent-start/stop`:140,150). SwarmGraph чинится в Task 14 (те же классы не нужны — свой CSS). Порядок: сначала классы, потом удаление блока.

- [ ] **Step 9.1: Классы каркаса в base.css** — добавить после блока «Плавная смена темы» (после строки 20):

```css
/* Каркас: сайдбар (NavLink и кнопки футера используют один класс) */
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 12px;
  border-radius: 7px;
  border: none;
  background: transparent;
  text-decoration: none;
  font-family: inherit;
  font-size: 16px;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  text-align: left;
}
.nav-item.active { background: var(--accent); color: #fff; font-weight: 600; }
.nav-item:not(.active):hover { background: var(--bg-card-hover); color: var(--text-primary); }
.hamburger:hover { background: var(--bg-card-hover); }

/* Список агентов в «Связи» */
.agent-select {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  border-radius: 7px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-family: inherit;
  font-size: 15px;
  font-weight: 400;
  cursor: pointer;
  text-align: left;
  margin-bottom: 1px;
}
.agent-select--active { background: var(--accent); color: #fff; font-weight: 600; }
.agent-select:not(.agent-select--active):hover { background: var(--bg-card-hover); color: var(--text-primary); }

/* Иконки-действия (запуск/остановка агента) */
.icon-action {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  color: var(--text-muted);
  line-height: 1;
  border-radius: var(--radius-sm);
}
.icon-action--start:hover { color: var(--green); }
.icon-action--stop:hover { color: var(--red); }
```

- [ ] **Step 9.2: App.tsx.** Каждый NavLink навигации (строки 213–234): убрать `style={({ isActive }) => (…)}` целиком и вместо него:

```tsx
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  onClick={closeSidebar}
                  className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                >
                  <Icon />
                  {label}
                </NavLink>
```

Футер (строки 243–300): у ссылки GitHub заменить весь `style={{…}}` на `className="nav-item"`; у кнопок темы и выхода — тоже `className="nav-item"` без inline-style; тексты русифицировать:

```tsx
          <a
            href="https://github.com/mtzanidakis/praktor"
            target="_blank"
            rel="noopener noreferrer"
            className="nav-item"
          >
            <IconGitHub />
            GitHub
          </a>
          <button onClick={toggleTheme} className="nav-item">
            {theme === 'dark' ? <IconSun /> : <IconMoon />}
            {theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
          </button>
          <button onClick={handleLogout} className="nav-item">
            <IconLogout />
            Выйти
          </button>
```

У hamburger-кнопки (строка 126) `aria-label="Open menu"` → `aria-label="Открыть меню"` (inline-стили hamburger оставить — класс `.hamburger` уже управляет мобильным показом, hover добавлен в Step 9.1).

- [ ] **Step 9.3: Card.** В `Card.tsx` убрать `{...(interactive ? { 'data-hover': true } : {})}`:

```tsx
  return (
    <div className={cls} {...rest}>
      {children}
    </div>
  );
```

В `Card.css` добавить:

```css
.ui-card--interactive:hover { background: var(--bg-card-hover); border-color: var(--text-muted); }
```

- [ ] **Step 9.4: Conversations.** Кнопку агента (строки 244–263) перевести на классы — заменить весь `style={{…}}` (кроме ничего — весь) на:

```tsx
              <button
                key={agent.id}
                onClick={() => setSelectedAgentId(agent.id)}
                aria-pressed={selected}
                className={`agent-select${selected ? ' agent-select--active' : ''}`}
              >
```

(вложенные `<span>` точки и имени — без изменений).

- [ ] **Step 9.5: Agents.** У кнопок стоп/старт (строки 139–158) заменить `data-agent-stop` + inline-style на класс:

```tsx
                  <button
                    className="icon-action icon-action--stop"
                    title="Остановить агента"
                    aria-label="Остановить агента"
                    onClick={(e) => { e.stopPropagation(); toggleAgent(agent, 'stop'); }}
                  >
```

и аналогично `className="icon-action icon-action--start"` для запуска (svg внутри — без изменений).

- [ ] **Step 9.6: Удалить легаси-блок** base.css строки 22–39 — от комментария `/* Hover-эффекты (легаси-атрибуты страниц; уйдут в этапе 3) */` до правила `[data-agent-stop]:hover …` включительно. Правило «Плавная смена темы» (строки 17–20) НЕ трогать.

- [ ] **Step 9.7: Проверка:**

```powershell
Select-String -Path ui/src -Pattern 'data-hover|data-agent-start|data-agent-stop' -Recurse
```

→ пусто. `npm test -- --run && npm run build` → PASS/OK.

- [ ] **Step 9.8: Commit**

```powershell
git add ui/src/styles/base.css ui/src/App.tsx ui/src/components/ui/Card.tsx ui/src/components/ui/Card.css ui/src/pages/Conversations.tsx ui/src/pages/Agents.tsx
git commit -m "refactor(ui): hover в классы компонентов, легаси-блок base.css удалён, футер сайдбара на русском"
```

---

### Task 10: Тач-зоны ≥44px

**Files:**
- Modify: `ui/src/styles/base.css`

- [ ] **Step 10.1:** В конец base.css (перед keyframes) добавить:

```css
/* Тач: зоны нажатия ≥44px на устройствах с грубым указателем (палец).
   На десктопе (pointer: fine) размеры не меняются.
   Правило для .ui-input живёт в Field.css: base.css грузится раньше компонентных
   стилей, и базовый min-height оттуда перебил бы override при равной специфичности. */
@media (pointer: coarse) {
  .ui-btn { min-height: 44px; }
  .ui-tab { min-height: 44px; }
  .nav-item { min-height: 44px; }
  .agent-select { min-height: 44px; }
  .icon-action { padding: 14px; } /* 14+16+14 = 44px с иконкой 16px */
  .swarm-editor__agent { min-height: 44px; }
}
```

И в конец `ui/src/components/ui/Field.css`:

```css
/* Тач: ≥44px. Правило здесь, а не в base.css — base.css грузится раньше,
   и при равной специфичности базовый min-height:38px выше перебил бы override. */
@media (pointer: coarse) {
  .ui-input { min-height: 44px; }
}
```

(`.swarm-editor__agent` появится в Task 14 — правило безвредно до того.)

> Примечание ревью: первая редакция плана клала `.ui-input { min-height: 44px; }` в base.css — в собранном бандле это правило оказывалось РАНЬШЕ базового `min-height: 38px` из Field.css и при равной специфичности проигрывало ему; `.icon-action` с padding 12px давал 40px вместо 44. Исправлено в ходе quality-ревью.

- [ ] **Step 10.2:** `npm run build` → OK.

- [ ] **Step 10.3: Commit**

```powershell
git add ui/src/styles/base.css
git commit -m "feat(ui): зоны нажатия >=44px на тач-устройствах (@media pointer: coarse)"
```

---

### Task 11: Overflow у pre/mono-блоков

**Files:**
- Modify: `ui/src/pages/Swarms.tsx:285-295`, `ui/src/pages/Agents.tsx:191`, `ui/src/components/AgentExtensions.tsx:158-165`

- [ ] **Step 11.1: Swarms.** В `<pre>` вывода результата (строки 285–293) добавить `overflowX: 'auto'`:

```tsx
                                <pre style={{
                                  fontSize: 12.5,
                                  color: 'var(--text-secondary)',
                                  whiteSpace: 'pre-wrap',
                                  wordBreak: 'break-word',
                                  maxHeight: 200,
                                  overflowY: 'auto',
                                  overflowX: 'auto',
                                  margin: 0,
                                }}>
```

- [ ] **Step 11.2: Agents.** ID агента (строка 191) — добавить `wordBreak: 'break-all'`:

```tsx
                <span style={{ fontFamily: 'monospace', color: 'var(--text-secondary)', wordBreak: 'break-all' }}>{selected.id}</span>
```

- [ ] **Step 11.3: AgentExtensions.** Mono-строки команд/URL серверов (строки 158–165) — добавить `wordBreak: 'break-all'` в оба блока:

```tsx
          {srv.type === 'stdio' && editing !== name && (
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', wordBreak: 'break-all', ...mono }}>
              {srv.command} {(srv.args || []).join(' ')}
            </div>
          )}
          {srv.type === 'http' && editing !== name && (
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', wordBreak: 'break-all', ...mono }}>{srv.url}</div>
          )}
```

- [ ] **Step 11.4:** `npm run build` → OK.

- [ ] **Step 11.5: Commit**

```powershell
git add ui/src/pages/Swarms.tsx ui/src/pages/Agents.tsx ui/src/components/AgentExtensions.tsx
git commit -m "fix(ui): длинные строки в pre/mono не распирают карточки на узком экране"
```

---

### Task 12: «Связь» как мессенджер на телефоне

**Files:**
- Modify: `ui/src/pages/Conversations.tsx`, `ui/src/styles/base.css`, `ui/index.html`

- [ ] **Step 12.1: index.html.** Строку viewport заменить на:

```html
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

- [ ] **Step 12.2: JSX.** В `Conversations.tsx`:

(a) в импорт ui добавить `Select`;

(b) шапке чата — обернуть имя+бейдж и добавить мобильный пикер (заменить блок строк 299–308):

```tsx
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: '1 1 auto' }}>
              <div className="conversations-agent-picker">
                <Select
                  value={selectedAgentId ?? ''}
                  onChange={(e) => setSelectedAgentId(e.target.value)}
                  aria-label="Агент"
                >
                  {(agents ?? []).map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </Select>
              </div>
              <span className="conversations-agent-name" style={{ fontWeight: 600, fontSize: 17, color: 'var(--text-primary)' }}>
                {selectedAgent?.name ?? 'Выберите агента'}
              </span>
              {selectedAgent && (
                <Badge tone={selectedOnline ? 'ok' : 'neutral'}>
                  {selectedOnline ? 'в сети' : 'выключен'}
                </Badge>
              )}
            </div>
```

(c) форме поиска (строка 310–313) добавить класс:

```tsx
              <form
                onSubmit={(e) => { e.preventDefault(); handleSearch(); }}
                className="conversations-search"
                style={{ display: 'flex', gap: 6, alignItems: 'center' }}
              >
```

(d) форме отправки (строка 402–405) добавить класс:

```tsx
            <form
              onSubmit={(e) => { e.preventDefault(); send(); }}
              className="conversations-composer"
              style={{ display: 'flex', gap: 8, alignItems: 'flex-end', padding: 12, borderTop: '1px solid var(--border)' }}
            >
```

- [ ] **Step 12.3: base.css.** В десктопную часть (рядом с классами каркаса из Task 9) добавить:

```css
/* «Связь»: мобильный выбор агента — на десктопе скрыт */
.conversations-agent-picker { display: none; }
```

В мобильном блоке `@media (max-width: 768px)` заменить две строки про conversations (сейчас `.conversations-layout { flex-direction: column; height: auto !important; min-height: 0 !important; }` и `.conversations-agents { width: 100% !important; max-height: 150px; }`) на:

```css
  /* «Связь» как мессенджер: список агентов скрыт (выбор — Select в шапке),
     высота — динамический вьюпорт (учитывает клавиатуру), композер прижат к низу */
  .conversations-layout {
    height: calc(100vh - 150px) !important;
    height: calc(100dvh - 150px) !important;
  }
  .conversations-agents { display: none !important; }
  .conversations-agent-picker { display: block; flex: 1; min-width: 0; }
  .conversations-agent-name { display: none; }
  .conversations-search { flex: 1 1 100%; }
  .conversations-search .ui-input { flex: 1 1 auto; width: auto !important; }
  .conversations-composer { padding-bottom: calc(12px + env(safe-area-inset-bottom)) !important; }
```

Значение `-150px` стартовое — уточняется при ручной проверке (Task 15). Класс `.conversations-layout` в SwarmGraph перестаёт использоваться в Task 14; до него редактор отрядов на мобилке временно деградирует — это внутри одного PR.

- [ ] **Step 12.4:** `npm test -- --run && npm run build` → PASS/OK (тест Conversations.test.tsx не проверяет мобильную раскладку; Select дублирует выбор — существующие тесты выбора агента кликают кнопки списка, они остались).

- [ ] **Step 12.5: Commit**

```powershell
git add ui/src/pages/Conversations.tsx ui/src/styles/base.css ui/index.html
git commit -m "feat(ui): Связь на телефоне — выбор агента в шапке, высота dvh, композер с safe-area"
```

---

### Task 13: swarmGraphMath — чистая геометрия пан/зум/пинч (TDD)

**Files:**
- Create: `ui/src/components/swarmGraphMath.ts`
- Test: `ui/src/components/swarmGraphMath.test.ts`

- [ ] **Step 13.1: Падающие тесты** — создать `swarmGraphMath.test.ts`:

```ts
import { expect, test } from 'vitest';
import {
  applyPan, applyPinch, applyWheelZoom, clampScale, toGraphPoint,
  MIN_SCALE, MAX_SCALE,
} from './swarmGraphMath';

test('clampScale ограничивает диапазон', () => {
  expect(clampScale(0.01)).toBe(MIN_SCALE);
  expect(clampScale(10)).toBe(MAX_SCALE);
  expect(clampScale(1)).toBe(1);
});

test('toGraphPoint обращает translate+scale', () => {
  const view = { x: 40, y: -20, scale: 2 };
  expect(toGraphPoint(view, { x: 240, y: 180 })).toEqual({ x: 100, y: 100 });
});

test('applyPan сдвигает вид на дельту экрана', () => {
  expect(applyPan({ x: 10, y: 10, scale: 1 }, 5, -3)).toEqual({ x: 15, y: 7, scale: 1 });
});

test('applyWheelZoom: точка под курсором остаётся на месте', () => {
  const view = { x: 0, y: 0, scale: 1 };
  const cursor = { x: 100, y: 50 };
  const out = applyWheelZoom(view, cursor, -100); // deltaY<0 — зум-ин
  expect(out.scale).toBeGreaterThan(1);
  const before = toGraphPoint(view, cursor);
  const after = toGraphPoint(out, cursor);
  expect(after.x).toBeCloseTo(before.x);
  expect(after.y).toBeCloseTo(before.y);
});

test('applyPinch: раздвигание пальцев зумит, центр пинча неподвижен', () => {
  const view = { x: 0, y: 0, scale: 1 };
  const prev1 = { x: 90, y: 100 };
  const prev2 = { x: 110, y: 100 };
  const p1 = { x: 80, y: 100 };
  const p2 = { x: 120, y: 100 };
  const out = applyPinch(view, prev1, prev2, p1, p2);
  expect(out.scale).toBeCloseTo(2);
  const before = toGraphPoint(view, { x: 100, y: 100 });
  const after = toGraphPoint(out, { x: 100, y: 100 });
  expect(after.x).toBeCloseTo(before.x);
  expect(after.y).toBeCloseTo(before.y);
});

test('applyPinch с нулевой прошлой дистанцией не меняет вид', () => {
  const view = { x: 5, y: 5, scale: 1.5 };
  const p = { x: 100, y: 100 };
  expect(applyPinch(view, p, p, { x: 90, y: 100 }, { x: 110, y: 100 })).toEqual(view);
});
```

- [ ] **Step 13.2:** `npm test -- --run src/components/swarmGraphMath.test.ts` → FAIL (модуля нет).

- [ ] **Step 13.3: Реализация** — создать `swarmGraphMath.ts`:

```ts
// Геометрия холста редактора отрядов: вид {x, y, scale} —
// экранная точка = графовая * scale + сдвиг. Чистые функции, тестируются без DOM.

export interface ViewTransform { x: number; y: number; scale: number; }
export interface Point { x: number; y: number; }

export const MIN_SCALE = 0.4;
export const MAX_SCALE = 2.5;

export function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

// Экранная точка → координаты графа
export function toGraphPoint(view: ViewTransform, screen: Point): Point {
  return { x: (screen.x - view.x) / view.scale, y: (screen.y - view.y) / view.scale };
}

// Пан: дельта в экранных пикселях
export function applyPan(view: ViewTransform, dx: number, dy: number): ViewTransform {
  return { ...view, x: view.x + dx, y: view.y + dy };
}

// Зум к точке: точка cursor (экранная) остаётся на месте
function zoomAround(view: ViewTransform, cursor: Point, nextScale: number): ViewTransform {
  const scale = clampScale(nextScale);
  const ratio = scale / view.scale;
  return {
    scale,
    x: cursor.x - (cursor.x - view.x) * ratio,
    y: cursor.y - (cursor.y - view.y) * ratio,
  };
}

// Колесо мыши: шаг 10%, зум вокруг курсора
export function applyWheelZoom(view: ViewTransform, cursor: Point, deltaY: number): ViewTransform {
  return zoomAround(view, cursor, view.scale * (deltaY < 0 ? 1.1 : 1 / 1.1));
}

// Пинч: prev1/prev2 — прошлые экранные позиции пальцев, p1/p2 — текущие.
// Масштаб — по отношению дистанций, центр пинча остаётся на месте.
export function applyPinch(
  view: ViewTransform,
  prev1: Point, prev2: Point,
  p1: Point, p2: Point,
): ViewTransform {
  const prevDist = Math.hypot(prev2.x - prev1.x, prev2.y - prev1.y);
  if (prevDist === 0) return view;
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const center = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const prevCenter = { x: (prev1.x + prev2.x) / 2, y: (prev1.y + prev2.y) / 2 };
  const zoomed = zoomAround(view, prevCenter, view.scale * (dist / prevDist));
  return applyPan(zoomed, center.x - prevCenter.x, center.y - prevCenter.y);
}
```

- [ ] **Step 13.4:** `npm test -- --run src/components/swarmGraphMath.test.ts` → PASS.

- [ ] **Step 13.5: Commit**

```powershell
git add ui/src/components/swarmGraphMath.ts ui/src/components/swarmGraphMath.test.ts
git commit -m "feat(ui): геометрия пан/зум/пинч для тач-редактора отрядов (чистый модуль + тесты)"
```

---

### Task 14: SwarmGraph — тач-редактор

**Files:**
- Rewrite: `ui/src/components/SwarmGraph.tsx`
- Create: `ui/src/components/SwarmGraph.css`

Публичный контракт НЕ меняется: `export default SwarmGraph({ onLaunch, initialData?, launchLabel? })`, типы `GraphNode/GraphEdge/SwarmLaunchData` — как были (Swarms.tsx и swarm-to-launch-data.test.ts не трогаем). Меняется: pointer-events вместо mouse, режим «Связать» вместо хэндлов, пан/зум, ui-компоненты, русский, свой CSS вместо `conversations-layout`.

- [ ] **Step 14.1: CSS** — создать `SwarmGraph.css`:

```css
/* Редактор отрядов: палитра / холст / свойства */
.swarm-editor { display: flex; gap: 16px; height: calc(100vh - 180px); min-height: 500px; }
.swarm-editor__palette { width: 200px; overflow-y: auto; flex-shrink: 0; }
.swarm-editor__canvas { flex: 1; padding: 0 !important; overflow: hidden; position: relative; }
.swarm-editor__props {
  width: 260px;
  overflow-y: auto;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.swarm-editor__svg { display: block; width: 100%; height: 100%; touch-action: none; }
.swarm-editor__toolbar {
  position: absolute;
  top: 10px;
  left: 10px;
  display: flex;
  gap: 8px;
  align-items: center;
  z-index: 1;
}
.swarm-editor__hint {
  font-size: 13px;
  color: var(--accent);
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 4px 8px;
}
.swarm-editor__agent {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px 10px;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: var(--text-primary);
  cursor: pointer;
  font: inherit;
  font-size: 15px;
  margin-bottom: 6px;
}
.swarm-editor__agent:hover:not(:disabled) { background: var(--bg-card-hover); border-color: var(--text-muted); }
.swarm-editor__agent:disabled { opacity: 0.5; cursor: default; background: var(--bg-elevated); color: var(--text-muted); }
.swarm-editor__agent-name { font-weight: 600; }
.swarm-editor__agent-desc { font-size: 13px; color: var(--text-tertiary); margin-top: 2px; font-weight: 400; }
.swarm-editor__section { border-top: 1px solid var(--border); padding-top: 12px; }
.swarm-editor__legend {
  border-top: 1px solid var(--border);
  padding-top: 12px;
  margin-top: auto;
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.8;
}

@media (max-width: 768px) {
  .swarm-editor { flex-direction: column; height: auto; min-height: 0; }
  .swarm-editor__palette { width: 100%; max-height: 150px; }
  .swarm-editor__canvas { flex: none; min-height: 320px; height: 45vh; }
  .swarm-editor__props { width: 100%; }
}
```

- [ ] **Step 14.2: Компонент** — заменить `SwarmGraph.tsx` целиком:

```tsx
import { useState, useRef, useCallback, useEffect } from 'react';
import { Badge, Button, Card, Field, Input, Textarea } from './ui';
import {
  applyPan, applyPinch, applyWheelZoom, toGraphPoint,
  type Point, type ViewTransform,
} from './swarmGraphMath';
import './SwarmGraph.css';

/* ── Types ── */
export interface GraphNode {
  id: string;       // agent definition ID
  role: string;     // display label
  x: number;
  y: number;
  isLead: boolean;
  prompt: string;
}
export interface GraphEdge {
  from: string;     // node id
  to: string;
  bidirectional: boolean;
}
interface AgentDef {
  id: string;
  name: string;
  description: string;
}
export interface SwarmLaunchData {
  name: string;
  task: string;
  lead_agent: string;
  agents: { agent_id: string; role: string; prompt: string; workspace: string }[];
  synapses: { from: string; to: string; bidirectional: boolean }[];
}
interface Props {
  onLaunch: (data: SwarmLaunchData) => void;
  initialData?: SwarmLaunchData;
  launchLabel?: string;
}

/* ── Constants ── */
const NODE_W = 160;
const NODE_H = 64;

export default function SwarmGraph({ onLaunch, initialData, launchLabel }: Props) {
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [task, setTask] = useState('');
  const [initialized, setInitialized] = useState(false);

  // Вид холста (пан/зум) и жесты
  const [view, setView] = useState<ViewTransform>({ x: 0, y: 0, scale: 1 });
  const pointers = useRef(new Map<number, Point>());
  const movedRef = useRef(false);

  // Перетаскивание узла (pointer: мышь и палец едино)
  const [dragging, setDragging] = useState<string | null>(null);
  const dragOffset = useRef<Point>({ x: 0, y: 0 });

  // Режим «Связать»: тап по первому узлу, затем по второму
  const [connectMode, setConnectMode] = useState(false);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    fetch('/api/agents/definitions')
      .then((r) => r.json())
      .then((data) => setAgents(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  // Initialize from initialData once agents are loaded
  useEffect(() => {
    if (initialized || !initialData || agents.length === 0) return;
    setName(initialData.name || '');
    setTask(initialData.task || '');
    const roleToId = new Map(initialData.agents.map((a) => [a.role, a.agent_id]));
    const initNodes: GraphNode[] = initialData.agents.map((a, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      return {
        id: a.agent_id,
        role: a.role,
        x: 80 + col * 220,
        y: 60 + row * 120,
        isLead: a.role === initialData.lead_agent,
        prompt: a.prompt || '',
      };
    });
    setNodes(initNodes);
    const initEdges: GraphEdge[] = (initialData.synapses || []).map((s) => ({
      from: roleToId.get(s.from) || s.from,
      to: roleToId.get(s.to) || s.to,
      bidirectional: s.bidirectional,
    }));
    setEdges(initEdges);
    setInitialized(true);
  }, [agents, initialData, initialized]);

  const getScreenPoint = useCallback((e: { clientX: number; clientY: number }): Point => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  /* ── Add agent node ── */
  const addNode = useCallback((agent: AgentDef) => {
    if (nodes.find((n) => n.id === agent.id)) return;
    const col = nodes.length % 3;
    const row = Math.floor(nodes.length / 3);
    setNodes((prev) => [
      ...prev,
      {
        id: agent.id,
        role: agent.name,
        x: 80 + col * 220,
        y: 60 + row * 120,
        isLead: prev.length === 0,
        prompt: '',
      },
    ]);
    setSelectedNode(agent.id);
  }, [nodes]);

  /* ── Жесты холста: пан одним указателем, пинч двумя, зум колесом ── */
  const onCanvasPointerDown = useCallback((e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, getScreenPoint(e));
    movedRef.current = false;
    svgRef.current?.setPointerCapture(e.pointerId);
  }, [getScreenPoint]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const cur = getScreenPoint(e);

    if (dragging) {
      const gp = toGraphPoint(view, cur);
      setNodes((prev) =>
        prev.map((n) =>
          n.id === dragging
            ? { ...n, x: gp.x - dragOffset.current.x, y: gp.y - dragOffset.current.y }
            : n
        )
      );
      movedRef.current = true;
      return;
    }

    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;

    if (pointers.current.size === 2) {
      const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId);
      if (other) {
        const [, otherPt] = other;
        setView((v) => applyPinch(v, prev, otherPt, cur, otherPt));
        movedRef.current = true;
      }
    } else if (pointers.current.size === 1) {
      setView((v) => applyPan(v, cur.x - prev.x, cur.y - prev.y));
      if (Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y) > 2) movedRef.current = true;
    }
    pointers.current.set(e.pointerId, cur);
  }, [dragging, view, getScreenPoint]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    setDragging(null);
  }, []);

  // Колесо: React вешает wheel пассивно — preventDefault работает только у нативного listener
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      setView((v) => applyWheelZoom(v, { x: e.clientX - rect.left, y: e.clientY - rect.top }, e.deltaY));
    };
    svg.addEventListener('wheel', onWheelNative, { passive: false });
    return () => svg.removeEventListener('wheel', onWheelNative);
  }, []);

  /* ── Узлы: перетаскивание и тап ── */
  const onNodePointerDown = useCallback((e: React.PointerEvent, nodeId: string) => {
    if (connectMode) return; // в режиме связывания узлы не таскаем
    e.stopPropagation();
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const gp = toGraphPoint(view, getScreenPoint(e));
    dragOffset.current = { x: gp.x - node.x, y: gp.y - node.y };
    setDragging(nodeId);
    movedRef.current = false;
    svgRef.current?.setPointerCapture(e.pointerId);
  }, [connectMode, nodes, view, getScreenPoint]);

  const onNodeTap = useCallback((nodeId: string) => {
    if (connectMode) {
      if (!connectFrom) {
        setConnectFrom(nodeId);
        return;
      }
      if (connectFrom !== nodeId) {
        const exists = edges.some(
          (ed) =>
            (ed.from === connectFrom && ed.to === nodeId) ||
            (ed.from === nodeId && ed.to === connectFrom)
        );
        if (!exists) {
          setEdges((prev) => [...prev, { from: connectFrom, to: nodeId, bidirectional: false }]);
        }
      }
      setConnectFrom(null);
      setConnectMode(false);
      return;
    }
    setSelectedNode(nodeId);
    setSelectedEdge(null);
  }, [connectMode, connectFrom, edges]);

  /* ── Remove / lead / prompt ── */
  const removeNode = useCallback((nodeId: string) => {
    setNodes((prev) => {
      const remaining = prev.filter((n) => n.id !== nodeId);
      if (remaining.length > 0 && !remaining.some((n) => n.isLead)) {
        remaining[0].isLead = true;
      }
      return remaining;
    });
    setEdges((prev) => prev.filter((e) => e.from !== nodeId && e.to !== nodeId));
    if (selectedNode === nodeId) setSelectedNode(null);
  }, [selectedNode]);

  const removeEdge = useCallback((idx: number) => {
    setEdges((prev) => prev.filter((_, i) => i !== idx));
    setSelectedEdge(null);
  }, []);

  const toggleEdgeDirection = useCallback((idx: number) => {
    setEdges((prev) =>
      prev.map((e, i) => (i === idx ? { ...e, bidirectional: !e.bidirectional } : e))
    );
  }, []);

  const setLead = useCallback((nodeId: string) => {
    setNodes((prev) => prev.map((n) => ({ ...n, isLead: n.id === nodeId })));
  }, []);

  const updatePrompt = useCallback((nodeId: string, prompt: string) => {
    setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, prompt } : n)));
  }, []);

  /* ── Launch ── */
  const handleLaunch = useCallback(() => {
    const leadNode = nodes.find((n) => n.isLead);
    if (!leadNode || !task.trim()) return;
    onLaunch({
      name: name || 'Swarm',
      task,
      lead_agent: leadNode.role,
      agents: nodes.map((n) => ({
        agent_id: n.id,
        role: n.role,
        prompt: n.prompt,
        workspace: n.id,
      })),
      synapses: edges.map((e) => {
        const fromNode = nodes.find((n) => n.id === e.from);
        const toNode = nodes.find((n) => n.id === e.to);
        return {
          from: fromNode?.role || e.from,
          to: toNode?.role || e.to,
          bidirectional: e.bidirectional,
        };
      }),
    });
  }, [nodes, edges, name, task, onLaunch]);

  const selectedNodeObj = nodes.find((n) => n.id === selectedNode);
  const selectedEdgeObj = selectedEdge !== null ? edges[selectedEdge] : null;

  return (
    <div className="swarm-editor">
      {/* Палитра агентов */}
      <Card className="swarm-editor__palette">
        <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
          Агенты
        </h3>
        <div>
          {agents.map((a) => {
            const added = nodes.some((n) => n.id === a.id);
            return (
              <button
                key={a.id}
                type="button"
                className="swarm-editor__agent"
                onClick={() => addNode(a)}
                disabled={added}
              >
                <div className="swarm-editor__agent-name">{a.name}</div>
                {a.description && (
                  <div className="swarm-editor__agent-desc">
                    {a.description.length > 60 ? a.description.slice(0, 60) + '…' : a.description}
                  </div>
                )}
              </button>
            );
          })}
          {agents.length === 0 && (
            <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>Агенты не определены</div>
          )}
        </div>
      </Card>

      {/* Холст */}
      <Card className="swarm-editor__canvas">
        <div className="swarm-editor__toolbar">
          <Button
            size="sm"
            variant={connectMode ? 'primary' : 'secondary'}
            onClick={() => { setConnectMode((m) => !m); setConnectFrom(null); }}
          >
            Связать
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setView({ x: 0, y: 0, scale: 1 })}>
            Сбросить вид
          </Button>
          {connectMode && (
            <span className="swarm-editor__hint">
              {connectFrom ? 'Коснитесь второго агента' : 'Коснитесь первого агента'}
            </span>
          )}
        </div>
        <svg
          ref={svgRef}
          className="swarm-editor__svg"
          style={{ cursor: dragging ? 'grabbing' : 'default' }}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClick={() => {
            if (movedRef.current) return; // после пана/драга тап не считается
            setSelectedNode(null);
            setSelectedEdge(null);
            setConnectFrom(null);
          }}
        >
          <defs>
            <marker id="arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <path d="M0,0 L8,3 L0,6" fill="var(--text-tertiary)" />
            </marker>
            <marker id="arrow-selected" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <path d="M0,0 L8,3 L0,6" fill="var(--accent)" />
            </marker>
          </defs>

          <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
            {/* Рёбра */}
            {edges.map((edge, i) => {
              const fromNode = nodes.find((n) => n.id === edge.from);
              const toNode = nodes.find((n) => n.id === edge.to);
              if (!fromNode || !toNode) return null;
              const fx = fromNode.x + NODE_W / 2;
              const fy = fromNode.y + NODE_H / 2;
              const tx = toNode.x + NODE_W / 2;
              const ty = toNode.y + NODE_H / 2;
              const isSelected = selectedEdge === i;
              const color = isSelected ? 'var(--accent)' : 'var(--text-tertiary)';
              const markerEnd = edge.bidirectional ? undefined : `url(#arrow${isSelected ? '-selected' : ''})`;
              const markerStart = edge.bidirectional ? `url(#arrow${isSelected ? '-selected' : ''})` : undefined;
              return (
                <g key={`edge-${i}`}>
                  <line
                    x1={fx} y1={fy} x2={tx} y2={ty}
                    stroke="transparent" strokeWidth={24}
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => { e.stopPropagation(); setSelectedEdge(i); setSelectedNode(null); }}
                  />
                  <line
                    x1={fx} y1={fy} x2={tx} y2={ty}
                    stroke={color}
                    strokeWidth={isSelected ? 2.5 : 1.5}
                    markerEnd={markerEnd}
                    markerStart={markerStart}
                    strokeDasharray={edge.bidirectional ? '6,4' : undefined}
                    style={{ pointerEvents: 'none' }}
                  />
                  {edge.bidirectional && (
                    <text
                      x={(fx + tx) / 2} y={(fy + ty) / 2 - 8}
                      textAnchor="middle" fontSize={12} fill={color}
                      style={{ pointerEvents: 'none' }}
                    >
                      чат
                    </text>
                  )}
                </g>
              );
            })}

            {/* Узлы */}
            {nodes.map((node) => {
              const isSelected = selectedNode === node.id;
              const isConnectSource = connectFrom === node.id;
              return (
                <g key={node.id}>
                  <rect
                    x={node.x} y={node.y}
                    width={NODE_W} height={NODE_H}
                    rx={10}
                    fill="var(--bg-elevated)"
                    stroke={
                      isConnectSource ? 'var(--accent)'
                        : node.isLead ? '#f59e0b'
                        : isSelected ? 'var(--accent)'
                        : 'var(--border)'
                    }
                    strokeWidth={isConnectSource || node.isLead || isSelected ? 2.5 : 1}
                    strokeDasharray={isConnectSource ? '6,4' : undefined}
                    style={{ cursor: connectMode ? 'pointer' : 'grab' }}
                    onPointerDown={(e) => onNodePointerDown(e, node.id)}
                    onClick={(e) => { e.stopPropagation(); if (!movedRef.current) onNodeTap(node.id); }}
                  />
                  <text
                    x={node.x + NODE_W / 2} y={node.y + 26}
                    textAnchor="middle"
                    fontSize={15} fontWeight={600}
                    fill="var(--text-primary)"
                    style={{ pointerEvents: 'none' }}
                  >
                    {node.role.length > 16 ? node.role.slice(0, 14) + '..' : node.role}
                  </text>
                  <text
                    x={node.x + NODE_W / 2} y={node.y + 44}
                    textAnchor="middle"
                    fontSize={12}
                    fill="var(--text-muted)"
                    style={{ pointerEvents: 'none' }}
                  >
                    {node.id}
                  </text>
                  {node.isLead && (
                    <text
                      x={node.x + NODE_W - 12} y={node.y + 16}
                      fontSize={16} style={{ pointerEvents: 'none' }}
                    >
                      {'★'}
                    </text>
                  )}
                </g>
              );
            })}
          </g>

          {/* Пустой холст */}
          {nodes.length === 0 && (
            <text x="50%" y="50%" textAnchor="middle" fontSize={16} fill="var(--text-muted)">
              Добавьте агентов из палитры
            </text>
          )}
        </svg>
      </Card>

      {/* Свойства */}
      <Card className="swarm-editor__props">
        <Field label="Название отряда">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Исследовательская группа"
          />
        </Field>
        <Field label="Задача">
          <Textarea
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Что отряд должен сделать…"
            style={{ minHeight: 80 }}
          />
        </Field>

        {selectedNodeObj && (
          <div className="swarm-editor__section">
            <h4 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
              {selectedNodeObj.role}
              {selectedNodeObj.isLead && <Badge tone="warn" style={{ marginLeft: 8 }}>ведущий</Badge>}
            </h4>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {!selectedNodeObj.isLead && (
                <Button size="sm" variant="secondary" onClick={() => setLead(selectedNodeObj.id)}>
                  {'★'} Назначить ведущим
                </Button>
              )}
              <Button size="sm" variant="danger" onClick={() => removeNode(selectedNodeObj.id)}>
                Убрать
              </Button>
            </div>
            <Field label="Инструкции агенту">
              <Textarea
                value={selectedNodeObj.prompt}
                onChange={(e) => updatePrompt(selectedNodeObj.id, e.target.value)}
                placeholder="Роль этого агента в отряде…"
                style={{ minHeight: 60 }}
              />
            </Field>
          </div>
        )}

        {selectedEdgeObj && (
          <div className="swarm-editor__section">
            <h4 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
              Связь
            </h4>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 8 }}>
              {nodes.find((n) => n.id === selectedEdgeObj.from)?.role}
              {selectedEdgeObj.bidirectional ? ' ↔ ' : ' → '}
              {nodes.find((n) => n.id === selectedEdgeObj.to)?.role}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <Button size="sm" variant="secondary" onClick={() => toggleEdgeDirection(selectedEdge!)}>
                {selectedEdgeObj.bidirectional ? 'Совместно ↔' : 'Конвейер →'}
              </Button>
              <Button size="sm" variant="danger" onClick={() => removeEdge(selectedEdge!)}>
                Удалить
              </Button>
            </div>
          </div>
        )}

        <div className="swarm-editor__legend">
          <div>{'→'} Конвейер: B ждёт результат A</div>
          <div>{'↔'} Совместно: общий чат</div>
          <div>Без связи: параллельно</div>
          <div>{'★'} Ведущий: сводит результаты</div>
        </div>

        <Button
          style={{ width: '100%' }}
          disabled={nodes.length < 2 || !task.trim()}
          onClick={handleLaunch}
        >
          {launchLabel || `Запустить отряд (${nodes.length})`}
        </Button>
      </Card>
    </div>
  );
}
```

> Примечание ревью: первая редакция встроенного кода компонента содержала пять дефектов, найденных quality-ревью и исправленных фикс-коммитом поверх Step 14.2:
> 1. (Critical) onClick hit-box'а ребра не проверял `movedRef` — пан, начатый на широкой (24px) невидимой линии, при отпускании выделял ребро;
> 2. (Important) любое 1px-дрожание при клике по узлу взводило `movedRef` и гасило выделение, а после настоящего драга узел не выделялся (регресс к старому UX) — теперь выделение работает и после перетаскивания, чистый тап обязателен только для связывания;
> 3. (Important) `dragging`/`dragOffset` не были привязаны к `pointerId` — второй палец на другом узле перехватывал драг; добавлен `dragPointer`-ref, второй палец игнорируется;
> 4. (Minor) второй палец пинча сбрасывал `movedRef` идущего пана;
> 5. (Minor) `removeNode` мутировал объект узла из прежнего состояния (`remaining[0].isLead = true`) — заменено на иммутабельный `map`.

- [ ] **Step 14.3:** `npm test -- --run && npm run build` → PASS/OK (swarm-to-launch-data.test.ts не зависит от компонента; Swarms.tsx использует прежний контракт).

- [ ] **Step 14.4: Проверка остатков:** `Select-String -Path ui/src/components/SwarmGraph.tsx -Pattern 'onMouse|conversations-'` → пусто.

- [ ] **Step 14.5: Commit**

```powershell
git add ui/src/components/SwarmGraph.tsx ui/src/components/SwarmGraph.css
git commit -m "feat(ui): тач-редактор отрядов — pointer-events, режим Связать, пан/зум, русский"
```

---

### Task 15: Финальная верификация, CLAUDE.md, ручная проверка

**Files:**
- Modify: `CLAUDE.md` (строка описания SwarmGraph.tsx)

- [ ] **Step 15.1: CLAUDE.md.** Строку `ui/src/components/SwarmGraph.tsx   # SVG-based visual graph editor for swarm topology` (раздел Project Structure) заменить на:

```
  src/components/SwarmGraph.tsx  # SVG graph editor: pointer-events (touch+mouse), connect mode, pan/zoom
```

(сохранить выравнивание соседних строк).

- [ ] **Step 15.2: Полный прогон** (контролёр выполняет сам, отчётам исполнителей не верить):

```powershell
cd <worktree>\ui
npm test -- --run          # весь suite; при флаке — перепрогнать
npm run build              # vite build без ошибок
cd <worktree>
& "C:\Program Files\Go\bin\go.exe" test ./internal/...   # Go не менялся, но прогнать
```

golangci-lint на машине отсутствует — в PR честно пометить «линт не прогнан».

- [ ] **Step 15.3: Ручная браузерная проверка** (десктоп + мобильная ширина ≤768px / эмуляция тача в DevTools). Требует запущенного gateway; если в сессии его поднять нельзя — оформить чек-лист в PR как ручную проверку Alex. Чек-лист:
  - **Этап 6:** Login (русский, вход/ошибка); сайдбар — hover пунктов, «Светлая тема»/«Выйти»; Связь на телефоне — выбор агента через Select, композер у низа, клавиатура не перекрывает ввод; Связь на десктопе — список слева как раньше; редактор отрядов: добавление агентов, перетаскивание узлов мышью и пальцем, «Связать» (тап по двум узлам), переключение Конвейер/Совместно, пан/пинч/колесо, «Сбросить вид», запуск отряда; вкладки Приёмной/Разведки/Расширений — переключение стрелками, ввод в форме переживает переключение; повторная ошибка держит тост; Арсенал/Радар/Сводки с выключенным gateway-эндпоинтом показывают баннер (проверить обрывом сети в DevTools); «Отклонить» план заблокирован при пустой причине; лента «Обстановки» — одинаковый формат времени у всех строк.
  - **Отложенное с этапа 5:** Dashboard — чипы, карточки «Требует решения» с действиями, живая лента по WS (десктоп + мобилка).

- [ ] **Step 15.4: Commit + итог**

```powershell
git add CLAUDE.md
git commit -m "docs: SwarmGraph — тач-редактор в описании структуры"
```

Ветка готова к push и PR (только по команде Alex / по конвейеру этапа): заголовок `feat(ui): Штаб, этап 6 — тач/мобильная полировка`, в теле — чек-лист ручной проверки из Step 15.3 и пометка про линт.

---

## Self-Review (выполнен при написании плана)

- Покрытие спеки §7: граф-редактор (Task 13–14), «Связь»-мессенджер (Task 12), зоны ≥44px (Task 10), pre-скролл (Task 11), сетки в 1 колонку — уже сделаны в этапах 3–5 (`.dashboard-grid`/`.form-grid-2col`), bottom-sheet модалок — уже есть (Modal.css:23–27), safe-area/viewport-fit (Task 12). §8 «Отряды: тач-редактор» — Task 14. Заметки этапа 6 из памяти: fetch-гонки (Task 3), Tabs (Task 2), Catalog (Task 4), Radar/Intel (Task 4), Toast TTL (Task 1), rejectPlan (Task 5), Swarms-дебаунс (Task 6), времена ленты (Task 7), Login+алиасы (Task 8), легаси-hover (Task 9), ручная проверка этапа 5 (Task 15).
- Вне объёма (осознанно): унификация интервалов поллинга (§6 спеки — тема этапов миграции, в заметках этапа 6 её нет); drag-to-dismiss у bottom-sheet; PWA-манифест (спека: «PWA-мета остаются как есть»); маска секретов.
- Типы согласованы: `TabPanel(id, active, children)` единообразен в Task 2; `ViewTransform/Point` из swarmGraphMath используются в Task 14; `confirmDisabled` в Task 5 совпадает у ConfirmDialog и обоих потребителей.
