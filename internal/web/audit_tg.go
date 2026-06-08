package web

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"
)

// auditor records a control-plane action out-of-band (so a leaked MC password
// surfaces as a visible side effect). Best-effort: failures are logged, not returned.
type auditor interface {
	Notify(ctx context.Context, text string)
}

// tgAuditor sends a Telegram message via the bot Token to ChatID.
type tgAuditor struct {
	Token   string
	ChatID  int64
	BaseURL string // default https://api.telegram.org
	HTTP    *http.Client
}

func (a *tgAuditor) Notify(ctx context.Context, text string) {
	if a == nil || a.Token == "" || a.ChatID == 0 {
		return // auditing disabled
	}
	base := a.BaseURL
	if base == "" {
		base = "https://api.telegram.org"
	}
	hc := a.HTTP
	if hc == nil {
		hc = &http.Client{Timeout: 8 * time.Second}
	}
	body, _ := json.Marshal(map[string]any{"chat_id": a.ChatID, "text": text})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/bot%s/sendMessage", base, a.Token), bytes.NewReader(body))
	if err != nil {
		slog.Warn("tg audit build request", "err", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := hc.Do(req)
	if err != nil {
		slog.Warn("tg audit send", "err", err)
		return
	}
	_ = resp.Body.Close()
}
