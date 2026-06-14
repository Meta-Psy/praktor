package web

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// planServer wires a reader (fake fetcher with one item) + fakeQueue.
func planServer(itemJSON string) (*Server, *fakeQueue) {
	f := &fakeIntakeFetcher{files: map[string][]byte{
		"items/id1.json": []byte(itemJSON),
	}}
	q := &fakeQueue{}
	return &Server{intake: &intakeReader{gh: f, repo: "r/q"}, intakeQueue: q}, q
}

func TestHandleIntakeApprove(t *testing.T) {
	s, q := planServer(`{"id":"id1","source":"web","raw_text":"x","status":"awaiting-approval","created_at":"2026-06-15T10:00:00Z","updated_at":"2026-06-15T10:00:00Z"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/intake/id1/approve", nil)
	req.SetPathValue("id", "id1")
	rec := httptest.NewRecorder()
	s.handleIntakeApprove(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d (%s)", rec.Code, rec.Body)
	}
	if q.updated == nil || q.updated.Status != "approved" {
		t.Fatalf("updated = %+v", q.updated)
	}
	if q.updatedSHA == "" {
		t.Fatal("expected sha passed to Update")
	}
}

func TestHandleIntakeApproveInvalid409(t *testing.T) {
	s, _ := planServer(`{"id":"id1","source":"web","raw_text":"x","status":"queued","created_at":"2026-06-15T10:00:00Z","updated_at":"2026-06-15T10:00:00Z"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/intake/id1/approve", nil)
	req.SetPathValue("id", "id1")
	rec := httptest.NewRecorder()
	s.handleIntakeApprove(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("code = %d, want 409", rec.Code)
	}
}

func TestHandleIntakeReject(t *testing.T) {
	s, q := planServer(`{"id":"id1","source":"web","raw_text":"x","status":"awaiting-approval","created_at":"2026-06-15T10:00:00Z","updated_at":"2026-06-15T10:00:00Z"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/intake/id1/reject", strings.NewReader(`{"reason":"redo section A"}`))
	req.SetPathValue("id", "id1")
	rec := httptest.NewRecorder()
	s.handleIntakeReject(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d (%s)", rec.Code, rec.Body)
	}
	if q.updated == nil || q.updated.Status != "needs-design" || q.updated.ReviewNote != "redo section A" {
		t.Fatalf("updated = %+v", q.updated)
	}
}

func TestHandleIntakeApproveNotFound404(t *testing.T) {
	f := &fakeIntakeFetcher{files: map[string][]byte{}}
	s := &Server{intake: &intakeReader{gh: f, repo: "r/q"}, intakeQueue: &fakeQueue{}}
	req := httptest.NewRequest(http.MethodPost, "/api/intake/missing/approve", nil)
	req.SetPathValue("id", "missing")
	rec := httptest.NewRecorder()
	s.handleIntakeApprove(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("code = %d, want 404", rec.Code)
	}
}

func TestHandleIntakeTransitionUnconfigured503(t *testing.T) {
	s := &Server{}
	req := httptest.NewRequest(http.MethodPost, "/api/intake/x/approve", nil)
	req.SetPathValue("id", "x")
	rec := httptest.NewRecorder()
	s.handleIntakeApprove(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("code = %d, want 503", rec.Code)
	}
}
