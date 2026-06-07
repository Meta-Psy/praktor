import { useState, useEffect, useCallback } from 'react';
import { ciLabel, deployLabel, type ProjectStatus } from './projectStatus';

const card: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: 10, padding: 20, boxShadow: 'var(--shadow)', minWidth: 280,
};

function Projects() {
  const [projects, setProjects] = useState<ProjectStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fetchProjects = useCallback(() => {
    fetch('/api/projects')
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then(setProjects)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    fetchProjects();
    const id = setInterval(fetchProjects, 30000);
    return () => clearInterval(id);
  }, [fetchProjects]);

  if (error) return <div style={{ color: 'var(--danger, #c00)' }}>Error: {error}</div>;
  if (!projects) return <div>Loading…</div>;

  return (
    <div>
      <h1 style={{ marginBottom: 20 }}>Projects</h1>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {projects.map((p) => (
          <div key={p.name} style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong style={{ fontSize: 18 }}>{p.name}</strong>
              <span title={p.deploy.error || ''} style={{ color: p.deploy.ok ? 'var(--accent)' : '#c0392b' }}>
                {deployLabel(p.deploy)}
              </span>
            </div>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{p.repo}</div>
            <div style={{ marginTop: 10, display: 'grid', gap: 4, fontSize: 14 }}>
              <div>PRs: {p.pr_error ? <span title={p.pr_error}>error</span> : (p.prs?.length ?? 0)} open</div>
              <div>CI: {ciLabel(p.ci)}</div>
              <div>audit: {p.audit_error ? <span title={p.audit_error}>error</span> : (p.audit_issues?.length ?? 0)}</div>
              <div>agents: {(p.agents ?? []).map((a) => (
                <span key={a.id} style={{ marginRight: 8 }}>{a.id} {a.running ? '●' : '○'}</span>
              ))}</div>
            </div>
            {(p.prs ?? []).length > 0 && (
              <ul style={{ marginTop: 8, paddingLeft: 16, fontSize: 13 }}>
                {p.prs!.map((pr) => (
                  <li key={pr.number}>
                    <a href={pr.url} target="_blank" rel="noopener noreferrer">#{pr.number} {pr.title}{pr.draft ? ' (draft)' : ''}</a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default Projects;
