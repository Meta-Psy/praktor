import { describe, it, expect } from 'vitest';
import { routeLabel, statusLabel, type IntakeItem } from '../intakeStatus';

describe('intakeStatus', () => {
  it('labels routes', () => {
    expect(routeLabel('trivial')).toBe('auto');
    expect(routeLabel('standard')).toBe('plan→approve');
    expect(routeLabel('complex')).toBe('design (S3)');
    expect(routeLabel('')).toBe('—');
  });
  it('labels statuses human-readably', () => {
    expect(statusLabel('queued')).toBe('queued');
    expect(statusLabel('in_progress')).toBe('in progress');
    expect(statusLabel('awaiting-approval')).toBe('awaiting approval');
    expect(statusLabel('needs-clarification')).toBe('needs clarification');
  });
  it('type shape', () => {
    const it: IntakeItem = { id: 'a', source: 'web', raw_text: 'x', status: 'queued', created_at: '', updated_at: '' };
    expect(it.id).toBe('a');
  });
});
