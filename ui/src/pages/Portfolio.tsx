import { useState, useEffect, useCallback } from 'react';
import { percent, groupByLane, type Portfolio as PortfolioDoc, type PortfolioProject } from './portfolioStatus';
import { ciLabel, deployLabel, type ProjectStatus } from './projectStatus';
import { Card, EmptyState, PageHeader, Skeleton } from '../components/ui';

const STATUS_COLOR: Record<string, string> = {
  active: 'var(--accent)',
  paused: 'var(--amber)',
  done: 'var(--text-secondary)',
};

const LANE_LABEL: Record<'planned' | 'doing' | 'done', string> = {
  planned: 'план',
  doing: 'в работе',
  done: 'готово',
};

function Portfolio() {
  const [doc, setDoc] = useState<PortfolioDoc | null>(null);
  const [live, setLive] = useState<Record<string, ProjectStatus>>({});
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const fetchAll = useCallback(() => {
    fetch('/api/portfolio')
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then(setDoc)
      .catch((err) => setError(err.message));
    fetch('/api/projects')
      .then((res) => (res.ok ? res.json() : []))
      .then((arr: ProjectStatus[]) => {
        const map: Record<string, ProjectStatus> = {};
        for (const p of arr) map[p.name] = p;
        setLive(map);
      })
      .catch(() => { /* live chip is best-effort */ });
  }, []);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 60000);
    return () => clearInterval(id);
  }, [fetchAll]);

  return (
    <div>
      <PageHeader title="Задачи" subtitle="Роадмап проектов: направления и прогресс" />

      {error && <Card style={{ color: 'var(--red)', marginBottom: 16 }}>Не удалось загрузить: {error}</Card>}
      {doc === null && !error && <Skeleton lines={4} />}

      {doc?.stale && (
        <div style={{ color: 'var(--amber)', marginBottom: 12 }}>
          ⚠ данные могли устареть{doc.fetch_error ? `: ${doc.fetch_error}` : ''}
        </div>
      )}

      {doc !== null && doc.projects.length === 0 && (
        <EmptyState
          title="Роадмап пуст"
          hint="Здесь появятся проекты с направлениями и прогрессом, когда роадмап будет заполнен."
        />
      )}

      {(doc?.projects ?? []).map((p: PortfolioProject) => {
        const pct = percent(p.directions);
        const lv = p.mc_key ? live[p.mc_key] : undefined;
        const isOpen = open === p.key;
        const lanes = groupByLane(p.directions);
        return (
          <Card key={p.key} style={{ marginBottom: 12 }}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => setOpen(isOpen ? null : p.key)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(isOpen ? null : p.key); }
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 4, background: STATUS_COLOR[p.status] || 'var(--text-secondary)' }} />
              <strong style={{ fontSize: 15, flex: 1 }}>{p.name}</strong>
              {lv && <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>CI {ciLabel(lv.ci)} · {deployLabel(lv.deploy)}</span>}
              <span style={{ fontSize: 13, color: 'var(--text-secondary)', minWidth: 36, textAlign: 'right' }}>{pct}%</span>
            </div>
            <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, marginTop: 8 }}>
              <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', borderRadius: 2 }} />
            </div>
            {p.next_action && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6 }}>дальше: {p.next_action}</div>}
            {isOpen && (
              <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
                {(['planned', 'doing', 'done'] as const).map((k) => (
                  <div key={k} style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 4 }}>
                      {LANE_LABEL[k]}
                    </div>
                    {lanes[k].map((d, i) => (
                      <div key={i} style={{ fontSize: 13, padding: '4px 0', borderTop: '1px solid var(--border)' }}>{d.title}</div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

export default Portfolio;
