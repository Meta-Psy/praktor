package web

import (
	"net/http"

	"github.com/mtzanidakis/praktor/internal/store"
)

type intelSnapshot struct {
	CapturedAt int64  `json:"captured_at"`
	Payload    string `json:"payload,omitempty"`
	ChangeNote string `json:"change_note,omitempty"`
	OK         bool   `json:"ok"`
	Error      string `json:"error,omitempty"`
}

type intelSource struct {
	Key     string          `json:"key"`
	Project string          `json:"project"`
	Latest  *intelSnapshot  `json:"latest"`
	History []intelSnapshot `json:"history"`
}

type intelResponse struct {
	Sources []intelSource `json:"sources"`
}

// handleIntel is GET /api/intel — read-only per-source intel feed. Snapshots are
// grouped by source_key; within each source they are newest-first, so the first
// is the latest.
func (s *Server) handleIntel(w http.ResponseWriter, r *http.Request) {
	rows, err := s.store.ListIntelSnapshots() // newest-first overall
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	order := []string{}
	byKey := map[string]*intelSource{}
	for _, row := range rows {
		src, ok := byKey[row.SourceKey]
		if !ok {
			src = &intelSource{Key: row.SourceKey, Project: row.Project}
			byKey[row.SourceKey] = src
			order = append(order, row.SourceKey)
		}
		src.History = append(src.History, toIntelSnapshot(row))
	}
	resp := intelResponse{Sources: make([]intelSource, 0, len(order))}
	for _, k := range order {
		src := byKey[k]
		if len(src.History) > 0 {
			latest := src.History[0]
			src.Latest = &latest
		}
		resp.Sources = append(resp.Sources, *src)
	}
	jsonResponse(w, resp)
}

func toIntelSnapshot(row store.IntelSnapshot) intelSnapshot {
	return intelSnapshot{
		CapturedAt: row.CapturedAt, Payload: row.Payload, ChangeNote: row.ChangeNote,
		OK: row.OK, Error: row.Error,
	}
}
