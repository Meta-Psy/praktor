import { describe, it, expect } from 'vitest';
import { awaitingPlans } from '../planStatus';
import type { IntakeItem } from '../intakeStatus';

const mk = (id: string, status: string): IntakeItem => ({
  id, source: 'web', raw_text: id, status, created_at: '', updated_at: '',
});

describe('planStatus', () => {
  it('keeps only awaiting-approval items', () => {
    const items = [mk('a', 'queued'), mk('b', 'awaiting-approval'), mk('c', 'approved')];
    const out = awaitingPlans(items);
    expect(out.map((i) => i.id)).toEqual(['b']);
  });
  it('tolerates empty', () => {
    expect(awaitingPlans([])).toEqual([]);
  });
});
