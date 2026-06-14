export type Lane = 'planned' | 'doing' | 'done';
export interface Direction { title: string; state: Lane }
export interface PortfolioProject {
  key: string; name: string; status: 'active' | 'paused' | 'done';
  next_action?: string; mc_key?: string; directions: Direction[];
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
