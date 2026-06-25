import { useState, useEffect, useCallback } from 'react';
import { formatStars, type RadarResponse, type RadarItem } from './radarStatus';

const card: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: 10, padding: 16, boxShadow: 'var(--shadow)', marginBottom: 12,
};
const chip: React.CSSProperties = {
  display: 'inline-block', padding: '2px 8px', borderRadius: 6,
  border: '1px solid var(--border)', fontSize: 12, marginLeft: 8,
};

function RadarRow({ it }: { it: RadarItem }) {
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <a href={it.html_url} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>
            {it.full_name}
          </a>
          {it.is_new && <span style={{ ...chip, borderColor: 'var(--accent, #0F8B5C)', color: 'var(--accent, #0F8B5C)' }}>new</span>}
          <span style={chip}>{it.topic}</span>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
            {it.description || '—'}
          </div>
        </div>
        <div style={{ whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontSize: 13 }}>
          ★ {formatStars(it.stars)}
        </div>
      </div>
    </div>
  );
}

function Radar() {
  const [items, setItems] = useState<RadarItem[]>([]);

  const fetchData = useCallback(() => {
    fetch('/api/radar')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('load failed'))))
      .then((d: RadarResponse) => setItems(d.items || []))
      .catch(() => setItems([]));
  }, []);
  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 16 }}>Радар экосистемы</h1>
      {items.length === 0 && <div style={card}>Радар пуст или выключен.</div>}
      {items.map((it) => <RadarRow key={it.full_name} it={it} />)}
    </div>
  );
}

export default Radar;
