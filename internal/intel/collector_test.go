package intel

import (
	"context"
	"errors"
	"testing"

	"github.com/mtzanidakis/praktor/internal/config"
	"github.com/mtzanidakis/praktor/internal/store"
)

type fakeRunner struct {
	resp      string
	err       error
	gotPrompt string
}

func (f *fakeRunner) RunCapture(_ context.Context, _, prompt string) (string, error) {
	f.gotPrompt = prompt
	return f.resp, f.err
}

type fakeStore struct {
	latest   *store.IntelSnapshot
	inserted []store.IntelSnapshot
}

func (f *fakeStore) InsertIntelSnapshot(snap store.IntelSnapshot) error {
	f.inserted = append(f.inserted, snap)
	return nil
}
func (f *fakeStore) LatestSnapshot(string) (*store.IntelSnapshot, error) { return f.latest, nil }

func TestCollectOnceSuccess(t *testing.T) {
	r := &fakeRunner{resp: "```json\n{\"summary\":\"42 centers\",\"change_note\":\"+2\"}\n```"}
	st := &fakeStore{}
	c := NewCollector(r, st, config.IntelConfig{})
	c.now = func() int64 { return 12345 }

	src := config.IntelSource{Key: "k", Project: "p", Instruction: "count", Agent: "general"}
	if err := c.collectOnce(context.Background(), src); err != nil {
		t.Fatalf("collectOnce: %v", err)
	}
	if len(st.inserted) != 1 {
		t.Fatalf("inserted = %d, want 1", len(st.inserted))
	}
	got := st.inserted[0]
	if !got.OK || got.SourceKey != "k" || got.Project != "p" || got.CapturedAt != 12345 {
		t.Errorf("snapshot = %+v", got)
	}
	if got.ChangeNote != "+2" {
		t.Errorf("change_note = %q, want +2", got.ChangeNote)
	}
}

func TestCollectOnceAgentError(t *testing.T) {
	r := &fakeRunner{err: errors.New("agent down")}
	st := &fakeStore{}
	c := NewCollector(r, st, config.IntelConfig{})
	c.now = func() int64 { return 7 }

	src := config.IntelSource{Key: "k", Project: "p", Instruction: "count", Agent: "general"}
	if err := c.collectOnce(context.Background(), src); err != nil {
		t.Fatalf("collectOnce should swallow agent error into a failure snapshot: %v", err)
	}
	if len(st.inserted) != 1 || st.inserted[0].OK {
		t.Fatalf("expected one ok=false snapshot, got %+v", st.inserted)
	}
	if st.inserted[0].Error == "" {
		t.Error("failure snapshot missing error text")
	}
}

func TestCollectOnceBadJSON(t *testing.T) {
	r := &fakeRunner{resp: "sorry, no data"}
	st := &fakeStore{}
	c := NewCollector(r, st, config.IntelConfig{})
	c.now = func() int64 { return 1 }

	src := config.IntelSource{Key: "k", Project: "p", Instruction: "count", Agent: "general"}
	_ = c.collectOnce(context.Background(), src)
	if len(st.inserted) != 1 || st.inserted[0].OK {
		t.Fatalf("expected one ok=false snapshot, got %+v", st.inserted)
	}
}
