import { describe, it, expect } from 'vitest';
import { snapshotStatus, type IntelSnapshot } from '../intelStatus';

describe('snapshotStatus', () => {
  it('maps ok snapshot to ok', () => {
    const snap: IntelSnapshot = { captured_at: 1, ok: true, change_note: '+2' };
    expect(snapshotStatus(snap)).toBe('ok');
  });
  it('maps failed snapshot to error', () => {
    const snap: IntelSnapshot = { captured_at: 1, ok: false, error: 'down' };
    expect(snapshotStatus(snap)).toBe('error');
  });
  it('maps null/absent to empty', () => {
    expect(snapshotStatus(null)).toBe('empty');
  });
});
