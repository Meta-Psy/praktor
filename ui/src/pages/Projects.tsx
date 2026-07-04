import { useState, useEffect, useCallback } from 'react';
import { ciLabel, deployLabel, deployRunLabel, type ProjectStatus } from './projectStatus';
import { approve, mergePR, deploy } from './actions';
import { Button, Card, ConfirmDialog, EmptyState, PageHeader, Skeleton } from '../components/ui';

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

  return (
    <div>
      <PageHeader title="Операции" subtitle="Проекты: PR, CI, audit-issues и деплой" />

      {error && (
        <Card style={{ color: 'var(--red)', marginBottom: 16 }}>Не удалось загрузить: {error}</Card>
      )}

      {projects === null && !error && <Skeleton lines={4} />}

      {projects !== null && projects.length === 0 && !error && (
        <EmptyState
          title="Проекты не настроены"
          hint="Раздел показывает статус репозиториев: открытые PR, CI, audit-issues и деплой. Проекты настраиваются в конфигурации гейтвея."
        />
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {(projects ?? []).map((p) => (
          <Card key={p.name} style={{ minWidth: 280 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong style={{ fontSize: 16 }}>{p.name}</strong>
              <span title={p.deploy.error || ''} style={{ color: p.deploy.ok ? 'var(--accent)' : 'var(--red)' }}>
                {deployLabel(p.deploy)}
              </span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{p.repo}</div>
            <div style={{ marginTop: 10, display: 'grid', gap: 4, fontSize: 13.5 }}>
              <div>PR: {p.pr_error ? <span title={p.pr_error}>ошибка</span> : (p.prs?.length ?? 0)} откр.</div>
              <div>CI: {ciLabel(p.ci)}</div>
              <div>audit: {p.audit_error ? <span title={p.audit_error}>ошибка</span> : (p.audit_issues?.length ?? 0)}</div>
              <div>агенты: {(p.agents ?? []).map((a) => (
                <span key={a.id} style={{ marginRight: 8 }}>{a.id} {a.running ? '●' : '○'}</span>
              ))}</div>
              {deployRunLabel(p.deploy_run) && (
                <div style={{ color: p.deploy_run?.state === 'failed' ? 'var(--red)' : 'var(--text-secondary)' }}>
                  {deployRunLabel(p.deploy_run)}
                </div>
              )}
            </div>
            {(p.prs ?? []).length > 0 && (
              <ul style={{ marginTop: 8, paddingLeft: 16, fontSize: 13 }}>
                {p.prs!.map((pr) => (
                  <li key={pr.number} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <a href={pr.url} target="_blank" rel="noopener noreferrer">#{pr.number} {pr.title}{pr.draft ? ' (draft)' : ''}</a>
                    <Button variant="secondary" size="sm" onClick={() => setPending({
                      label: `merge ${p.repo}#${pr.number}`,
                      run: () => mergePR(p.name, pr.number),
                    })}>merge</Button>
                  </li>
                ))}
              </ul>
            )}
            {(p.audit_issues ?? []).length > 0 && (
              <div style={{ marginTop: 8, display: 'grid', gap: 4, fontSize: 13 }}>
                {p.audit_issues!.map((iss) => (
                  <div key={iss.number} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>audit #{iss.number}</span>
                    <Button variant="secondary" size="sm" onClick={() => setPending({
                      label: `approve trivial on ${p.repo}#${iss.number}`,
                      run: () => approve(p.name, 'trivial', iss.number),
                    })}>approve trivial</Button>
                    <Button variant="secondary" size="sm" onClick={() => setPending({
                      label: `approve ALL on ${p.repo}#${iss.number}`,
                      run: () => approve(p.name, 'all', iss.number),
                    })}>approve all</Button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop: 10 }}>
              <Button size="sm" disabled={p.deploy_run?.state === 'running'} onClick={() => setPending({
                label: `deploy ${p.name}`,
                run: () => deploy(p.name),
              })}>deploy</Button>
            </div>
          </Card>
        ))}
      </div>

      <ConfirmDialog
        open={pending !== null}
        title="Подтвердить действие"
        message={
          <>
            <div style={{ fontWeight: 600 }}>{pending?.label}</div>
            {actionErr && <div style={{ color: 'var(--red)', marginTop: 8 }}>{actionErr}</div>}
          </>
        }
        confirmLabel="Подтвердить"
        busy={busy}
        onConfirm={confirmRun}
        onCancel={() => { setPending(null); setActionErr(null); }}
      />
    </div>
  );
}

export default Projects;
