package web

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/mtzanidakis/praktor/internal/config"
	"github.com/mtzanidakis/praktor/internal/registry"
	"github.com/mtzanidakis/praktor/internal/store"
)

// seedWebTask saves a minimal active scheduled task for web layer tests.
func seedWebTask(t *testing.T, st *store.Store, id string) {
	t.Helper()
	next := time.Now().Add(24 * time.Hour)
	task := &store.ScheduledTask{
		ID:          id,
		AgentID:     "coder",
		Name:        "Утренняя сводка",
		Schedule:    `{"kind":"cron","cron_expr":"0 9 * * *"}`,
		Prompt:      "собери сводку",
		ContextMode: "isolated",
		Status:      "active",
		NextRunAt:   &next,
	}
	if err := st.SaveTask(task); err != nil {
		t.Fatal(err)
	}
}

func TestListTasksExposesFailureInfo(t *testing.T) {
	st := newTestStoreForWeb(t)
	reg := registry.New(st, map[string]config.AgentDefinition{
		"coder": {Description: "Engineer"},
	}, config.DefaultsConfig{}, t.TempDir())
	if err := reg.Sync(); err != nil {
		t.Fatal(err)
	}

	seedWebTask(t, st, "t1")
	if err := st.UpdateTaskRun("t1", "error", "AgentMail API: 401 Unauthorized", nil); err != nil {
		t.Fatal(err)
	}

	s := &Server{store: st}
	rec := httptest.NewRecorder()
	s.listTasks(rec, httptest.NewRequest(http.MethodGet, "/api/tasks", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d (%s)", rec.Code, rec.Body)
	}
	var out []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if len(out) != 1 {
		t.Fatalf("len = %d, want 1", len(out))
	}
	if out[0]["last_status"] != "error" {
		t.Errorf("last_status = %v, want error", out[0]["last_status"])
	}
	if out[0]["last_error"] != "AgentMail API: 401 Unauthorized" {
		t.Errorf("last_error = %v", out[0]["last_error"])
	}
}

func TestListTasksOmitsEmptyFailureInfo(t *testing.T) {
	st := newTestStoreForWeb(t)
	reg := registry.New(st, map[string]config.AgentDefinition{
		"coder": {Description: "Engineer"},
	}, config.DefaultsConfig{}, t.TempDir())
	if err := reg.Sync(); err != nil {
		t.Fatal(err)
	}

	seedWebTask(t, st, "t1")

	s := &Server{store: st}
	rec := httptest.NewRecorder()
	s.listTasks(rec, httptest.NewRequest(http.MethodGet, "/api/tasks", nil))

	var out []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if _, ok := out[0]["last_status"]; ok {
		t.Error("empty last_status must not be present in JSON")
	}
	if _, ok := out[0]["last_error"]; ok {
		t.Error("empty last_error must not be present in JSON")
	}
}

func TestRunTaskNow(t *testing.T) {
	st := newTestStoreForWeb(t)
	reg := registry.New(st, map[string]config.AgentDefinition{
		"coder": {Description: "Engineer"},
	}, config.DefaultsConfig{}, t.TempDir())
	if err := reg.Sync(); err != nil {
		t.Fatal(err)
	}

	seedWebTask(t, st, "t1")
	if err := st.UpdateTaskStatus("t1", "paused"); err != nil {
		t.Fatal(err)
	}

	s := &Server{store: st}
	req := httptest.NewRequest(http.MethodPost, "/api/tasks/t1/run", nil)
	req.SetPathValue("id", "t1")
	rec := httptest.NewRecorder()
	s.runTaskNow(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d (%s)", rec.Code, rec.Body)
	}
	got, err := st.GetTask("t1")
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != "active" {
		t.Errorf("status = %q, want active (pause should be cleared)", got.Status)
	}
	if got.NextRunAt == nil || got.NextRunAt.After(time.Now().Add(time.Second)) {
		t.Errorf("next_run_at = %v, want ~now", got.NextRunAt)
	}
}

func TestRunTaskNowNotFound(t *testing.T) {
	st := newTestStoreForWeb(t)
	s := &Server{store: st}
	req := httptest.NewRequest(http.MethodPost, "/api/tasks/ghost/run", nil)
	req.SetPathValue("id", "ghost")
	rec := httptest.NewRecorder()
	s.runTaskNow(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("code = %d, want 404", rec.Code)
	}
}
