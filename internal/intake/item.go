// Package intake captures device-originated tasks for Claude and queues them
// for triage. It is transport-agnostic: web and Telegram adapters both produce
// the same Item, persisted to a GitHub queue repo.
package intake

import "time"

// Status values for an intake Item through its lifecycle.
const (
	StatusQueued             = "queued"
	StatusTriaged            = "triaged"
	StatusInProgress         = "in_progress"
	StatusDone               = "done"
	StatusAwaitingApproval   = "awaiting-approval"
	StatusNeedsDesign        = "needs-design"
	StatusApproved           = "approved"
	StatusNeedsClarification = "needs-clarification"
	StatusError              = "error"
)

// Route values assigned by triage (reuses Auditor taxonomy).
const (
	RouteTrivial  = "trivial"  // TRIVIAL → auto-implement
	RouteStandard = "standard" // STANDARD → plan for approval
	RouteComplex  = "complex"  // COMPLEX → S3 / needs-design, never auto
)

// Item is one captured task.
type Item struct {
	ID            string   `json:"id"`
	Source        string   `json:"source"` // web|telegram
	RawText       string   `json:"raw_text"`
	Media         []string `json:"media,omitempty"`
	TargetProject string   `json:"target_project,omitempty"`
	Route         string   `json:"route,omitempty"`
	Status        string   `json:"status"`
	PlanFile      string   `json:"plan_file,omitempty"`   // "items/<id>.plan.md", set by producer
	ReviewNote    string   `json:"review_note,omitempty"` // reject reason from MC
	CreatedAt     string   `json:"created_at"`
	UpdatedAt     string   `json:"updated_at"`
}

// Assemble builds a queued Item. idSuffix is supplied by the caller (random in
// production, fixed in tests) so the function stays pure and testable.
func Assemble(source, rawText string, media []string, targetProject string, now time.Time, idSuffix string) Item {
	ts := now.UTC()
	iso := ts.Format(time.RFC3339)
	return Item{
		ID:            ts.Format("20060102T150405Z") + "-" + idSuffix,
		Source:        source,
		RawText:       rawText,
		Media:         media,
		TargetProject: targetProject,
		Status:        StatusQueued,
		CreatedAt:     iso,
		UpdatedAt:     iso,
	}
}

// transitions maps each status to the statuses it may move to.
var transitions = map[string][]string{
	StatusQueued:           {StatusTriaged, StatusNeedsClarification, StatusError},
	StatusTriaged:          {StatusInProgress, StatusAwaitingApproval, StatusNeedsDesign, StatusError},
	StatusInProgress:       {StatusDone, StatusError},
	StatusAwaitingApproval: {StatusInProgress, StatusDone, StatusApproved, StatusNeedsDesign, StatusError},
	StatusNeedsDesign:      {StatusInProgress, StatusAwaitingApproval, StatusError},
	StatusApproved:         {StatusInProgress, StatusError},
}

// ValidTransition reports whether status may move from → to.
func ValidTransition(from, to string) bool {
	for _, allowed := range transitions[from] {
		if allowed == to {
			return true
		}
	}
	return false
}
