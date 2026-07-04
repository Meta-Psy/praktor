package agent

import (
	"context"
	"testing"

	"github.com/mtzanidakis/praktor/internal/config"
	"github.com/mtzanidakis/praktor/internal/registry"
	"github.com/mtzanidakis/praktor/internal/store"
)

// HandleMessage must persist the incoming message and enqueue it with its
// meta intact — the web chat endpoint relies on both (spec §5, §9).
func TestHandleMessagePersistsAndQueuesWebMessage(t *testing.T) {
	st, err := store.New(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })

	reg := registry.New(st, map[string]config.AgentDefinition{
		"coder": {Description: "Engineer"},
	}, config.DefaultsConfig{}, t.TempDir())
	if err := reg.Sync(); err != nil {
		t.Fatal(err)
	}

	o := &Orchestrator{
		store:          st,
		registry:       reg,
		sessions:       NewSessionTracker(),
		queues:         map[string]*AgentQueue{},
		lastMeta:       map[string]map[string]string{},
		pendingMeta:    map[string]map[string]string{},
		pendingMsgID:   map[string]string{},
		pendingReplies: map[string]chan captureResult{},
	}

	// Hold the queue lock so the background processQueue goroutine bails out
	// before touching Docker.
	q := o.getQueue("coder")
	if !q.TryLock() {
		t.Fatal("queue must be lockable")
	}
	defer q.Unlock()

	meta := map[string]string{"sender": "user:web", "origin": "web"}
	if err := o.HandleMessage(context.Background(), "coder", "привет из веба", meta); err != nil {
		t.Fatal(err)
	}

	msgs, err := st.GetMessages("coder", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(msgs) != 1 {
		t.Fatalf("messages = %d, want 1", len(msgs))
	}
	if msgs[0].Sender != "user:web" || msgs[0].Content != "привет из веба" {
		t.Errorf("saved message = %+v", msgs[0])
	}

	queued, ok := q.Dequeue()
	if !ok {
		t.Fatal("message must be enqueued")
	}
	if queued.Text != "привет из веба" || queued.Meta["origin"] != "web" {
		t.Errorf("queued = %+v", queued)
	}
}
