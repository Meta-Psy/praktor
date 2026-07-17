package web

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mtzanidakis/praktor/internal/store"
)

func seedThread(t *testing.T, st *store.Store, id, project, title string) {
	t.Helper()
	if err := st.CreateThread(store.Thread{ID: id, ProjectKey: project, Title: title, Status: "active"}); err != nil {
		t.Fatalf("seed thread: %v", err)
	}
}

func TestThreadsMap(t *testing.T) {
	st := newTestStoreForWeb(t)
	srv := &Server{store: st}
	seedThread(t, st, "t1", "praktor", "Штаб UX")
	_ = st.CreatePoint(store.ThreadPoint{ID: "p1", ThreadID: "t1", Kind: "pr", Title: "PR #24",
		Repo: "Meta-Psy/praktor", PRNumber: 24, PRState: "merged", Confirmed: true})
	_ = st.CreateIdea(store.Idea{ID: "i1", Title: "Контроль", Status: "active"})
	_ = st.SetIdeaThreads("i1", []string{"t1"})

	req := httptest.NewRequest(http.MethodGet, "/api/threads/map", nil)
	rec := httptest.NewRecorder()
	srv.handleThreadsMap(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var resp threadsMapResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Threads) != 1 || len(resp.Points) != 1 || len(resp.Ideas) != 1 {
		t.Fatalf("map = %d/%d/%d, want 1/1/1", len(resp.Threads), len(resp.Points), len(resp.Ideas))
	}
	if resp.Threads[0].Title != "Штаб UX" || resp.Points[0].PRNumber != 24 ||
		len(resp.Ideas[0].ThreadIDs) != 1 {
		t.Errorf("map content = %+v", resp)
	}
}

func TestThreadCreateValidation(t *testing.T) {
	st := newTestStoreForWeb(t)
	srv := &Server{store: st}

	// без title — 400
	req := httptest.NewRequest(http.MethodPost, "/api/threads",
		strings.NewReader(`{"project_key":"praktor"}`))
	rec := httptest.NewRecorder()
	srv.createThread(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("no-title status = %d, want 400", rec.Code)
	}

	// валидный — 200 c id
	req = httptest.NewRequest(http.MethodPost, "/api/threads",
		strings.NewReader(`{"project_key":"praktor","title":"Нити идей"}`))
	rec = httptest.NewRecorder()
	srv.createThread(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("create status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var created threadAPI
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	if created.ID == "" || created.Status != "active" {
		t.Errorf("created = %+v", created)
	}
}

func TestThreadUpdateAndDelete(t *testing.T) {
	st := newTestStoreForWeb(t)
	srv := &Server{store: st}
	seedThread(t, st, "t1", "praktor", "Штаб UX")

	req := httptest.NewRequest(http.MethodPut, "/api/threads/t1",
		strings.NewReader(`{"title":"Штаб UX v2","status":"done"}`))
	req.SetPathValue("id", "t1")
	rec := httptest.NewRecorder()
	srv.updateThread(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("update status = %d, body=%s", rec.Code, rec.Body.String())
	}
	got, _ := st.GetThread("t1")
	if got.Title != "Штаб UX v2" || got.Status != "done" || got.EndedAt == "" {
		t.Errorf("after update = %+v (status=done должен ставить ended_at)", got)
	}

	// bad status — 400
	req = httptest.NewRequest(http.MethodPut, "/api/threads/t1",
		strings.NewReader(`{"title":"x","status":"bogus"}`))
	req.SetPathValue("id", "t1")
	rec = httptest.NewRecorder()
	srv.updateThread(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("bogus status = %d, want 400", rec.Code)
	}

	req = httptest.NewRequest(http.MethodDelete, "/api/threads/t1", nil)
	req.SetPathValue("id", "t1")
	rec = httptest.NewRecorder()
	srv.deleteThread(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete status = %d", rec.Code)
	}
	if gone, _ := st.GetThread("t1"); gone != nil {
		t.Error("thread survived delete")
	}
}

func TestPointEndpoints(t *testing.T) {
	st := newTestStoreForWeb(t)
	srv := &Server{store: st}
	seedThread(t, st, "t1", "praktor", "Контроль проектов")

	// создать planned-точку
	req := httptest.NewRequest(http.MethodPost, "/api/threads/t1/points",
		strings.NewReader(`{"title":"нити идей","position":3}`))
	req.SetPathValue("id", "t1")
	rec := httptest.NewRecorder()
	srv.createPlannedPoint(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("create point = %d, body=%s", rec.Code, rec.Body.String())
	}
	var planned pointAPI
	_ = json.Unmarshal(rec.Body.Bytes(), &planned)
	if planned.Kind != "planned" || planned.ThreadID != "t1" {
		t.Errorf("planned = %+v", planned)
	}

	// inbox + confirm с материализацией
	_ = st.CreatePoint(store.ThreadPoint{ID: "sugg", Kind: "pr", Title: "feat: threads",
		Repo: "Meta-Psy/praktor", PRNumber: 30, PRState: "open", Confirmed: false})
	req = httptest.NewRequest(http.MethodGet, "/api/threads/inbox", nil)
	rec = httptest.NewRecorder()
	srv.threadsInbox(rec, req)
	var inbox []pointAPI
	_ = json.Unmarshal(rec.Body.Bytes(), &inbox)
	if len(inbox) != 1 || inbox[0].ID != "sugg" {
		t.Fatalf("inbox = %+v", inbox)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/points/sugg/confirm",
		strings.NewReader(`{"thread_id":"t1","materialize_point_id":"`+planned.ID+`"}`))
	req.SetPathValue("id", "sugg")
	rec = httptest.NewRecorder()
	srv.confirmPoint(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("confirm = %d, body=%s", rec.Code, rec.Body.String())
	}
	pts, _ := st.ListPoints()
	if len(pts) != 1 || pts[0].Kind != "pr" || pts[0].PRNumber != 30 || pts[0].Title != "нити идей" {
		t.Errorf("after materialize = %+v", pts)
	}
}

func TestNotesAndIdeas(t *testing.T) {
	st := newTestStoreForWeb(t)
	srv := &Server{store: st}
	seedThread(t, st, "t1", "praktor", "Штаб UX")

	req := httptest.NewRequest(http.MethodPost, "/api/threads/t1/notes",
		strings.NewReader(`{"body":"решение: карта первой","source":"chat"}`))
	req.SetPathValue("id", "t1")
	rec := httptest.NewRecorder()
	srv.createThreadNote(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("note = %d, body=%s", rec.Code, rec.Body.String())
	}
	notes, _ := st.ListNotes("t1")
	if len(notes) != 1 || notes[0].Source != "chat" {
		t.Errorf("notes = %+v", notes)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/ideas",
		strings.NewReader(`{"title":"Контроль","thread_ids":["t1"]}`))
	rec = httptest.NewRecorder()
	srv.createIdea(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("idea = %d, body=%s", rec.Code, rec.Body.String())
	}
	ideas, _ := st.ListIdeas()
	if len(ideas) != 1 || len(ideas[0].ThreadIDs) != 1 {
		t.Errorf("ideas = %+v", ideas)
	}
}
