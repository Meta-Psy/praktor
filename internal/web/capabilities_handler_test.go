package web

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mtzanidakis/praktor/internal/config"
	"github.com/mtzanidakis/praktor/internal/registry"
	"github.com/mtzanidakis/praktor/internal/store"
)

func TestHandleCapabilities(t *testing.T) {
	st := newTestStoreForWeb(t)
	defs := map[string]config.AgentDefinition{
		"coder": {Description: "Engineer", AllowedTools: []string{"Bash"}},
	}
	reg := registry.New(st, defs, config.DefaultsConfig{Model: "claude-sonnet-4-6"}, t.TempDir())
	if err := reg.Sync(); err != nil {
		t.Fatal(err)
	}
	// Sync auto-creates a placeholder USER.md; an unedited template is not a
	// "customized" profile, so user_profile_present must stay false.

	if err := st.UpsertMemoryStats("coder", 5, "2026-06-20T08:00:00Z", "2026-06-20T09:00:00Z"); err != nil {
		t.Fatal(err)
	}

	s := &Server{store: st, registry: reg}
	req := httptest.NewRequest(http.MethodGet, "/api/agents/capabilities", nil)
	rec := httptest.NewRecorder()
	s.handleCapabilities(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d (%s)", rec.Code, rec.Body)
	}
	var got CatalogResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.UserProfilePresent {
		t.Error("expected user_profile_present=false (no USER.md)")
	}
	if len(got.Agents) != 1 || got.Agents[0].AgentID != "coder" {
		t.Fatalf("agents = %+v", got.Agents)
	}
	if !got.Agents[0].Restricted {
		t.Error("coder should be restricted")
	}
	if got.Agents[0].Memory == nil || got.Agents[0].Memory.Count != 5 {
		t.Errorf("memory = %+v", got.Agents[0].Memory)
	}
}

func TestHandleCapabilitiesCustomizedProfile(t *testing.T) {
	st := newTestStoreForWeb(t)
	reg := registry.New(st, map[string]config.AgentDefinition{}, config.DefaultsConfig{}, t.TempDir())
	if err := reg.Sync(); err != nil {
		t.Fatal(err)
	}
	// User edited their profile → present must be true.
	if err := reg.SaveUserMD("# User Profile\n\n## Name\nAlex\n"); err != nil {
		t.Fatal(err)
	}

	s := &Server{store: st, registry: reg}
	rec := httptest.NewRecorder()
	s.handleCapabilities(rec, httptest.NewRequest(http.MethodGet, "/api/agents/capabilities", nil))

	var got CatalogResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if !got.UserProfilePresent {
		t.Error("expected user_profile_present=true for a customized USER.md")
	}
}

func newTestStoreForWeb(t *testing.T) *store.Store {
	t.Helper()
	st, err := store.New(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return st
}
