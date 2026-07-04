package web

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mtzanidakis/praktor/internal/config"
	"github.com/mtzanidakis/praktor/internal/registry"
)

type fakeChat struct {
	agentID string
	text    string
	meta    map[string]string
	aborted string
	err     error
}

func (f *fakeChat) HandleMessage(_ context.Context, agentID, text string, meta map[string]string) error {
	f.agentID, f.text, f.meta = agentID, text, meta
	return f.err
}

func (f *fakeChat) AbortSession(_ context.Context, agentID string) error {
	f.aborted = agentID
	return f.err
}

func newChatTestServer(t *testing.T) (*Server, *fakeChat) {
	t.Helper()
	st := newTestStoreForWeb(t)
	reg := registry.New(st, map[string]config.AgentDefinition{
		"coder": {Description: "Engineer"},
	}, config.DefaultsConfig{}, t.TempDir())
	if err := reg.Sync(); err != nil {
		t.Fatal(err)
	}
	fake := &fakeChat{}
	return &Server{store: st, registry: reg, chat: fake}, fake
}

func TestSendAgentMessage(t *testing.T) {
	s, fake := newChatTestServer(t)

	req := httptest.NewRequest(http.MethodPost, "/api/agents/definitions/coder/message",
		strings.NewReader(`{"text":"  привет  "}`))
	req.SetPathValue("id", "coder")
	rec := httptest.NewRecorder()
	s.sendAgentMessage(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d (%s)", rec.Code, rec.Body)
	}
	if fake.agentID != "coder" || fake.text != "привет" {
		t.Errorf("dispatched (%q, %q), want (coder, привет)", fake.agentID, fake.text)
	}
	if fake.meta["origin"] != "web" || fake.meta["sender"] != "user:web" {
		t.Errorf("meta = %v, want origin=web sender=user:web", fake.meta)
	}
	if _, ok := fake.meta["chat_id"]; ok {
		t.Error("web message must not carry chat_id")
	}
	var resp map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp["status"] != "queued" {
		t.Errorf("status = %q, want queued", resp["status"])
	}
}

func TestSendAgentMessageEmptyText(t *testing.T) {
	s, fake := newChatTestServer(t)
	req := httptest.NewRequest(http.MethodPost, "/api/agents/definitions/coder/message",
		strings.NewReader(`{"text":"   "}`))
	req.SetPathValue("id", "coder")
	rec := httptest.NewRecorder()
	s.sendAgentMessage(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400", rec.Code)
	}
	if fake.agentID != "" {
		t.Error("dispatcher must not be called for empty text")
	}
}

func TestSendAgentMessageUnknownAgent(t *testing.T) {
	s, fake := newChatTestServer(t)
	req := httptest.NewRequest(http.MethodPost, "/api/agents/definitions/ghost/message",
		strings.NewReader(`{"text":"hi"}`))
	req.SetPathValue("id", "ghost")
	rec := httptest.NewRecorder()
	s.sendAgentMessage(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("code = %d, want 404", rec.Code)
	}
	if fake.agentID != "" {
		t.Error("dispatcher must not be called for unknown agent")
	}
}

func TestAbortAgent(t *testing.T) {
	s, fake := newChatTestServer(t)
	req := httptest.NewRequest(http.MethodPost, "/api/agents/definitions/coder/abort", nil)
	req.SetPathValue("id", "coder")
	rec := httptest.NewRecorder()
	s.abortAgent(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d (%s)", rec.Code, rec.Body)
	}
	if fake.aborted != "coder" {
		t.Errorf("aborted = %q, want coder", fake.aborted)
	}
}
