package threads

import (
	"testing"

	"github.com/mtzanidakis/praktor/internal/store"
)

func TestSlugify(t *testing.T) {
	cases := map[string]string{
		"Feature: Idea Threads!": "feature-idea-threads",
		"Нити идей":              "нити-идей",
		"  UX__redesign 2 ":      "ux-redesign-2",
		"---":                    "",
	}
	for in, want := range cases {
		if got := slugify(in); got != want {
			t.Errorf("slugify(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestPRStateAndEventDate(t *testing.T) {
	merged := PR{State: "closed", MergedAt: "2026-07-17T10:00:00Z", ClosedAt: "2026-07-17T10:00:00Z", CreatedAt: "2026-07-16T09:00:00Z"}
	if merged.PRState() != "merged" || merged.EventDate() != "2026-07-17T10:00:00Z" {
		t.Errorf("merged: %s / %s", merged.PRState(), merged.EventDate())
	}
	closed := PR{State: "closed", ClosedAt: "2026-07-17T11:00:00Z", CreatedAt: "2026-07-16T09:00:00Z"}
	if closed.PRState() != "closed" || closed.EventDate() != "2026-07-17T11:00:00Z" {
		t.Errorf("closed: %s / %s", closed.PRState(), closed.EventDate())
	}
	open := PR{State: "open", CreatedAt: "2026-07-16T09:00:00Z"}
	if open.PRState() != "open" || open.EventDate() != "2026-07-16T09:00:00Z" {
		t.Errorf("open: %s / %s", open.PRState(), open.EventDate())
	}
}

func TestMatchThread(t *testing.T) {
	ths := []store.Thread{
		{ID: "t1", Title: "Idea Threads", Status: "active"},
		{ID: "t2", Title: "UI", Status: "active"},              // слаг короче 4 — не матчится
		{ID: "t3", Title: "Idea Threads Map", Status: "done"},  // не active — не матчится
		{ID: "t4", Title: "Idea Threads Sync", Status: "active"},
	}
	// матч по ветке; самый длинный слаг побеждает (t4, не t1)
	if got := MatchThread(ths, "feature/idea-threads-sync-2", "chore"); got != "t4" {
		t.Errorf("branch match = %q, want t4", got)
	}
	// матч по заголовку PR
	if got := MatchThread(ths, "fix/misc", "feat: Idea Threads store layer"); got != "t1" {
		t.Errorf("title match = %q, want t1", got)
	}
	// короткий слаг не матчится, даже если встречается
	if got := MatchThread(ths, "feature/ui-polish", "polish UI"); got != "" {
		t.Errorf("short slug = %q, want empty", got)
	}
	// завершённая нить не матчится
	if got := MatchThread([]store.Thread{ths[2]}, "feature/idea-threads-map", "x"); got != "" {
		t.Errorf("done thread = %q, want empty", got)
	}
	// промах
	if got := MatchThread(ths, "chore/deps", "bump deps"); got != "" {
		t.Errorf("miss = %q, want empty", got)
	}
}
