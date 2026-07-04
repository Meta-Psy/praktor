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
