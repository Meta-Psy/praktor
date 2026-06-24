package radar

import (
	"context"
	"testing"
	"time"

	"github.com/mtzanidakis/praktor/internal/config"
	"github.com/mtzanidakis/praktor/internal/store"
)

type fakeSearcher struct {
	byQuery map[string][]RadarRepo
	calls   []string
}

func (f *fakeSearcher) SearchRepos(_ context.Context, query string) ([]RadarRepo, error) {
	f.calls = append(f.calls, query)
	return f.byQuery[query], nil
}

type fakeStore struct {
	items map[string]store.RadarItem
	meta  map[string]string
}

func newFakeStore() *fakeStore {
	return &fakeStore{items: map[string]store.RadarItem{}, meta: map[string]string{}}
}
func (f *fakeStore) UpsertRadarItem(it store.RadarItem) error {
	if existing, ok := f.items[it.FullName]; ok {
		it.FirstSeen = existing.FirstSeen // mimic the real preserve-first_seen
	}
	f.items[it.FullName] = it
	return nil
}
func (f *fakeStore) ListRadarItems() ([]store.RadarItem, error) {
	out := make([]store.RadarItem, 0, len(f.items))
	for _, v := range f.items {
		out = append(out, v)
	}
	return out, nil
}
func (f *fakeStore) GetRadarMeta(k string) (string, error) { return f.meta[k], nil }
func (f *fakeStore) SetRadarMeta(k, v string) error        { f.meta[k] = v; return nil }

func TestCollectOnceUpsertsAndFilters(t *testing.T) {
	now := time.Date(2026, 6, 24, 12, 0, 0, 0, time.UTC)
	fresh := now.Add(-2 * 24 * time.Hour).Format(time.RFC3339)
	cfg := config.RadarConfig{MinStars: 10, FreshnessDays: 30, Topics: []string{"mcp"}}

	search := &fakeSearcher{byQuery: map[string][]RadarRepo{}}
	q := buildSearchQuery("mcp", cfg.MinStars, cfg.FreshnessDays, now)
	search.byQuery[q] = []RadarRepo{
		{FullName: "o/good", Name: "good", HTMLURL: "u", Stars: 50, PushedAt: fresh},
		{FullName: "o/lowstars", Name: "low", HTMLURL: "u", Stars: 1, PushedAt: fresh},
	}
	st := newFakeStore()

	c := &Collector{Search: search, Store: st, Cfg: cfg, now: func() time.Time { return now }}
	if err := c.collectOnce(context.Background()); err != nil {
		t.Fatal(err)
	}

	items, _ := st.ListRadarItems()
	if len(items) != 1 || items[0].FullName != "o/good" {
		t.Fatalf("items = %+v, want only o/good (low stars filtered)", items)
	}
	if items[0].FirstSeen == "" || items[0].Topic != "mcp" {
		t.Fatalf("item not stamped: %+v", items[0])
	}
}
