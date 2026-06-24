package radar

import (
	"testing"
	"time"
)

func TestKeepRepo(t *testing.T) {
	now := time.Date(2026, 6, 24, 12, 0, 0, 0, time.UTC)
	fresh := now.Add(-5 * 24 * time.Hour).Format(time.RFC3339)
	stale := now.Add(-90 * 24 * time.Hour).Format(time.RFC3339)

	cases := []struct {
		name string
		r    RadarRepo
		want bool
	}{
		{"good", RadarRepo{Stars: 50, PushedAt: fresh}, true},
		{"too few stars", RadarRepo{Stars: 3, PushedAt: fresh}, false},
		{"archived", RadarRepo{Stars: 50, PushedAt: fresh, Archived: true}, false},
		{"fork", RadarRepo{Stars: 50, PushedAt: fresh, Fork: true}, false},
		{"stale push", RadarRepo{Stars: 50, PushedAt: stale}, false},
		{"empty push", RadarRepo{Stars: 50, PushedAt: ""}, false},
		{"bad push", RadarRepo{Stars: 50, PushedAt: "not-a-date"}, false},
	}
	for _, c := range cases {
		if got := keepRepo(c.r, 10, 30, now); got != c.want {
			t.Errorf("%s: keepRepo = %v, want %v", c.name, got, c.want)
		}
	}
}
