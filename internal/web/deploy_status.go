package web

import (
	"sync"
	"time"
)

// deployRun is the in-memory status of one project's most recent deploy.
type deployRun struct {
	State      string    `json:"state"` // "" (never run) | "running" | "ok" | "failed"
	StartedAt  time.Time `json:"started_at,omitempty"`
	FinishedAt time.Time `json:"finished_at,omitempty"`
	Error      string    `json:"error,omitempty"`
}

// deployStore tracks at most one deploy per project key. Status is in-memory only
// (lost on restart); the TG audit remains the durable record of completion.
type deployStore struct {
	mu   sync.Mutex
	runs map[string]deployRun
}

func newDeployStore() *deployStore {
	return &deployStore{runs: make(map[string]deployRun)}
}

// tryStart atomically marks key running. It returns false if a deploy for key is
// already in progress (the caller should reject with 409).
func (d *deployStore) tryStart(key string) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.runs[key].State == "running" {
		return false
	}
	d.runs[key] = deployRun{State: "running", StartedAt: time.Now()}
	return true
}

// finish records the outcome of key's run.
func (d *deployStore) finish(key string, err error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	r := d.runs[key]
	r.FinishedAt = time.Now()
	if err != nil {
		r.State = "failed"
		r.Error = err.Error()
	} else {
		r.State = "ok"
		r.Error = ""
	}
	d.runs[key] = r
}

// snapshot returns a copy of key's current run state (zero value if never run).
func (d *deployStore) snapshot(key string) deployRun {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.runs[key]
}
