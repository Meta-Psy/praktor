package intel

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/adhocore/gronx"
	"github.com/mtzanidakis/praktor/internal/config"
	"github.com/mtzanidakis/praktor/internal/store"
)

// Collector runs per-source scrape cycles on a cron schedule.
type Collector struct {
	runner AgentRunner
	store  SnapshotStore
	cfg    config.IntelConfig
	now    func() int64 // unix seconds; injectable for tests
}

// NewCollector builds a collector. Sources come from cfg.Sources.
func NewCollector(r AgentRunner, st SnapshotStore, cfg config.IntelConfig) *Collector {
	return &Collector{
		runner: r, store: st, cfg: cfg,
		now: func() int64 { return time.Now().Unix() },
	}
}

// Run starts one goroutine per source; each sleeps until its next cron tick,
// runs collectOnce, and repeats until ctx is cancelled.
func (c *Collector) Run(ctx context.Context) {
	for _, src := range c.cfg.Sources {
		go c.runSource(ctx, src)
	}
	<-ctx.Done()
}

func (c *Collector) runSource(ctx context.Context, src config.IntelSource) {
	for {
		next, err := gronx.NextTick(src.Cron, false)
		if err != nil {
			slog.Error("intel: bad cron, source disabled", "source", src.Key, "cron", src.Cron, "error", err)
			return
		}
		wait := time.Until(next)
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
			if err := c.collectOnce(ctx, src); err != nil {
				slog.Error("intel: collectOnce failed", "source", src.Key, "error", err)
			}
		}
	}
}

// collectOnce runs one scrape cycle: load previous snapshot, ask the agent,
// parse, and insert a snapshot row. Agent/parse failures are recorded as a
// failure snapshot (ok=false) rather than returned as errors, so history is
// never broken.
func (c *Collector) collectOnce(ctx context.Context, src config.IntelSource) error {
	prev, err := c.store.LatestSnapshot(src.Key)
	if err != nil {
		return err
	}
	prompt := buildPrompt(src.Instruction, prev)

	resp, runErr := c.runner.RunCapture(ctx, src.Agent, prompt)
	captured := c.now()
	if runErr != nil {
		return c.store.InsertIntelSnapshot(store.IntelSnapshot{
			SourceKey: src.Key, Project: src.Project, CapturedAt: captured,
			OK: false, Error: runErr.Error(),
		})
	}

	snap, perr := parseSnapshot(resp)
	if perr != nil {
		return c.store.InsertIntelSnapshot(store.IntelSnapshot{
			SourceKey: src.Key, Project: src.Project, CapturedAt: captured,
			OK: false, Error: perr.Error(),
		})
	}

	payload, _ := json.Marshal(map[string]any{
		"summary": snap.Summary, "metrics": snap.Metrics, "items": snap.Items,
	})
	return c.store.InsertIntelSnapshot(store.IntelSnapshot{
		SourceKey: src.Key, Project: src.Project, CapturedAt: captured,
		Payload: string(payload), ChangeNote: snap.ChangeNote, OK: true,
	})
}
