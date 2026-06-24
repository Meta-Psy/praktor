// Package radar discovers new Claude-ecosystem tooling on GitHub (topic search)
// and surfaces it read-only in Mission Control (S5). It is isolated from the web
// and agent packages via the RepoSearcher / RadarStore / MessageHandler interfaces.
package radar

import (
	"context"

	"github.com/mtzanidakis/praktor/internal/store"
)

// RadarRepo is a single GitHub search result (transient DTO, pre-persistence).
type RadarRepo struct {
	FullName    string
	Name        string
	Description string
	HTMLURL     string
	Stars       int
	PushedAt    string // RFC3339 from GitHub
	Archived    bool
	Fork        bool
}

// RepoSearcher runs a GitHub repository search. Satisfied by *web.GitHubClient.
type RepoSearcher interface {
	SearchRepos(ctx context.Context, query string) ([]RadarRepo, error)
}

// RadarStore is the persistence the collector needs. Satisfied by *store.Store.
type RadarStore interface {
	UpsertRadarItem(item store.RadarItem) error
	ListRadarItems() ([]store.RadarItem, error)
	GetRadarMeta(key string) (string, error)
	SetRadarMeta(key, value string) error
}

// MessageHandler dispatches a prompt to an agent. Satisfied by *agent.Orchestrator.
type MessageHandler interface {
	HandleMessage(ctx context.Context, agentID, text string, meta map[string]string) error
}
