package web

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/mtzanidakis/praktor/internal/intake"
)

// handleIntakeApprove is POST /api/intake/{id}/approve — awaiting-approval → approved.
// Approve is a status flip only: a local agent picks up approved items and executes
// them (COMPLEX work is never auto-implemented server-side).
func (s *Server) handleIntakeApprove(w http.ResponseWriter, r *http.Request) {
	s.transitionItem(w, r, intake.StatusApproved, "")
}

// handleIntakeReject is POST /api/intake/{id}/reject — awaiting-approval → needs-design,
// recording the reviewer's reason so the plan can be rewritten.
func (s *Server) handleIntakeReject(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Reason string `json:"reason"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	s.transitionItem(w, r, intake.StatusNeedsDesign, body.Reason)
}

// transitionItem reads an item + its SHA, validates the move against the status
// machine, writes the new status back with that SHA, and audits to Telegram.
func (s *Server) transitionItem(w http.ResponseWriter, r *http.Request, to, reason string) {
	if s.intake == nil || s.intakeQueue == nil {
		jsonError(w, "intake not configured", http.StatusServiceUnavailable)
		return
	}
	id := r.PathValue("id")
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	it, sha, err := s.intake.getItem(ctx, id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			jsonError(w, "item not found", http.StatusNotFound)
			return
		}
		jsonError(w, "upstream error: "+err.Error(), http.StatusBadGateway)
		return
	}
	if !intake.ValidTransition(it.Status, to) {
		jsonError(w, "invalid transition from "+it.Status+" to "+to, http.StatusConflict)
		return
	}
	it.Status = to
	it.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	if reason != "" {
		it.ReviewNote = reason
	}
	detail := to + " " + id
	if err := s.intakeQueue.Update(ctx, it, sha); err != nil {
		// A stale SHA (concurrent edit) or upstream failure lands here; the UI
		// refetches the list on any non-2xx, so it self-corrects.
		s.audit(false, detail+": "+err.Error())
		jsonError(w, err.Error(), http.StatusBadGateway)
		return
	}
	s.audit(true, detail)
	jsonResponse(w, map[string]string{"status": it.Status})
}
