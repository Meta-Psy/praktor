import { useState, useEffect, useCallback } from 'react';
import { snapshotStatus, type IntelSource } from './intelStatus';

const card: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: 10, padding: 16, boxShadow: 'var(--shadow)', marginBottom: 12,
};

const statusColor: Record<string, string> = {
  ok: 'var(--accent, #0F8B5C)',
  error: 'var(--danger, #e05c5c)',
  empty: 'var(--text-secondary)',
};

function IntelCard({ src }: { src: IntelSource }) {
  const st = snapshotStatus(src.latest);
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <span style={{ fontWeight: 600 }}>{src.key}</span>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 8 }}>{src.project}</span>
          <span style={{
            display: 'inline-block', padding: '2px 8px', borderRadius: 6,
            border: `1px solid ${statusColor[st]}`, color: statusColor[st],
            fontSize: 12, marginLeft: 8,
          }}>{st}</span>
          {src.latest?.ok && src.latest.change_note && (
            <div style={{ marginTop: 8, fontSize: 14, color: 'var(--text-primary)' }}>
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
            <div style={{ marginTop: 8, fontSize: 13, color: statusColor.error }}>
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
    </div>
  );
}

function Intel() {
  const [sources, setSources] = useState<IntelSource[]>([]);

  const fetchData = useCallback(() => {
    fetch('/api/intel')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('load failed'))))
      .then((d: { sources: IntelSource[] }) => setSources(d.sources || []))
      .catch(() => setSources([]));
  }, []);
  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 16 }}>Intel</h1>
      {sources.length === 0 && <div style={card}>Нет источников или снимков.</div>}
      {sources.map((s) => <IntelCard key={s.key} src={s} />)}
    </div>
  );
}

export default Intel;
