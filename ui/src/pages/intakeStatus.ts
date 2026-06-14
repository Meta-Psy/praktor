export type Source = 'web' | 'telegram';
export type Route = 'trivial' | 'standard' | 'complex' | '';

export interface IntakeItem {
  id: string;
  source: Source;
  raw_text: string;
  media?: string[];
  target_project?: string;
  route?: Route;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface IntakeList {
  items: IntakeItem[];
  stale?: boolean;
  fetch_error?: string;
}

export function routeLabel(route?: string): string {
  switch (route) {
    case 'trivial': return 'auto';
    case 'standard': return 'plan→approve';
    case 'complex': return 'design (S3)';
    default: return '—';
  }
}

// statusLabel normalizes both '-' and '_' delimiters so e.g. the Go status
// "in_progress" renders as "in progress".
export function statusLabel(status: string): string {
  return status.replace(/[-_]/g, ' ');
}
