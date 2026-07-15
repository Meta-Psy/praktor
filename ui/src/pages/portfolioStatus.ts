export type Lane = 'planned' | 'doing' | 'done';
export interface Direction { title: string; state: Lane }
export interface Metric {
  key: string; label: string; unit?: string;
  done: number; total: number; as_of?: string; weight?: number; error?: boolean;
}
export interface Subproject { key: string; label: string; weight?: number; metrics: Metric[] }
export interface PortfolioProject {
  key: string; name: string; status: 'active' | 'paused' | 'done';
  next_action?: string; mc_key?: string; directions: Direction[]; subprojects?: Subproject[];
}
export interface Portfolio {
  generated_at?: string; projects: PortfolioProject[];
  stale?: boolean; fetch_error?: string;
}

export function percent(directions: Direction[]): number {
  if (directions.length === 0) return 0;
  const done = directions.filter((d) => d.state === 'done').length;
  return Math.round((done / directions.length) * 100);
}

export function groupByLane(directions: Direction[]): Record<Lane, Direction[]> {
  return {
    planned: directions.filter((d) => d.state === 'planned'),
    doing: directions.filter((d) => d.state === 'doing'),
    done: directions.filter((d) => d.state === 'done'),
  };
}

// metricPercent is a plain done/total. Not clamped: done > total is a real
// signal (over-delivery); the bar clamps its width, the number stays honest.
export function metricPercent(m: Metric): number {
  if (m.total <= 0) return 0;
  return Math.round((m.done / m.total) * 100);
}

// weightedMean averages child percentages. Units differ across metrics (док vs
// вопросов vs роликов), so summing totals would lie — we average percentages,
// each weighted by its optional `weight` (default 1).
function weightedMean(items: Array<{ pct: number; weight?: number }>): number {
  if (items.length === 0) return 0;
  let wsum = 0;
  let sum = 0;
  for (const it of items) {
    const w = it.weight ?? 1;
    wsum += w;
    sum += it.pct * w;
  }
  return wsum === 0 ? 0 : Math.round(sum / wsum);
}

export function subprojectPercent(sp: Subproject): number {
  return weightedMean(sp.metrics.map((m) => ({ pct: metricPercent(m), weight: m.weight })));
}

// projectPercent rolls up subprojects when present, else falls back to the
// binary direction ratio — so v1 projects are unaffected.
export function projectPercent(p: PortfolioProject): number {
  if (p.subprojects && p.subprojects.length > 0) {
    return weightedMean(p.subprojects.map((sp) => ({ pct: subprojectPercent(sp), weight: sp.weight })));
  }
  return percent(p.directions);
}

export const STALE_THRESHOLD_DAYS = 21;

// staleDays is whole days between as_of and now, or null when there is no
// parseable date to judge.
export function staleDays(asOf: string | undefined, now: Date = new Date()): number | null {
  if (!asOf) return null;
  const t = Date.parse(asOf);
  if (Number.isNaN(t)) return null;
  return Math.floor((now.getTime() - t) / 86_400_000);
}

export function isStale(asOf: string | undefined, now?: Date): boolean {
  const d = staleDays(asOf, now);
  return d !== null && d > STALE_THRESHOLD_DAYS;
}
