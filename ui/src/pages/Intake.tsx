import { useState, useEffect, useCallback, useRef } from 'react';
import { routeLabel, statusLabel, type IntakeItem, type IntakeList } from './intakeStatus';
import { Badge, Button, Card, EmptyState, Input, Skeleton, Textarea, useToast } from '../components/ui';

// Тон бейджа статуса по смыслу (набор статусов открытый — подстрочные проверки)
function statusTone(status: string): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (/done|approved|completed/.test(status)) return 'ok';
  if (/reject|fail|error/.test(status)) return 'danger';
  if (/await|progress|plan/.test(status)) return 'warn';
  return 'neutral';
}

export function IntakeContent() {
  const [doc, setDoc] = useState<IntakeList | null>(null);
  const [text, setText] = useState('');
  const [project, setProject] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const audio = useRef<Blob | null>(null);

  const fetchList = useCallback(() => {
    fetch('/api/intake')
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then(setDoc)
      .catch(() => setDoc({ items: [] }));
  }, []);

  useEffect(() => {
    fetchList();
    const id = setInterval(fetchList, 60000);
    return () => clearInterval(id);
  }, [fetchList]);

  useEffect(() => {
    return () => {
      if (recorder.current && recorder.current.state !== 'inactive') {
        recorder.current.stop(); // onstop освобождает дорожки микрофона
      }
    };
  }, []);

  const startRec = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream);
    chunks.current = [];
    mr.ondataavailable = (e) => chunks.current.push(e.data);
    mr.onstop = () => {
      audio.current = new Blob(chunks.current, { type: 'audio/ogg' });
      stream.getTracks().forEach((t) => t.stop());
    };
    recorder.current = mr;
    mr.start();
    setRecording(true);
  }, []);

  const stopRec = useCallback(() => {
    recorder.current?.stop();
    setRecording(false);
  }, []);

  const submit = useCallback(async () => {
    setBusy(true);
    const fd = new FormData();
    if (text.trim()) fd.append('text', text.trim());
    if (project.trim()) fd.append('project', project.trim());
    if (photo) fd.append('photo', photo);
    if (audio.current) fd.append('audio', audio.current, 'voice.ogg');
    try {
      const res = await fetch('/api/intake', { method: 'POST', body: fd });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setText(''); setProject(''); setPhoto(null); audio.current = null;
      toast.success('Принято в очередь');
      fetchList();
    } catch (e) {
      toast.error(`Не удалось отправить: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [text, project, photo, fetchList, toast]);

  const items = doc?.items ?? [];

  return (
    <div>
      <Card style={{ marginBottom: 12 }}>
        <Textarea
          style={{ marginBottom: 8 }}
          placeholder="Задача Claude'у…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Input
          style={{ marginBottom: 8 }}
          placeholder="проект (опц.) — пусто = триаж определит"
          value={project}
          onChange={(e) => setProject(e.target.value)}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          {!recording
            ? <Button variant="secondary" size="sm" onClick={startRec}>🎙 Запись</Button>
            : <Button variant="danger" size="sm" onClick={stopRec}>⏹ Стоп</Button>}
          {audio.current && <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>голос готов</span>}
          <Button style={{ marginLeft: 'auto' }} busy={busy} onClick={submit}>Отправить</Button>
        </div>
      </Card>

      {doc?.stale && (
        <div style={{ color: 'var(--amber)', marginBottom: 12 }}>
          ⚠ данные могли устареть{doc.fetch_error ? `: ${doc.fetch_error}` : ''}
        </div>
      )}

      {doc === null && <Skeleton lines={3} />}

      {items.map((it: IntakeItem) => (
        <Card key={it.id} style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{it.source === 'telegram' ? '✈' : '🌐'}</span>
            <strong style={{ flex: 1, fontSize: 13.5, minWidth: 200 }}>{it.raw_text.slice(0, 120) || '(медиа)'}</strong>
            {it.target_project && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{it.target_project}</span>}
            <Badge tone="accent">{routeLabel(it.route)}</Badge>
            <Badge tone={statusTone(it.status)}>{statusLabel(it.status)}</Badge>
          </div>
        </Card>
      ))}

      {doc !== null && items.length === 0 && (
        <EmptyState
          title="Входящих нет"
          hint="Всё разобрано. Новые задачи попадают сюда из Telegram и формы выше: триаж определит маршрут и проект."
        />
      )}
    </div>
  );
}
