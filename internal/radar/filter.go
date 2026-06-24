package radar

import "time"

// keepRepo reports whether a search result passes the radar's quality bar:
// not archived, not a fork, at least minStars, and pushed within freshnessDays.
func keepRepo(r RadarRepo, minStars, freshnessDays int, now time.Time) bool {
	if r.Archived || r.Fork || r.Stars < minStars {
		return false
	}
	if r.PushedAt == "" {
		return false
	}
	t, err := time.Parse(time.RFC3339, r.PushedAt)
	if err != nil {
		return false
	}
	return now.Sub(t) <= time.Duration(freshnessDays)*24*time.Hour
}
