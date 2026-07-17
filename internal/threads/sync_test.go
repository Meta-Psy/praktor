package threads

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/mtzanidakis/praktor/internal/store"
)

func newTestStore(t *testing.T) *store.Store {
	t.Helper()
	s, err := store.New(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

type fakeLister struct {
	prs  map[string][]PR
	errs map[string]error
}

func (f *fakeLister) ListPRs(_ context.Context, repo string) ([]PR, error) {
	if err := f.errs[repo]; err != nil {
		return nil, err
	}
	return f.prs[repo], nil
}

func TestSyncCreatesInboxAndSuggestion(t *testing.T) {
	st := newTestStore(t)
	_ = st.CreateThread(store.Thread{ID: "t1", ProjectKey: "praktor", Title: "Idea Threads", Status: "active"})
	lister := &fakeLister{prs: map[string][]PR{"Meta-Psy/praktor": {
		{Number: 30, Title: "feat: idea threads sync", HeadRef: "feature/idea-threads-2",
			URL: "http://x/30", State: "open", CreatedAt: "2026-07-17T09:00:00Z"},
		{Number: 31, Title: "chore: deps", HeadRef: "chore/deps",
			URL: "http://x/31", State: "closed", MergedAt: "2026-07-01T00:00:00Z"},
	}}}
	sy := NewSyncer(lister, st, map[string]string{"praktor": "Meta-Psy/praktor"}, 0, nil)

	stats, err := sy.SyncOnce(context.Background())
	if err != nil || stats.Added != 2 || stats.Updated != 0 {
		t.Fatalf("stats = %+v, %v", stats, err)
	}
	// эвристика попала → предложение с thread_id, confirmed=0
	p30, _ := st.GetPointByPR("Meta-Psy/praktor", 30)
	if p30 == nil || p30.ThreadID != "t1" || p30.Confirmed || p30.Kind != "pr" || p30.PRState != "open" {
		t.Errorf("p30 = %+v", p30)
	}
	// промах → входящие без нити
	p31, _ := st.GetPointByPR("Meta-Psy/praktor", 31)
	if p31 == nil || p31.ThreadID != "" || p31.Confirmed || p31.PRState != "merged" {
		t.Errorf("p31 = %+v", p31)
	}
	inbox, _ := st.ListInboxPoints()
	if len(inbox) != 2 {
		t.Errorf("inbox = %d, want 2", len(inbox))
	}
}

func TestSyncUpdatesExistingAndIdempotent(t *testing.T) {
	st := newTestStore(t)
	_ = st.CreatePoint(store.ThreadPoint{ID: "p1", Kind: "pr", Title: "x",
		Repo: "o/r", PRNumber: 5, PRState: "open", Confirmed: true})
	lister := &fakeLister{prs: map[string][]PR{"o/r": {
		{Number: 5, Title: "x", State: "closed", MergedAt: "2026-07-17T10:00:00Z"},
	}}}
	var published int
	sy := NewSyncer(lister, st, map[string]string{"praktor": "o/r"}, 0, func() { published++ })

	stats, err := sy.SyncOnce(context.Background())
	if err != nil || stats.Updated != 1 || stats.Added != 0 {
		t.Fatalf("first = %+v, %v", stats, err)
	}
	got, _ := st.GetPoint("p1")
	if got.PRState != "merged" || got.EventDate != "2026-07-17T10:00:00Z" || !got.Confirmed {
		t.Errorf("after sync = %+v", got)
	}
	if published != 1 {
		t.Errorf("published = %d, want 1", published)
	}
	// повторный проход — ничего не меняет и не шумит событиями
	stats2, err := sy.SyncOnce(context.Background())
	if err != nil || stats2.Added+stats2.Updated != 0 || published != 1 {
		t.Fatalf("second = %+v, %v, published=%d", stats2, err, published)
	}
	// meta проставлена
	if v, _ := st.GetThreadsMeta("last_sync_success"); v == "" {
		t.Error("last_sync_success not set")
	}
}

func TestSyncPartialFailure(t *testing.T) {
	st := newTestStore(t)
	lister := &fakeLister{
		prs:  map[string][]PR{"o/good": {{Number: 1, Title: "t", State: "open", CreatedAt: "2026-01-01T00:00:00Z"}}},
		errs: map[string]error{"o/bad": errors.New("boom")},
	}
	sy := NewSyncer(lister, st, map[string]string{"a": "o/good", "b": "o/bad"}, 0, nil)

	stats, err := sy.SyncOnce(context.Background())
	if err != nil {
		t.Fatalf("partial failure must not be an error: %v", err)
	}
	if stats.Added != 1 || len(stats.Errors) != 1 {
		t.Fatalf("stats = %+v", stats)
	}
	// при частичном сбое timestamp успеха не обновляется
	if v, _ := st.GetThreadsMeta("last_sync_success"); v != "" {
		t.Errorf("meta = %q, want empty", v)
	}
	if s := sy.Status(); s.LastError == "" {
		t.Error("Status().LastError empty")
	}
}

func TestSyncAllReposFailed(t *testing.T) {
	st := newTestStore(t)
	lister := &fakeLister{errs: map[string]error{"o/bad": errors.New("boom")}}
	sy := NewSyncer(lister, st, map[string]string{"a": "o/bad"}, 0, nil)
	if _, err := sy.SyncOnce(context.Background()); err == nil {
		t.Fatal("want error when all repos fail")
	}
}
