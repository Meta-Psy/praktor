package store

import "testing"

func TestUpsertAndGetMemoryStats(t *testing.T) {
	s := newTestStore(t)

	if err := s.UpsertMemoryStats("agent-a", 12, "2026-06-20T08:00:00Z", "2026-06-20T09:00:00Z"); err != nil {
		t.Fatal(err)
	}
	stats, err := s.GetMemoryStats()
	if err != nil {
		t.Fatal(err)
	}
	got, ok := stats["agent-a"]
	if !ok {
		t.Fatal("agent-a missing")
	}
	if got.Count != 12 || got.LastUpdated != "2026-06-20T08:00:00Z" || got.ReportedAt != "2026-06-20T09:00:00Z" {
		t.Fatalf("stat = %+v", got)
	}

	// Upsert overwrites the same agent_id.
	if err := s.UpsertMemoryStats("agent-a", 15, "2026-06-20T10:00:00Z", "2026-06-20T10:01:00Z"); err != nil {
		t.Fatal(err)
	}
	stats, _ = s.GetMemoryStats()
	if stats["agent-a"].Count != 15 {
		t.Fatalf("count after upsert = %d, want 15", stats["agent-a"].Count)
	}
}
