// Package intel runs the S6 per-project periodic intel collector: on a per-source
// schedule it asks an agent to scrape a pre-described source, stores a structured
// snapshot with an agent-written change note, and surfaces history read-only in
// Mission Control. It is isolated from the agent and store packages via the
// SnapshotStore / AgentRunner interfaces.
package intel

import (
	"context"

	"github.com/mtzanidakis/praktor/internal/store"
)

// Snapshot is the parsed agent response (transient DTO, pre-persistence).
type Snapshot struct {
	Summary    string           `json:"summary"`
	Metrics    map[string]any   `json:"metrics"`
	Items      []map[string]any `json:"items"`
	ChangeNote string           `json:"change_note"`
}

// SnapshotStore is the persistence the collector needs. Satisfied by *store.Store.
type SnapshotStore interface {
	InsertIntelSnapshot(snap store.IntelSnapshot) error
	LatestSnapshot(sourceKey string) (*store.IntelSnapshot, error)
}

// AgentRunner dispatches a prompt to an agent and returns its text response
// synchronously (no Telegram delivery). Satisfied by *agent.Orchestrator.
type AgentRunner interface {
	RunCapture(ctx context.Context, agentID, prompt string) (string, error)
}
