import { useState, useEffect, useCallback } from 'react';
import {
  formatMemory, capabilityGroups,
  type CatalogResponse, type AgentCapabilities,
} from './catalogStatus';

const card: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: 10, padding: 16, boxShadow: 'var(--shadow)', marginBottom: 12,
};
const chip: React.CSSProperties = {
  display: 'inline-block', padding: '2px 8px', borderRadius: 6,
  border: '1px solid var(--border)', fontSize: 12, marginRight: 6, marginTop: 4,
};
const btn: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)',
  cursor: 'pointer', fontSize: 13, background: 'transparent', color: 'inherit',
};

function AgentCard({ a }: { a: AgentCapabilities }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <strong>{a.agent_id}</strong>
          {a.restricted && (
            <span style={{ ...chip, borderColor: 'crimson', color: 'crimson' }}>restricted</span>
          )}
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {a.model} · память: {formatMemory(a.memory)}
          </div>
          <div>
            {capabilityGroups(a).map((g) => (
              <span key={g} style={chip}>{g}</span>
            ))}
          </div>
        </div>
        <button style={btn} onClick={() => setOpen((v) => !v)}>
          {open ? 'Скрыть' : 'Детали'}
        </button>
      </div>
      {open && (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12, fontSize: 14 }}>
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
              : `MCP: ${a.extensions.mcp_servers.join(', ') || '—'}; skills: ${a.extensions.skills.join(', ') || '—'}; plugins: ${a.extensions.plugins.join(', ') || '—'}`}
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
    </div>
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
      <h1 style={{ marginBottom: 16 }}>Арсенал</h1>
      <div style={{ ...card, color: 'var(--text-secondary)' }}>
        Профиль пользователя: {data?.user_profile_present ? 'задан' : 'не задан'}
      </div>
      {data?.agents.length === 0 && <div style={card}>Нет агентов.</div>}
      {data?.agents.map((a) => <AgentCard key={a.agent_id} a={a} />)}
    </div>
  );
}

export default Catalog;
