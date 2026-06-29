export interface IntelSnapshot {
  captured_at: number;
  payload?: string;
  change_note?: string;
  ok: boolean;
  error?: string;
}

export interface IntelSource {
  key: string;
  project: string;
  latest: IntelSnapshot | null;
  history: IntelSnapshot[];
}

export type SnapshotStatus = 'ok' | 'error' | 'empty';

export function snapshotStatus(snap: IntelSnapshot | null | undefined): SnapshotStatus {
  if (!snap) return 'empty';
  return snap.ok ? 'ok' : 'error';
}
