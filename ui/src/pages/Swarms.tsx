import { useState, useEffect, useCallback, useRef } from 'react';
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
                                  overflowX: 'auto',
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
