import { useState, useEffect, useCallback, useRef } from 'react';
import { routeLabel, statusLabel, type IntakeItem, type IntakeList } from './intakeStatus';

const card: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: 10, padding: 16, boxShadow: 'var(--shadow)', marginBottom: 12,
};
const input: React.CSSProperties = {
  width: '100%', padding: 10, borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 15, marginBottom: 8,
};

export function IntakeContent() {
  const [doc, setDoc] = useState<IntakeList | null>(null);
  const [text, setText] = useState('');
  const [project, setProject] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
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
    setMsg(null);
    const fd = new FormData();
    if (text.trim()) fd.append('text', text.trim());
    if (project.trim()) fd.append('project', project.trim());
    if (photo) fd.append('photo', photo);
    if (audio.current) fd.append('audio', audio.current, 'voice.ogg');
    try {
      const res = await fetch('/api/intake', { method: 'POST', body: fd });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setText(''); setProject(''); setPhoto(null); audio.current = null;
      setMsg('✅ queued');
      fetchList();
    } catch (e) {
      setMsg(`⚠ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [text, project, photo, fetchList]);

  return (
    <div>
      <div style={card}>
        <textarea style={{ ...input, minHeight: 70 }} placeholder="Задача Claude'у…" value={text} onChange={(e) => setText(e.target.value)} />
        <input style={input} placeholder="проект (опц.) — пусто = триаж определит" value={project} onChange={(e) => setProject(e.target.value)} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          {!recording
            ? <button onClick={startRec} style={{ padding: '6px 12px' }}>🎙 запись</button>
            : <button onClick={stopRec} style={{ padding: '6px 12px', color: '#c00' }}>⏹ стоп</button>}
          {audio.current && <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>голос готов</span>}
          <button onClick={submit} disabled={busy} style={{ padding: '6px 16px', marginLeft: 'auto', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8 }}>
            {busy ? '…' : 'Отправить'}
          </button>
        </div>
        {msg && <div style={{ marginTop: 8, fontSize: 13 }}>{msg}</div>}
      </div>

      {doc?.stale && <div style={{ color: '#b8860b', marginBottom: 12 }}>⚠ stale{doc.fetch_error ? `: ${doc.fetch_error}` : ''}</div>}
      {(doc?.items ?? []).map((it: IntakeItem) => (
        <div key={it.id} style={card}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{it.source === 'telegram' ? '✈' : '🌐'}</span>
            <strong style={{ flex: 1, fontSize: 15 }}>{it.raw_text.slice(0, 120) || '(media)'}</strong>
            {it.target_project && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{it.target_project}</span>}
            <span style={{ fontSize: 12, color: 'var(--accent)' }}>{routeLabel(it.route)}</span>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 110, textAlign: 'right' }}>{statusLabel(it.status)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
