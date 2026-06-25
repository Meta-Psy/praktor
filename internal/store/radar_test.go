package store

import "testing"

func TestUpsertRadarItemPreservesFirstSeen(t *testing.T) {
	s := newTestStore(t)

	first := RadarItem{
		FullName: "owner/mcp-tool", Name: "mcp-tool", Description: "a tool",
		HTMLURL: "https://github.com/owner/mcp-tool", Stars: 10, Topic: "mcp",
		PushedAt: "2026-06-20T08:00:00Z", FirstSeen: "2026-06-22T00:00:00Z",
		LastUpdated: "2026-06-22T00:00:00Z",
	}
	if err := s.UpsertRadarItem(first); err != nil {
		t.Fatal(err)
	}
	second := first
	second.Stars = 42
	second.FirstSeen = "2026-06-24T00:00:00Z" // should be ignored
	second.LastUpdated = "2026-06-24T00:00:00Z"
	if err := s.UpsertRadarItem(second); err != nil {
		t.Fatal(err)
	}

	items, err := s.ListRadarItems()
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("len = %d, want 1", len(items))
	}
	if items[0].Stars != 42 {
		t.Errorf("stars = %d, want 42 (updated)", items[0].Stars)
	}
	if items[0].FirstSeen != "2026-06-22T00:00:00Z" {
		t.Errorf("first_seen = %q, want preserved 2026-06-22", items[0].FirstSeen)
	}
}

func TestListRadarItemsSortsByStars(t *testing.T) {
	s := newTestStore(t)
	for _, it := range []RadarItem{
		{FullName: "a/low", Name: "low", HTMLURL: "u", Stars: 5, Topic: "mcp", FirstSeen: "t", LastUpdated: "t"},
		{FullName: "a/high", Name: "high", HTMLURL: "u", Stars: 99, Topic: "mcp", FirstSeen: "t", LastUpdated: "t"},
	} {
		if err := s.UpsertRadarItem(it); err != nil {
			t.Fatal(err)
		}
	}
	items, _ := s.ListRadarItems()
	if items[0].FullName != "a/high" {
		t.Fatalf("order = %v, want high first", items)
	}
}

func TestRadarMeta(t *testing.T) {
	s := newTestStore(t)
	v, err := s.GetRadarMeta("last_digest_at")
	if err != nil {
		t.Fatal(err)
	}
	if v != "" {
		t.Fatalf("absent key = %q, want empty", v)
	}
	if err := s.SetRadarMeta("last_digest_at", "2026-06-24T00:00:00Z"); err != nil {
		t.Fatal(err)
	}
	v, _ = s.GetRadarMeta("last_digest_at")
	if v != "2026-06-24T00:00:00Z" {
		t.Fatalf("got %q", v)
	}
}
