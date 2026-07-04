import { useState, useEffect, useRef } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import type { WsEvent } from '../contexts/WebSocketContext';
import {
  Badge, Button, Card, EmptyState, Input, PageHeader, Skeleton, Spinner, Textarea, useToast,
} from '../components/ui';

interface Agent {
  id: string;
  name: string;
}

interface Message {
  id: string;
  role: string;
  text: string;
  time: string;
  terminal_reason?: string;
}

// Данные WS-события type=message: id приходит числом (REST отдаёт строкой)
type WsMessageData = {
  id: string | number;
  role: string;
  text: string;
  time: string;
  terminal_reason?: string;
};

function Conversations() {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // awaiting: агент «печатает». Снимается при получении ответа (assistant-сообщение) или
  // при agent_stopped (тихое завершение без текста — известное ограничение, лечится кнопкой «Отменить»).
  const [awaiting, setAwaiting] = useState<Record<string, boolean>>({});
  const [sendingIds, setSendingIds] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchActive, setSearchActive] = useState(false);
  const { events } = useWebSocket();
  const toast = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastSeenRef = useRef<WsEvent | null>(null);
  const fetchEpoch = useRef(0);

  useEffect(() => {
    fetch('/api/agents/definitions')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        const a: Agent[] = Array.isArray(data) ? data : [];
        setAgents(a);
        setSelectedAgentId((cur) => cur ?? a[0]?.id ?? null);
        setLoadError(null);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)));

    fetch('/api/agents')
      .then((res) => res.json())
      .then((data) => {
        if (!Array.isArray(data)) return;
        setRunningIds(new Set(data.map((c: { agent_id: string }) => c.agent_id)));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedAgentId) return;
    setSearchQuery('');
    setSearchActive(false);
    setMessages(null);
    const epoch = ++fetchEpoch.current;
    fetch(`/api/agents/definitions/${selectedAgentId}/messages`)
      .then((res) => res.json())
      .then((data) => {
        if (fetchEpoch.current !== epoch) return;
        setMessages(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (fetchEpoch.current !== epoch) return;
        setMessages([]);
      });
  }, [selectedAgentId]);

  // Обработка одного WS-события: статусы контейнеров и новые сообщения
  const processEvent = (ev: WsEvent) => {
    const aid = ev.agent_id;
    if (!aid) return;

    if (ev.type === 'agent_started') {
      setRunningIds((prev) => new Set(prev).add(aid));
      return;
    }
    if (ev.type === 'agent_stopped') {
      setRunningIds((prev) => {
        const next = new Set(prev);
        next.delete(aid);
        return next;
      });
      // Тихое завершение (агент отработал без message-события) не должно оставлять «печатает…» навечно.
      setAwaiting((prev) => (prev[aid] ? { ...prev, [aid]: false } : prev));
      return;
    }
    if (ev.type !== 'message') return;

    const d = (ev.data ?? null) as WsMessageData | null;
    if (!d || d.id === undefined) return;
    const msg: Message = { ...d, id: String(d.id) };

    if (msg.role === 'assistant') {
      setAwaiting((prev) => (prev[aid] ? { ...prev, [aid]: false } : prev));
    }
    if (aid === selectedAgentId && !searchActive) {
      setMessages((prev) => {
        const list = prev ?? [];
        if (list.some((m) => m.id === msg.id)) return list;
        return [...list, msg];
      });
    }
  };

  // Живые события: курсор по ссылке на последний обработанный элемент — индексы
  // сдвигаются, т.к. провайдер обрезает массив events до последних 500.
  useEffect(() => {
    if (events.length === 0) return;
    let start = 0;
    if (lastSeenRef.current) {
      const idx = events.lastIndexOf(lastSeenRef.current);
      start = idx >= 0 ? idx + 1 : 0;
    }
    for (let i = start; i < events.length; i++) {
      processEvent(events[i]);
    }
    lastSeenRef.current = events[events.length - 1];
  }, [events, selectedAgentId, searchActive]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const draft = selectedAgentId ? (drafts[selectedAgentId] ?? '') : '';

  const send = async () => {
    const text = draft.trim();
    if (!text || !selectedAgentId || sendingIds[selectedAgentId]) return;
    const agentID = selectedAgentId;
    setSendingIds((prev) => ({ ...prev, [agentID]: true }));
    try {
      const res = await fetch(`/api/agents/definitions/${agentID}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      setDrafts((prev) => ({ ...prev, [agentID]: '' }));
      setAwaiting((prev) => ({ ...prev, [agentID]: true }));
    } catch (err) {
      toast.error(`Не удалось отправить: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSendingIds((prev) => ({ ...prev, [agentID]: false }));
    }
  };

  const abort = async () => {
    if (!selectedAgentId) return;
    const agentID = selectedAgentId;
    try {
      const res = await fetch(`/api/agents/definitions/${agentID}/abort`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAwaiting((prev) => ({ ...prev, [agentID]: false }));
    } catch (err) {
      toast.error(`Не удалось отменить: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleSearch = () => {
    if (!selectedAgentId || !searchQuery.trim()) return;
    setIsSearching(true);
    setSearchActive(true);
    const epoch = ++fetchEpoch.current;
    fetch(`/api/agents/definitions/${selectedAgentId}/messages/search?q=${encodeURIComponent(searchQuery.trim())}`)
      .then((res) => res.json())
      .then((data) => {
        if (fetchEpoch.current !== epoch) return;
        setMessages(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (fetchEpoch.current !== epoch) return;
        setMessages([]);
      })
      .finally(() => setIsSearching(false));
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSearchActive(false);
    if (!selectedAgentId) return;
    setMessages(null);
    const epoch = ++fetchEpoch.current;
    fetch(`/api/agents/definitions/${selectedAgentId}/messages`)
      .then((res) => res.json())
      .then((data) => {
        if (fetchEpoch.current !== epoch) return;
        setMessages(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (fetchEpoch.current !== epoch) return;
        setMessages([]);
      });
  };

  const selectedAgent = agents?.find((a) => a.id === selectedAgentId) ?? null;
  const agentAwaiting = selectedAgentId ? !!awaiting[selectedAgentId] : false;
  const selectedOnline = selectedAgentId ? runningIds.has(selectedAgentId) : false;
  const sending = selectedAgentId ? !!sendingIds[selectedAgentId] : false;

  return (
    <div>
      <PageHeader title="Связь" subtitle="Чат с агентами — история общая с Telegram" />

      {loadError && (
        <Card style={{ color: 'var(--red)', marginBottom: 16 }}>
          Не удалось загрузить агентов: {loadError}
        </Card>
      )}

      <div className="conversations-layout" style={{ display: 'flex', gap: 16, height: 'calc(100vh - 170px)' }}>
        {/* Список агентов */}
        <Card className="conversations-agents" style={{ width: 200, padding: 6, overflowY: 'auto', flexShrink: 0 }}>
          {agents === null && !loadError && <Skeleton lines={4} />}
          {(agents ?? []).map((agent) => {
            const selected = selectedAgentId === agent.id;
            const online = runningIds.has(agent.id);
            return (
              <button
                key={agent.id}
                onClick={() => setSelectedAgentId(agent.id)}
                aria-pressed={selected}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 7,
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: 15,
                  fontWeight: selected ? 600 : 400,
                  background: selected ? 'var(--accent)' : 'transparent',
                  color: selected ? '#fff' : 'var(--text-secondary)',
                  marginBottom: 1,
                }}
              >
                <span
                  title={online ? 'Контейнер запущен' : 'Контейнер остановлен'}
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    flexShrink: 0,
                    background: online ? 'var(--green)' : 'var(--text-muted)',
                  }}
                />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {agent.name}
                </span>
              </button>
            );
          })}
          {agents !== null && agents.length === 0 && !loadError && (
            <div style={{ padding: 12, color: 'var(--text-tertiary)', fontSize: 14 }}>
              Агентов нет — добавьте их в конфигурацию praktor.yaml.
            </div>
          )}
        </Card>

        {/* Чат */}
        <Card style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 }}>
          <div style={{
            padding: '12px 20px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontWeight: 600, fontSize: 17, color: 'var(--text-primary)' }}>
                {selectedAgent?.name ?? 'Выберите агента'}
              </span>
              {selectedAgent && (
                <Badge tone={selectedOnline ? 'ok' : 'neutral'}>
                  {selectedOnline ? 'в сети' : 'выключен'}
                </Badge>
              )}
            </div>
            {selectedAgentId && (
              <form
                onSubmit={(e) => { e.preventDefault(); handleSearch(); }}
                style={{ display: 'flex', gap: 6, alignItems: 'center' }}
              >
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Поиск по истории…"
                  style={{ width: 190, padding: '5px 10px', fontSize: 14 }}
                />
                <Button type="submit" size="sm" variant="secondary" busy={isSearching} disabled={!searchQuery.trim()}>
                  Найти
                </Button>
                {searchActive && (
                  <Button size="sm" variant="secondary" onClick={clearSearch}>
                    Сбросить
                  </Button>
                )}
              </form>
            )}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {searchActive && (
              <div style={{ color: 'var(--text-tertiary)', fontSize: 14, marginBottom: 8 }}>
                Результаты поиска «{searchQuery}» — {messages?.length ?? 0}
              </div>
            )}
            {(messages === null || isSearching) && <Skeleton lines={4} />}
            {messages !== null && !isSearching && messages.length === 0 && (
              searchActive ? (
                <div style={{ color: 'var(--text-tertiary)', fontSize: 15 }}>Ничего не найдено</div>
              ) : (
                <EmptyState
                  title="Сообщений ещё нет"
                  hint="Напишите агенту — история чата общая с Telegram, ответ придёт сюда."
                />
              )
            )}
            {!isSearching && (messages ?? []).map((msg) => {
              const isAssistant = msg.role === 'assistant';
              return (
                <div
                  key={msg.id}
                  style={{
                    alignSelf: isAssistant ? 'flex-start' : 'flex-end',
                    maxWidth: '75%',
                    padding: '10px 14px',
                    borderRadius: 10,
                    background: isAssistant ? 'var(--accent-muted)' : 'var(--bg-elevated)',
                    borderLeft: isAssistant ? '3px solid var(--accent)' : 'none',
                    fontSize: 15,
                  }}
                >
                  <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 4 }}>
                    <span style={{ color: isAssistant ? 'var(--accent)' : 'var(--text-secondary)', fontWeight: 600 }}>
                      {isAssistant ? (selectedAgent?.name ?? 'агент') : 'вы'}
                    </span>
                    {msg.time && <span style={{ marginLeft: 8 }}>{msg.time}</span>}
                  </div>
                  <div style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {msg.text}
                  </div>
                  {msg.terminal_reason && msg.terminal_reason !== 'completed' && (
                    <Badge tone="warn" style={{ marginTop: 6 }}>
                      {msg.terminal_reason.replace(/_/g, ' ')}
                    </Badge>
                  )}
                </div>
              );
            })}
            {agentAwaiting && (
              <div style={{
                alignSelf: 'flex-start',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 14px',
                borderRadius: 10,
                background: 'var(--accent-muted)',
                fontSize: 14,
                color: 'var(--text-secondary)',
              }}>
                <Spinner size={12} />
                печатает…
                <Button size="sm" variant="secondary" onClick={abort}>Отменить</Button>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {selectedAgentId && (
            <form
              onSubmit={(e) => { e.preventDefault(); send(); }}
              style={{ display: 'flex', gap: 8, alignItems: 'flex-end', padding: 12, borderTop: '1px solid var(--border)' }}
            >
              <Textarea
                rows={2}
                value={draft}
                placeholder="Сообщение агенту…"
                title="Enter — отправить, Shift+Enter — перенос строки"
                onChange={(e) => setDrafts((prev) => ({ ...prev, [selectedAgentId]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                style={{ flex: 1, resize: 'none' }}
              />
              <Button type="submit" busy={sending} disabled={!draft.trim()}>
                Отправить
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}

export default Conversations;
