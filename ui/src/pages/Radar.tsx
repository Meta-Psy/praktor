import { useState, useEffect, useCallback } from 'react';
import { formatStars, type RadarResponse, type RadarItem } from './radarStatus';
import { Badge, Card, EmptyState, Skeleton } from '../components/ui';

function RadarRow({ it }: { it: RadarItem }) {
  return (
    <Card style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <a href={it.html_url} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>
            {it.full_name}
          </a>
          {it.is_new && <Badge tone="accent" style={{ marginLeft: 8 }}>новое</Badge>}
          <Badge tone="neutral" style={{ marginLeft: 8 }}>{it.topic}</Badge>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
            {it.description || '—'}
          </div>
        </div>
        <div style={{ whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontSize: 13 }}>
          ★ {formatStars(it.stars)}
        </div>
      </div>
    </Card>
  );
}

export function RadarContent() {
  const [items, setItems] = useState<RadarItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    fetch('/api/radar')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((d: RadarResponse) => { setItems(d.items || []); setLoadError(null); })
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, []);
  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div>
      {loadError && (
        <Card style={{ color: 'var(--red)', marginBottom: 12 }}>
          Не удалось загрузить радар: {loadError}
        </Card>
      )}
      {items === null && !loadError && <Skeleton lines={3} />}
      {items !== null && items.length === 0 && (
        <EmptyState
          title="Радар пуст или выключен"
          hint="Радар отслеживает свежие GitHub-репозитории по темам разведки. Источники настраиваются в конфигурации."
        />
      )}
      {(items ?? []).map((it) => <RadarRow key={it.full_name} it={it} />)}
    </div>
  );
}
