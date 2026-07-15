import { describe, it, expect } from 'vitest';
import {
  percent, groupByLane, metricPercent, subprojectPercent, projectPercent,
  staleDays, isStale, STALE_THRESHOLD_DAYS,
  type PortfolioProject, type Metric, type Subproject,
} from '../pages/portfolioStatus';

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

const M = (over: Partial<Metric>): Metric => ({ key: 'm', label: 'M', done: 0, total: 100, ...over });

describe('metricPercent', () => {
  it('is done/total rounded', () => {
    expect(metricPercent(M({ done: 33, total: 2102 }))).toBe(2);
  });
  it('is 0 when total is 0 (avoids NaN)', () => {
    expect(metricPercent(M({ done: 0, total: 0 }))).toBe(0);
  });
  it('is honest above 100 on over-delivery', () => {
    expect(metricPercent(M({ done: 12, total: 10 }))).toBe(120);
  });
});

describe('subprojectPercent + projectPercent (mixed units, weighted)', () => {
  it('averages metric percentages, not their totals', () => {
    const sp: Subproject = { key: 's', label: 'S', metrics: [
      M({ key: 'a', done: 50, total: 100 }),   // 50%
      M({ key: 'b', done: 3000, total: 3000 }), // 100%, huge total must not dominate
    ] };
    expect(subprojectPercent(sp)).toBe(75); // (50+100)/2, not weighted by totals
  });
  it('honours metric weights', () => {
    const sp: Subproject = { key: 's', label: 'S', metrics: [
      M({ key: 'a', done: 0, total: 100, weight: 3 }), // 0% ×3
      M({ key: 'b', done: 100, total: 100, weight: 1 }), // 100% ×1
    ] };
    expect(subprojectPercent(sp)).toBe(25); // (0*3 + 100*1)/4
  });
  it('projectPercent rolls up subprojects when present', () => {
    const p: PortfolioProject = { key: 'k', name: 'N', status: 'active', directions: [], subprojects: [
      { key: 's1', label: 'S1', metrics: [M({ done: 20, total: 100 })] }, // 20%
      { key: 's2', label: 'S2', metrics: [M({ done: 80, total: 100 })] }, // 80%
    ] };
    expect(projectPercent(p)).toBe(50);
  });
  it('projectPercent falls back to directions when no subprojects (v1)', () => {
    expect(projectPercent(proj)).toBe(50);
  });
});

describe('staleness', () => {
  const now = new Date('2026-07-15T00:00:00Z');
  it('staleDays counts whole days from as_of', () => {
    expect(staleDays('2026-07-15', now)).toBe(0);
    expect(staleDays('2026-06-14', now)).toBe(31);
  });
  it('staleDays is null for missing/unparseable dates', () => {
    expect(staleDays(undefined, now)).toBeNull();
    expect(staleDays('not-a-date', now)).toBeNull();
  });
  it('isStale trips past the threshold', () => {
    expect(isStale('2026-07-15', now)).toBe(false);
    expect(isStale('2026-06-14', now)).toBe(true); // 31 > 21
    expect(isStale(undefined, now)).toBe(false);
    expect(STALE_THRESHOLD_DAYS).toBe(21);
  });
});
