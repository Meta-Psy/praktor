// memory-summary computes the catalog snapshot ({count, last_updated}) from raw
// memory.db aggregates. Kept free of node:sqlite so it is unit-testable.
export interface MemorySummary {
  count: number;
  last_updated: string; // RFC3339, "" when there are no memories
}

// toMemorySummary builds the snapshot. maxEpoch is MAX(updated_at) in unix
// seconds (memory.db stores updated_at as unixepoch()); 0 means "no rows".
export function toMemorySummary(count: number, maxEpoch: number): MemorySummary {
  return {
    count,
    last_updated: maxEpoch > 0 ? new Date(maxEpoch * 1000).toISOString() : "",
  };
}
