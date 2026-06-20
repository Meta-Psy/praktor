package agent

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/mtzanidakis/praktor/internal/store"
)

func TestApplyMemorySummary(t *testing.T) {
	st, err := store.New(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = st.Close() }()

	o := &Orchestrator{store: st}
	payload := json.RawMessage(`{"count":9,"last_updated":"2026-06-20T08:00:00Z"}`)
	now := time.Date(2026, 6, 20, 9, 0, 0, 0, time.UTC)

	if err := o.applyMemorySummary("agent-x", payload, now); err != nil {
		t.Fatal(err)
	}
	stats, err := st.GetMemoryStats()
	if err != nil {
		t.Fatal(err)
	}
	got := stats["agent-x"]
	if got.Count != 9 || got.LastUpdated != "2026-06-20T08:00:00Z" {
		t.Fatalf("stat = %+v", got)
	}
	if got.ReportedAt != "2026-06-20T09:00:00Z" {
		t.Fatalf("reported_at = %q (host should stamp it)", got.ReportedAt)
	}
}

func TestApplyMemorySummaryRejectsBadPayload(t *testing.T) {
	st, _ := store.New(t.TempDir() + "/test.db")
	defer func() { _ = st.Close() }()
	o := &Orchestrator{store: st}
	if err := o.applyMemorySummary("a", json.RawMessage(`not json`), time.Now()); err == nil {
		t.Fatal("expected error on bad payload")
	}
}
