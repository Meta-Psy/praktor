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
