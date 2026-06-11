import { describe, it, expect } from 'vitest';
import { percent, groupByLane, type PortfolioProject } from '../pages/portfolioStatus';

const proj: PortfolioProject = {
  key: 'k', name: 'N', status: 'active',
  directions: [
    { title: 'a', state: 'done' },
    { title: 'b', state: 'done' },
    { title: 'c', state: 'doing' },
    { title: 'd', state: 'planned' },
  ],
};

describe('percent', () => {
  it('is done / total rounded', () => {
    expect(percent(proj.directions)).toBe(50); // 2 of 4
  });
  it('is 0 for no directions', () => {
    expect(percent([])).toBe(0);
  });
});

describe('groupByLane', () => {
  it('buckets directions into planned/doing/done', () => {
    const g = groupByLane(proj.directions);
    expect(g.planned.map((d) => d.title)).toEqual(['d']);
    expect(g.doing.map((d) => d.title)).toEqual(['c']);
    expect(g.done.map((d) => d.title)).toEqual(['a', 'b']);
  });
});
