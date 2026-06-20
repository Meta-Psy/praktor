package store

import "fmt"

// MemoryStat is a per-agent memory summary reported by the agent runtime (S4).
type MemoryStat struct {
	AgentID     string
	Count       int
	LastUpdated string // RFC3339, "" if no memories yet
	ReportedAt  string // RFC3339, stamped host-side when the snapshot arrived
}

// UpsertMemoryStats writes or overwrites an agent's memory summary.
func (s *Store) UpsertMemoryStats(agentID string, count int, lastUpdated, reportedAt string) error {
	_, err := s.db.Exec(`
		INSERT INTO agent_memory_stats (agent_id, mem_count, last_updated, reported_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(agent_id) DO UPDATE SET
			mem_count = excluded.mem_count,
			last_updated = excluded.last_updated,
			reported_at = excluded.reported_at`,
		agentID, count, lastUpdated, reportedAt)
	if err != nil {
		return fmt.Errorf("upsert memory stats: %w", err)
	}
	return nil
}

// GetMemoryStats returns every agent's memory summary keyed by agent_id.
func (s *Store) GetMemoryStats() (map[string]MemoryStat, error) {
	rows, err := s.db.Query(`SELECT agent_id, mem_count, COALESCE(last_updated, ''), reported_at FROM agent_memory_stats`)
	if err != nil {
		return nil, fmt.Errorf("get memory stats: %w", err)
	}
	defer func() { _ = rows.Close() }()

	out := make(map[string]MemoryStat)
	for rows.Next() {
		var m MemoryStat
		if err := rows.Scan(&m.AgentID, &m.Count, &m.LastUpdated, &m.ReportedAt); err != nil {
			return nil, fmt.Errorf("scan memory stat: %w", err)
		}
		out[m.AgentID] = m
	}
	return out, rows.Err()
}
