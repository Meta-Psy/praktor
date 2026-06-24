import { describe, it, expect } from 'vitest';
import { formatStars, type RadarItem } from '../radarStatus';

const sample: RadarItem = {
  full_name: 'owner/repo', name: 'repo', description: '', html_url: 'https://x',
  stars: 1500, topic: 'agents', first_seen: '2026-06-24', is_new: true,
};

describe('formatStars', () => {
  it('passes small numbers through', () => {
    expect(formatStars(42)).toBe('42');
  });
  it('abbreviates thousands', () => {
    expect(formatStars(sample.stars)).toBe('1.5k');
  });
});
