package web

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTGAuditNotify(t *testing.T) {
	var gotPath, gotBody string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer ts.Close()

	a := &tgAuditor{Token: "BOT:tok", ChatID: 71353121, BaseURL: ts.URL, HTTP: ts.Client()}
	a.Notify(context.Background(), "✅ MC: merge o/r#12")

	if !strings.HasSuffix(gotPath, "/botBOT:tok/sendMessage") {
		t.Errorf("path = %q", gotPath)
	}
	var parsed struct {
		ChatID int64  `json:"chat_id"`
		Text   string `json:"text"`
	}
	_ = json.Unmarshal([]byte(gotBody), &parsed)
	if parsed.ChatID != 71353121 || !strings.Contains(parsed.Text, "merge o/r#12") {
		t.Errorf("body = %q", gotBody)
	}
}

// Notify must never panic or block forever when TG is unreachable / unconfigured.
func TestTGAuditDisabledNoop(t *testing.T) {
	a := &tgAuditor{}                          // no token
	a.Notify(context.Background(), "anything") // must not panic
}
