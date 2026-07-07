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
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    fetch('/api/agents/capabilities')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((d: CatalogResponse) => { setData(d); setLoadError(null); })
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, []);
  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <PageHeader title="Арсенал" subtitle="Каталог возможностей агентов: инструменты, память, расширения" />
      {loadError && (
        <Card style={{ color: 'var(--red)', marginBottom: 12 }}>
          Не удалось загрузить каталог: {loadError}
        </Card>
      )}
      <Card style={{ marginBottom: 12, color: 'var(--text-secondary)' }}>
        Профиль пользователя: {data?.user_profile_present ? 'задан' : 'не задан'}
      </Card>
      {data === null && !loadError && <Skeleton lines={3} />}
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
