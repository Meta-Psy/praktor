export interface CI { status?: string; conclusion?: string; url?: string; error?: string }
export interface Deploy { ok?: boolean; code?: number; latency_ms?: number; error?: string }
export interface PR { number: number; title: string; url: string; draft: boolean }
export interface Issue { number: number; title: string; url: string }
export interface Agent { id: string; running: boolean }
export interface ProjectStatus {
  name: string; repo: string;
  prs?: PR[]; pr_error?: string;
  audit_issues?: Issue[]; audit_error?: string;
  ci: CI; deploy: Deploy; agents?: Agent[];
}

export function ciLabel(ci: CI): string {
  if (ci.error) return 'error';
  if (ci.status === 'in_progress' || ci.status === 'queued') return '… running';
  if (ci.conclusion === 'success') return '✓ passing';
  if (ci.conclusion === 'failure') return '✗ failing';
  if (ci.status === 'none') return 'no runs';
  return ci.conclusion || ci.status || '—';
}

export function deployLabel(d: Deploy): string {
  if (d.error) return '● down';
  return `● ${d.code ?? '—'}`;
}
