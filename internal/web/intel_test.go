package web

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mtzanidakis/praktor/internal/store"
)

func TestHandleIntelGrouping(t *testing.T) {
	st := newTestStoreForWeb(t)
	_ = st.InsertIntelSnapshot(store.IntelSnapshot{SourceKey: "a", Project: "mentis", CapturedAt: 10, Payload: `{"summary":"v1"}`, ChangeNote: "first snapshot", OK: true})
	_ = st.InsertIntelSnapshot(store.IntelSnapshot{SourceKey: "a", Project: "mentis", CapturedAt: 20, Payload: `{"summary":"v2"}`, ChangeNote: "+2", OK: true})
	_ = st.InsertIntelSnapshot(store.IntelSnapshot{SourceKey: "b", Project: "dimed", CapturedAt: 15, OK: false, Error: "unreachable"})

	srv := &Server{store: st}

	req := httptest.NewRequest(http.MethodGet, "/api/intel", nil)
	rec := httptest.NewRecorder()
	srv.handleIntel(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var resp intelResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Sources) != 2 {
		t.Fatalf("sources = %d, want 2", len(resp.Sources))
	}
	var a *intelSource
	for i := range resp.Sources {
		if resp.Sources[i].Key == "a" {
			a = &resp.Sources[i]
		}
	}
	if a == nil {
		t.Fatal("source a missing")
	}
	if a.Latest == nil || a.Latest.ChangeNote != "+2" {
		t.Errorf("latest = %+v, want change_note=+2", a.Latest)
	}
	if len(a.History) != 2 {
		t.Errorf("history = %d, want 2", len(a.History))
	}
}
