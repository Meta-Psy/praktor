package radar

import (
	"context"
	"fmt"
	"log/slog"
	"net/url"
	"time"

	"github.com/mtzanidakis/praktor/internal/config"
	"github.com/mtzanidakis/praktor/internal/store"
)

// Collector periodically searches GitHub for ecosystem tooling and upserts hits.
type Collector struct {
	Search RepoSearcher
	Store  RadarStore
	Cfg    config.RadarConfig
	now    func() time.Time // injectable clock; nil → time.Now
}

// NewCollector builds a Collector with the real clock.
func NewCollector(search RepoSearcher, st RadarStore, cfg config.RadarConfig) *Collector {
	return &Collector{Search: search, Store: st, Cfg: cfg}
}

func (c *Collector) clock() time.Time {
	if c.now != nil {
		return c.now()
	}
	return time.Now().UTC()
}

// buildSearchQuery builds the GitHub repository-search query string for one topic.
func buildSearchQuery(topic string, minStars, freshnessDays int, now time.Time) string {
	since := now.Add(-time.Duration(freshnessDays) * 24 * time.Hour).Format("2006-01-02")
	q := fmt.Sprintf("topic:%s stars:>=%d pushed:>=%s archived:false fork:false", topic, minStars, since)
	return "q=" + url.QueryEscape(q) + "&sort=stars&order=desc&per_page=50"
}

// Run ticks every poll_interval until ctx is cancelled.
func (c *Collector) Run(ctx context.Context) {
	interval := c.Cfg.PollInterval
	if interval <= 0 {
		interval = 6 * time.Hour
	}
	c.collectOnce(ctx) // first pass immediately on startup
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := c.collectOnce(ctx); err != nil {
				slog.Error("radar collect failed", "error", err)
			}
		}
	}
}

// collectOnce runs one search-filter-upsert pass across all configured topics.
func (c *Collector) collectOnce(ctx context.Context) error {
	now := c.clock()
	stamp := now.Format(time.RFC3339)
	for _, topic := range c.Cfg.Topics {
		q := buildSearchQuery(topic, c.Cfg.MinStars, c.Cfg.FreshnessDays, now)
		repos, err := c.Search.SearchRepos(ctx, q)
		if err != nil {
			slog.Warn("radar search failed for topic", "topic", topic, "error", err)
			continue // a single topic failing must not abort the whole pass
		}
		for _, r := range repos {
			if !keepRepo(r, c.Cfg.MinStars, c.Cfg.FreshnessDays, now) {
				continue
			}
			if err := c.Store.UpsertRadarItem(store.RadarItem{
				FullName: r.FullName, Name: r.Name, Description: r.Description,
				HTMLURL: r.HTMLURL, Stars: r.Stars, Topic: topic, PushedAt: r.PushedAt,
				FirstSeen: stamp, LastUpdated: stamp,
			}); err != nil {
				slog.Warn("radar upsert failed", "repo", r.FullName, "error", err)
			}
		}
	}
	return nil
}
