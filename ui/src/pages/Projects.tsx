import { useState, useEffect, useCallback } from 'react';
import { ciLabel, deployLabel, deployRunLabel, type ProjectStatus } from './projectStatus';
import { approve, mergePR, deploy } from './actions';

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

  // While any deploy is running, poll faster so the card status feels live.
  const anyRunning = (projects ?? []).some((p) => p.deploy_run?.state === 'running');
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(fetchProjects, 4000);
    return () => clearInterval(id);
  }, [anyRunning, fetchProjects]);

  const [pending, setPending] = useState<null | { label: string; run: () => Promise<void> }>(null);
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

  async function confirmRun() {
    if (!pending) return;
    setBusy(true);
    setActionErr(null);
    try {
      await pending.run();
      setPending(null);
      fetchProjects();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

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
              {deployRunLabel(p.deploy_run) && (
                <div style={{ color: p.deploy_run?.state === 'failed' ? '#c0392b' : 'var(--text-secondary)' }}>
                  {deployRunLabel(p.deploy_run)}
                </div>
              )}
            </div>
            {(p.prs ?? []).length > 0 && (
              <ul style={{ marginTop: 8, paddingLeft: 16, fontSize: 13 }}>
                {p.prs!.map((pr) => (
                  <li key={pr.number} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <a href={pr.url} target="_blank" rel="noopener noreferrer">#{pr.number} {pr.title}{pr.draft ? ' (draft)' : ''}</a>
                    <button className="action-row" onClick={() => setPending({
                      label: `merge ${p.repo}#${pr.number}`,
                      run: () => mergePR(p.name, pr.number),
                    })}>merge</button>
                  </li>
                ))}
              </ul>
            )}
            {(p.audit_issues ?? []).length > 0 && (
              <div style={{ marginTop: 8, display: 'grid', gap: 4, fontSize: 13 }}>
                {p.audit_issues!.map((iss) => (
                  <div key={iss.number} className="action-row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>audit #{iss.number}</span>
                    <button onClick={() => setPending({
                      label: `approve trivial on ${p.repo}#${iss.number}`,
                      run: () => approve(p.name, 'trivial', iss.number),
                    })}>approve trivial</button>
                    <button onClick={() => setPending({
                      label: `approve ALL on ${p.repo}#${iss.number}`,
                      run: () => approve(p.name, 'all', iss.number),
                    })}>approve all</button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop: 8 }}>
              <button className="action-row" disabled={p.deploy_run?.state === 'running'} onClick={() => setPending({
                label: `deploy ${p.name}`,
                run: () => deploy(p.name),
              })}>deploy</button>
            </div>
          </div>
        ))}
      </div>
      {pending && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <p>Подтвердить действие:</p>
            <strong>{pending.label}</strong>
            {actionErr && <p className="error">{actionErr}</p>}
            <div className="modal-actions">
              <button onClick={() => { setPending(null); setActionErr(null); }} disabled={busy}>Отмена</button>
              <button onClick={confirmRun} disabled={busy}>{busy ? '…' : 'Подтвердить'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Projects;
