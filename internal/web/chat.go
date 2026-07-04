package web

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
)

// sendAgentMessage handles POST /api/agents/definitions/{id}/message — the
// web chat (spec §5). The message goes through the same orchestrator queue as
// Telegram messages: saved to `messages`, session continued, container
// auto-started. meta origin=web keeps the reply out of Telegram; the reply
// reaches the UI via the existing `type=message` WebSocket event.
func (s *Server) sendAgentMessage(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	var body struct {
		Text string `json:"text"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	text := strings.TrimSpace(body.Text)
	if text == "" {
		jsonError(w, "text is required", http.StatusBadRequest)
		return
	}

	a, err := s.store.GetAgent(id)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if a == nil {
		jsonError(w, "agent not found", http.StatusNotFound)
		return
	}

	meta := map[string]string{
		"sender": "user:web",
		"origin": "web",
	}
	// Background context: HandleMessage queues work that outlives this HTTP
	// request (container start, Claude query) — the request context would
	// cancel it as soon as the response is written.
	if err := s.chat.HandleMessage(context.Background(), id, text, meta); err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, map[string]string{"status": "queued"})
}

// abortAgent handles POST /api/agents/definitions/{id}/abort — cancels the
// active run and drains the queue (web analogue of the /stop Telegram
// command; the container keeps running).
func (s *Server) abortAgent(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	a, err := s.store.GetAgent(id)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if a == nil {
		jsonError(w, "agent not found", http.StatusNotFound)
		return
	}
	if err := s.chat.AbortSession(r.Context(), id); err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, map[string]string{"status": "aborted"})
}
