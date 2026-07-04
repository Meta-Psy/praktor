import { useState, useEffect, useCallback, useRef } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, PageHeader,
  Select, Skeleton, Textarea, useToast,
} from '../components/ui';

interface Secret {
  id: string;
  name: string;
  description: string;
  kind: string;
  filename?: string;
  global: boolean;
  agent_ids: string[];
  created_at: string;
  updated_at: string;
}

interface Agent {
  id: string;
  name: string;
}

interface SecretForm {
  name: string;
  description: string;
  kind: string;
  filename: string;
  value: string;
  global: boolean;
  agent_ids: string[];
}

const emptyForm: SecretForm = { name: '', description: '', kind: 'string', filename: '', value: '', global: false, agent_ids: [] };

function Secrets() {
  const [secrets, setSecrets] = useState<Secret[] | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [form, setForm] = useState<SecretForm>(emptyForm);
  const [editing, setEditing] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const toast = useToast();
  const { events } = useWebSocket();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const fetchSecrets = useCallback(() => {
    fetch('/api/secrets')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setSecrets(Array.isArray(data) ? data : []);
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
    fetchSecrets();
    fetchAgents();
    // Poll for changes from external sources (CLI, etc.)
    const interval = setInterval(fetchSecrets, 5000);
    return () => clearInterval(interval);
  }, [fetchSecrets, fetchAgents]);

  // Re-fetch immediately on WebSocket secret events (debounced)
  useEffect(() => {
    if (events.length === 0) return;
    const last = events[events.length - 1];
    if (typeof last.type === 'string' && last.type.startsWith('events.secret.')) {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(fetchSecrets, 500);
    }
  }, [events.length, fetchSecrets]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const url = editing ? `/api/secrets/${editing}` : '/api/secrets';
      const method = editing ? 'PUT' : 'POST';

      const body: Record<string, unknown> = {
        name: form.name,
        description: form.description,
        kind: form.kind,
        global: form.global,
        agent_ids: form.agent_ids,
      };

      if (form.kind === 'file') {
        body.filename = form.filename;
      }

      // Only send value if creating or if value was provided (not empty)
      if (!editing || form.value) {
        body.value = form.value;
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      toast.success(editing ? 'Секрет обновлён' : 'Секрет создан');
      setForm(emptyForm);
      setEditing(null);
      setShowForm(false);
      fetchSecrets();
    } catch (err) {
      toast.error(`Не удалось сохранить: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const confirmDelete = async () => {
    if (!confirmDeleteId) return;
    setConfirmBusy(true);
    try {
      const res = await fetch(`/api/secrets/${confirmDeleteId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setConfirmDeleteId(null);
      fetchSecrets();
    } catch (err) {
      toast.error(`Не удалось удалить: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setConfirmBusy(false);
    }
  };

  const handleEdit = (secret: Secret) => {
    const validAgentIds = new Set(agents.map((a) => a.id));
    setForm({
      name: secret.name,
      description: secret.description || '',
      kind: secret.kind,
      filename: secret.filename || '',
      value: '',
      global: secret.global,
      agent_ids: (secret.agent_ids || []).filter((id) => validAgentIds.has(id)),
    });
    setEditing(secret.id);
    setShowForm(true);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setForm((f) => ({ ...f, filename: file.name }));
    const reader = new FileReader();
    reader.onload = () => {
      setForm((f) => ({ ...f, value: reader.result as string }));
    };
    reader.readAsText(file);
  };

  const toggleAgent = (agentId: string) => {
    setForm((f) => ({
      ...f,
      agent_ids: f.agent_ids.includes(agentId)
        ? f.agent_ids.filter((id) => id !== agentId)
        : [...f.agent_ids, agentId],
    }));
  };

  const agentNameMap = agents.reduce<Record<string, string>>((acc, a) => {
    acc[a.id] = a.name;
    return acc;
  }, {});

  const list = secrets ?? [];

  return (
    <div>
      <PageHeader
        title="Сейф"
        subtitle="Секреты: зашифрованы AES-256-GCM, передаются агентам как переменные окружения или файлы"
        actions={
          <Button onClick={() => { setForm(emptyForm); setEditing(null); setShowForm(!showForm); }}>
            {showForm ? 'Отмена' : '+ Новый секрет'}
          </Button>
        }
      />

      {loadError && (
        <Card style={{ color: 'var(--red)', marginBottom: 16 }}>
          Не удалось загрузить секреты: {loadError}
        </Card>
      )}

      {showForm && (
        <Card style={{ marginBottom: 20 }}>
          <form onSubmit={handleSubmit}>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
              {editing ? 'Изменить секрет' : 'Новый секрет'}
            </h3>
            <div className="form-grid-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <Field label="Название">
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="github-token"
                  required
                  disabled={!!editing}
                />
              </Field>
              <Field label="Тип">
                <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                  <option value="string">строка</option>
                  <option value="file">файл</option>
                </Select>
              </Field>
              <div style={{ gridColumn: '1 / -1' }}>
                <Field label="Описание">
                  <Input
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Необязательное описание"
                  />
                </Field>
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <Field label={editing ? 'Значение (пусто — оставить прежнее)' : 'Значение'}>
                {form.kind === 'file' ? (
                  <input
                    type="file"
                    onChange={handleFileChange}
                    style={{ fontSize: 14, color: 'var(--text-primary)' }}
                  />
                ) : (
                  <Textarea
                    value={form.value}
                    onChange={(e) => setForm({ ...form, value: e.target.value })}
                    placeholder="Значение секрета"
                    required={!editing}
                  />
                )}
              </Field>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.global}
                  onChange={(e) => setForm({ ...form, global: e.target.checked })}
                />
                Общий (доступен всем агентам)
              </label>
            </div>

            {agents.length > 0 && !form.global && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500, marginBottom: 8 }}>
                  Назначить агентам
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {agents.map((a) => {
                    const active = form.agent_ids.includes(a.id);
                    return (
                      <Button
                        key={a.id}
                        type="button"
                        variant="secondary"
                        size="sm"
                        aria-pressed={active}
                        style={active ? { background: 'var(--accent-muted)', color: 'var(--accent)', borderColor: 'var(--accent)' } : undefined}
                        onClick={() => toggleAgent(a.id)}
                      >
                        {a.name}
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}

            <Button type="submit">{editing ? 'Сохранить' : 'Создать'}</Button>
          </form>
        </Card>
      )}

      {secrets === null && !loadError && <Skeleton lines={4} />}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {list.map((secret) => (
          <Card key={secret.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{ fontSize: 16, fontWeight: 600 }}>{secret.name}</span>
                  <Badge tone={secret.kind === 'string' ? 'accent' : 'warn'}>
                    {secret.kind === 'string' ? 'строка' : 'файл'}
                  </Badge>
                  {secret.global && <Badge tone="ok">общий</Badge>}
                </div>

                {secret.description && (
                  <div style={{ fontSize: 13.5, color: 'var(--text-tertiary)', marginBottom: 8 }}>
                    {secret.description}
                  </div>
                )}

                <div style={{ fontSize: 13.5, color: 'var(--text-muted)', marginBottom: 4, fontFamily: 'monospace' }}>
                  {'*'.repeat(12)}
                </div>

                {secret.agent_ids && secret.agent_ids.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                    {secret.agent_ids.map((id) => (
                      <Badge key={id} tone="neutral">{agentNameMap[id] || id}</Badge>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginLeft: 16 }}>
                <Button variant="secondary" size="sm" onClick={() => handleEdit(secret)}>Изменить</Button>
                <Button variant="danger" size="sm" onClick={() => setConfirmDeleteId(secret.id)}>Удалить</Button>
              </div>
            </div>
          </Card>
        ))}
        {secrets !== null && list.length === 0 && !loadError && (
          <EmptyState
            title="Сейф пуст"
            hint="Секреты хранятся в зашифрованном виде и никогда не показываются агентам напрямую: они подставляются в контейнер как переменные окружения (secret:имя) или файлы."
            action={
              <Button onClick={() => { setForm(emptyForm); setEditing(null); setShowForm(true); }}>
                + Новый секрет
              </Button>
            }
          />
        )}
      </div>

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Удалить секрет?"
        message="Агенты, которым он назначен, потеряют к нему доступ при следующем запуске."
        confirmLabel="Удалить"
        danger
        busy={confirmBusy}
        onConfirm={confirmDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}

export default Secrets;
