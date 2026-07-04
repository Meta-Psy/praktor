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
    return () => clearTimeout(debounceRef.current);
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
      // Откат только своей задачи: снимок всего массива затёр бы обновления,
      // пришедшие от WS-рефетча за время запроса
      setTasks((ts) => (ts ?? []).map((t) =>
        t.id === task.id ? { ...t, enabled: task.enabled, status: task.status } : t,
      ));
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
