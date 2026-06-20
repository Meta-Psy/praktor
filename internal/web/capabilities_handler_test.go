package web

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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
	base := t.TempDir()
	reg := registry.New(st, defs, config.DefaultsConfig{Model: "claude-sonnet-4-6"}, base)
	if err := reg.Sync(); err != nil {
		t.Fatal(err)
	}
	// Sync auto-creates a template global/USER.md; remove it so the
	// "no user profile" scenario under test actually holds.
	_ = os.Remove(filepath.Join(base, "global", "USER.md"))

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

func newTestStoreForWeb(t *testing.T) *store.Store {
	t.Helper()
	st, err := store.New(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return st
}
