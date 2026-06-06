import { describe, it, expect } from 'vitest';
import { ciLabel, deployLabel } from '../pages/projectStatus';

describe('ciLabel', () => {
  it('maps success', () => expect(ciLabel({ status: 'completed', conclusion: 'success' })).toBe('✓ passing'));
  it('maps failure', () => expect(ciLabel({ status: 'completed', conclusion: 'failure' })).toBe('✗ failing'));
  it('maps running', () => expect(ciLabel({ status: 'in_progress', conclusion: '' })).toBe('… running'));
  it('maps error', () => expect(ciLabel({ error: 'boom' } as never)).toBe('error'));
  it('maps none', () => expect(ciLabel({ status: 'none', conclusion: '' })).toBe('no runs'));
});

describe('deployLabel', () => {
  it('ok', () => expect(deployLabel({ ok: true, code: 200 })).toBe('● 200'));
  it('down', () => expect(deployLabel({ ok: false, code: 500 })).toBe('● 500'));
  it('error', () => expect(deployLabel({ ok: false, error: 'x' } as never)).toBe('● down'));
});
