package web

import (
	"errors"
	"sync"
	"sync/atomic"
	"testing"
)

func TestTryStartGuardsRunning(t *testing.T) {
	d := newDeployStore()
	if !d.tryStart("pdai") {
		t.Fatal("first tryStart should succeed")
	}
	if d.tryStart("pdai") {
		t.Fatal("second tryStart must fail while running")
	}
	if got := d.snapshot("pdai").State; got != "running" {
		t.Fatalf("state = %q, want running", got)
	}
}

func TestFinishSetsOutcome(t *testing.T) {
	d := newDeployStore()
	d.tryStart("a")
	d.finish("a", nil)
	if got := d.snapshot("a").State; got != "ok" {
		t.Fatalf("state = %q, want ok", got)
	}
	if d.snapshot("a").FinishedAt.IsZero() {
		t.Fatal("FinishedAt must be set")
	}
	// after finishing, a new run can start
	if !d.tryStart("a") {
		t.Fatal("tryStart should succeed after finish")
	}

	d.tryStart("b")
	d.finish("b", errors.New("boom"))
	snap := d.snapshot("b")
	if snap.State != "failed" || snap.Error != "boom" {
		t.Fatalf("got state=%q err=%q, want failed/boom", snap.State, snap.Error)
	}
}

func TestTryStartConcurrentSingleWinner(t *testing.T) {
	d := newDeployStore()
	var wins int64
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if d.tryStart("x") {
				atomic.AddInt64(&wins, 1)
			}
		}()
	}
	wg.Wait()
	if wins != 1 {
		t.Fatalf("exactly one tryStart should win, got %d", wins)
	}
}

func TestSnapshotNeverRunIsZero(t *testing.T) {
	d := newDeployStore()
	if got := d.snapshot("nope").State; got != "" {
		t.Fatalf("never-run state = %q, want empty", got)
	}
}
