package store

import "testing"

func TestIntelSnapshotInsertLatestList(t *testing.T) {
	s := newTestStore(t)

	if _, err := s.LatestSnapshot("mentis-centers"); err != nil {
		t.Fatalf("LatestSnapshot on empty: %v", err)
	}
	if latest, _ := s.LatestSnapshot("mentis-centers"); latest != nil {
		t.Fatalf("expected nil latest on empty, got %+v", latest)
	}

	first := IntelSnapshot{
		SourceKey: "mentis-centers", Project: "mentis", CapturedAt: 1000,
		Payload: `{"summary":"40 centers"}`, ChangeNote: "first snapshot", OK: true,
	}
	if err := s.InsertIntelSnapshot(first); err != nil {
		t.Fatalf("insert first: %v", err)
	}
	second := IntelSnapshot{
		SourceKey: "mentis-centers", Project: "mentis", CapturedAt: 2000,
		Payload: `{"summary":"42 centers"}`, ChangeNote: "+2 centers", OK: true,
	}
	if err := s.InsertIntelSnapshot(second); err != nil {
		t.Fatalf("insert second: %v", err)
	}

	latest, err := s.LatestSnapshot("mentis-centers")
	if err != nil || latest == nil {
		t.Fatalf("LatestSnapshot: %v, %+v", err, latest)
	}
	if latest.CapturedAt != 2000 || latest.ChangeNote != "+2 centers" {
		t.Errorf("latest = %+v, want CapturedAt=2000", latest)
	}

	all, err := s.ListIntelSnapshots()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(all) != 2 {
		t.Fatalf("len = %d, want 2", len(all))
	}
	if all[0].CapturedAt != 2000 {
		t.Errorf("list not newest-first: %+v", all[0])
	}
}
