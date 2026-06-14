package intake

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestAssemble(t *testing.T) {
	now := time.Date(2026, 6, 14, 9, 30, 0, 0, time.UTC)
	it := Assemble("web", "fix typo in pdai readme", []string{"items/x/photo.jpg"}, "pdai", now, "ab12")
	if it.ID != "20260614T093000Z-ab12" {
		t.Fatalf("id = %q", it.ID)
	}
	if it.Source != "web" || it.RawText != "fix typo in pdai readme" || it.TargetProject != "pdai" {
		t.Fatalf("fields: %+v", it)
	}
	if it.Status != StatusQueued {
		t.Fatalf("status = %q, want queued", it.Status)
	}
	if len(it.Media) != 1 || it.Media[0] != "items/x/photo.jpg" {
		t.Fatalf("media = %v", it.Media)
	}
	if it.CreatedAt != "2026-06-14T09:30:00Z" || it.UpdatedAt != it.CreatedAt {
		t.Fatalf("timestamps: created=%q updated=%q", it.CreatedAt, it.UpdatedAt)
	}
}

func TestS3Transitions(t *testing.T) {
	cases := []struct {
		from, to string
		want     bool
	}{
		{StatusNeedsDesign, StatusAwaitingApproval, true},   // producer прикрепил план
		{StatusAwaitingApproval, StatusApproved, true},      // approve
		{StatusAwaitingApproval, StatusNeedsDesign, true},   // reject
		{StatusApproved, StatusInProgress, true},            // executor взял
		{StatusApproved, StatusDone, false},                 // только через in_progress
		{StatusQueued, StatusApproved, false},               // нельзя одобрить незатриаженное
	}
	for _, c := range cases {
		if got := ValidTransition(c.from, c.to); got != c.want {
			t.Errorf("ValidTransition(%q,%q) = %v, want %v", c.from, c.to, got, c.want)
		}
	}
}

func TestItemPlanFields(t *testing.T) {
	it := Item{ID: "x", PlanFile: "items/x.plan.md", ReviewNote: "переделай раздел A"}
	b, err := json.Marshal(it)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"plan_file":"items/x.plan.md"`) {
		t.Fatalf("plan_file not serialized: %s", b)
	}
	if !strings.Contains(string(b), `"review_note":"переделай раздел A"`) {
		t.Fatalf("review_note not serialized: %s", b)
	}
}

func TestValidTransition(t *testing.T) {
	cases := []struct {
		from, to string
		want     bool
	}{
		{StatusQueued, StatusTriaged, true},
		{StatusTriaged, StatusInProgress, true},
		{StatusInProgress, StatusDone, true},
		{StatusTriaged, StatusAwaitingApproval, true},
		{StatusTriaged, StatusNeedsDesign, true},
		{StatusQueued, StatusNeedsClarification, true},
		{StatusQueued, StatusError, true},
		{StatusDone, StatusQueued, false},
		{StatusDone, StatusInProgress, false},
		{"bogus", StatusDone, false},
	}
	for _, c := range cases {
		if got := ValidTransition(c.from, c.to); got != c.want {
			t.Errorf("ValidTransition(%q,%q) = %v, want %v", c.from, c.to, got, c.want)
		}
	}
}
