package radar

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/mtzanidakis/praktor/internal/config"
	"github.com/mtzanidakis/praktor/internal/store"
)

const lastDigestKey = "last_digest_at"

// buildDigestPrompt composes a human-facing digest prompt from new items.
// Returns "" when there is nothing to summarise.
func buildDigestPrompt(items []store.RadarItem) string {
	if len(items) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("Радар экосистемы Claude нашёл новые инструменты на GitHub с прошлого дайджеста. ")
	b.WriteString("Дай краткую сводку (2-4 предложения): что появилось интересного, на что обратить внимание.\n\n")
	for _, it := range items {
		fmt.Fprintf(&b, "- %s (%s★) — %s\n  %s\n", it.FullName, strconv.Itoa(it.Stars), it.Description, it.HTMLURL)
	}
	return b.String()
}

// Digest periodically summarises newly-seen radar items to Telegram via an agent.
type Digest struct {
	Store        RadarStore
	Handler      MessageHandler
	Cfg          config.RadarConfig
	DefaultAgent string
	MainChatID   int64
	now          func() time.Time
}

// NewDigest builds a Digest with the real clock.
func NewDigest(st RadarStore, h MessageHandler, cfg config.RadarConfig, defaultAgent string, mainChatID int64) *Digest {
	return &Digest{Store: st, Handler: h, Cfg: cfg, DefaultAgent: defaultAgent, MainChatID: mainChatID}
}

func (d *Digest) clock() time.Time {
	if d.now != nil {
		return d.now()
	}
	return time.Now().UTC()
}

// Run ticks every digest_interval until ctx is cancelled.
func (d *Digest) Run(ctx context.Context) {
	interval := d.Cfg.DigestInterval
	if interval <= 0 {
		interval = 168 * time.Hour
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := d.runOnce(ctx); err != nil {
				slog.Error("radar digest failed", "error", err)
			}
		}
	}
}

// runOnce sends one digest of items first-seen after the last digest timestamp.
func (d *Digest) runOnce(ctx context.Context) error {
	last, err := d.Store.GetRadarMeta(lastDigestKey)
	if err != nil {
		return err
	}
	items, err := d.Store.ListRadarItems()
	if err != nil {
		return err
	}
	var fresh []store.RadarItem
	for _, it := range items {
		if last == "" || it.FirstSeen > last {
			fresh = append(fresh, it)
		}
	}
	now := d.clock().Format(time.RFC3339)
	prompt := buildDigestPrompt(fresh)
	if prompt == "" {
		return d.Store.SetRadarMeta(lastDigestKey, now) // nothing new; advance watermark
	}
	meta := map[string]string{"sender": "radar"}
	if d.MainChatID != 0 {
		meta["chat_id"] = strconv.FormatInt(d.MainChatID, 10)
	}
	if err := d.Handler.HandleMessage(ctx, d.DefaultAgent, prompt, meta); err != nil {
		return err // leave the watermark so the next tick retries
	}
	return d.Store.SetRadarMeta(lastDigestKey, now)
}
