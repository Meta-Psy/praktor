package web

import (
	"net/http"
	"time"

	"github.com/mtzanidakis/praktor/internal/store"
)

type radarItem struct {
	FullName    string `json:"full_name"`
	Name        string `json:"name"`
	Description string `json:"description"`
	HTMLURL     string `json:"html_url"`
	Stars       int    `json:"stars"`
	Topic       string `json:"topic"`
	PushedAt    string `json:"pushed_at,omitempty"`
	FirstSeen   string `json:"first_seen"`
	IsNew       bool   `json:"is_new"`
}

type radarResponse struct {
	Items []radarItem `json:"items"`
}

// handleRadar is GET /api/radar — the read-only ecosystem radar feed. Items are
// read straight from the local store (cheap query); is_new flags items first
// seen within radarFreshnessDays.
func (s *Server) handleRadar(w http.ResponseWriter, r *http.Request) {
	rows, err := s.store.ListRadarItems()
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	cutoff := time.Now().UTC().Add(-time.Duration(s.radarFreshnessDays) * 24 * time.Hour)
	items := make([]radarItem, 0, len(rows))
	for _, it := range rows {
		items = append(items, radarItem{
			FullName: it.FullName, Name: it.Name, Description: it.Description,
			HTMLURL: it.HTMLURL, Stars: it.Stars, Topic: it.Topic, PushedAt: it.PushedAt,
			FirstSeen: it.FirstSeen, IsNew: isNewItem(it, cutoff),
		})
	}
	jsonResponse(w, radarResponse{Items: items})
}

// isNewItem reports whether the item was first seen after the cutoff.
func isNewItem(it store.RadarItem, cutoff time.Time) bool {
	t, err := time.Parse(time.RFC3339, it.FirstSeen)
	if err != nil {
		return false
	}
	return t.After(cutoff)
}
