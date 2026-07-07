import { useState, useEffect, useCallback } from 'react';
import { snapshotStatus, type IntelSource } from './intelStatus';
import { Badge, Card, EmptyState, Skeleton } from '../components/ui';

const STATUS_TONE: Record<string, 'ok' | 'danger' | 'neutral'> = {
  ok: 'ok',
  error: 'danger',
  empty: 'neutral',
};

function IntelCard({ src }: { src: IntelSource }) {
  const st = snapshotStatus(src.latest);
  return (
    <Card style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <span style={{ fontWeight: 600 }}>{src.key}</span>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 8 }}>{src.project}</span>
          <Badge tone={STATUS_TONE[st] ?? 'neutral'} style={{ marginLeft: 8 }}>{st}</Badge>
          {src.latest?.ok && src.latest.change_note && (
            <div style={{ marginTop: 8, fontSize: 13.5 }}>
              {src.latest.change_note}
            </div>
          )}
          {src.latest?.ok && src.latest.payload && (
            <pre style={{
              marginTop: 8, padding: '8px 12px', borderRadius: 6,
              background: 'var(--bg-sidebar)', fontSize: 12,
              overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            }}>{src.latest.payload}</pre>
          )}
          {src.latest && !src.latest.ok && (
            <div style={{ marginTop: 8, fontSize: 13, color: 'var(--red)' }}>
              Сбой сбора: {src.latest.error}
            </div>
          )}
        </div>
      </div>
      {src.history.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)', userSelect: 'none' }}>
            История ({src.history.length})
          </summary>
          <ul style={{ margin: '8px 0 0', padding: '0 0 0 16px', fontSize: 13, color: 'var(--text-secondary)' }}>
            {src.history.map((h, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                {new Date(h.captured_at * 1000).toISOString().slice(0, 16).replace('T', ' ')}{' '}—{' '}
                {h.ok ? (h.change_note || '—') : `сбой: ${h.error}`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

export function IntelContent() {
  const [sources, setSources] = useState<IntelSource[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    fetch('/api/intel')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((d: { sources: IntelSource[] }) => { setSources(d.sources || []); setLoadError(null); })
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, []);
  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div>
      {loadError && (
        <Card style={{ color: 'var(--red)', marginBottom: 12 }}>
          Не удалось загрузить сводки: {loadError}
        </Card>
      )}
      {sources === null && !loadError && <Skeleton lines={3} />}
      {sources !== null && sources.length === 0 && (
        <EmptyState
          title="Нет источников или снимков"
          hint="Разведсводки собираются по расписанию из настроенных источников; изменения появятся здесь."
        />
      )}
      {(sources ?? []).map((s) => <IntelCard key={s.key} src={s} />)}
    </div>
  );
}
