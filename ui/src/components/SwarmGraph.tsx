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
