package web

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/mtzanidakis/praktor/internal/store"
)

type threadAPI struct {
	ID            string `json:"id"`
	ProjectKey    string `json:"project_key"`
	Title         string `json:"title"`
	Summary       string `json:"summary,omitempty"`
	Color         string `json:"color,omitempty"`
	Status        string `json:"status"`
	ParentPointID string `json:"parent_point_id,omitempty"`
	CreatedAt     string `json:"created_at,omitempty"`
	EndedAt       string `json:"ended_at,omitempty"`
}

type pointAPI struct {
	ID        string `json:"id"`
	ThreadID  string `json:"thread_id,omitempty"`
	Kind      string `json:"kind"`
	Title     string `json:"title"`
	Summary   string `json:"summary,omitempty"`
	Repo      string `json:"repo,omitempty"`
	PRNumber  int64  `json:"pr_number,omitempty"`
	PRUrl     string `json:"pr_url,omitempty"`
	PRState   string `json:"pr_state,omitempty"`
	EventDate string `json:"event_date,omitempty"`
	Position  int64  `json:"position"`
	Confirmed bool   `json:"confirmed"`
}

type ideaAPI struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	Summary   string   `json:"summary,omitempty"`
	Status    string   `json:"status"`
	ThreadIDs []string `json:"thread_ids"`
}

type threadsMapResponse struct {
	Threads []threadAPI `json:"threads"`
	Points  []pointAPI  `json:"points"`
	Ideas   []ideaAPI   `json:"ideas"`
}

func toThreadAPI(t store.Thread) threadAPI {
	return threadAPI{ID: t.ID, ProjectKey: t.ProjectKey, Title: t.Title, Summary: t.Summary,
		Color: t.Color, Status: t.Status, ParentPointID: t.ParentPointID,
		CreatedAt: t.CreatedAt, EndedAt: t.EndedAt}
}

func toPointAPI(p store.ThreadPoint) pointAPI {
	return pointAPI{ID: p.ID, ThreadID: p.ThreadID, Kind: p.Kind, Title: p.Title,
		Summary: p.Summary, Repo: p.Repo, PRNumber: p.PRNumber, PRUrl: p.PRUrl,
		PRState: p.PRState, EventDate: p.EventDate, Position: p.Position, Confirmed: p.Confirmed}
}

func toIdeaAPI(i store.Idea) ideaAPI {
	return ideaAPI{ID: i.ID, Title: i.Title, Summary: i.Summary, Status: i.Status, ThreadIDs: i.ThreadIDs}
}

func validThreadStatus(s string) bool { return s == "active" || s == "done" || s == "dropped" }

// handleThreadsMap is GET /api/threads/map — the whole mega-map in one JSON.
func (s *Server) handleThreadsMap(w http.ResponseWriter, r *http.Request) {
	threads, err := s.store.ListThreads()
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	points, err := s.store.ListPoints()
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	ideas, err := s.store.ListIdeas()
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	resp := threadsMapResponse{Threads: []threadAPI{}, Points: []pointAPI{}, Ideas: []ideaAPI{}}
	for _, t := range threads {
		resp.Threads = append(resp.Threads, toThreadAPI(t))
	}
	for _, p := range points {
		resp.Points = append(resp.Points, toPointAPI(p))
	}
	for _, i := range ideas {
		resp.Ideas = append(resp.Ideas, toIdeaAPI(i))
	}
	jsonResponse(w, resp)
}

// createThread is POST /api/threads.
func (s *Server) createThread(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ProjectKey    string `json:"project_key"`
		Title         string `json:"title"`
		Summary       string `json:"summary"`
		Color         string `json:"color"`
		ParentPointID string `json:"parent_point_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if body.ProjectKey == "" || body.Title == "" {
		jsonError(w, "project_key and title are required", http.StatusBadRequest)
		return
	}
	t := store.Thread{ID: uuid.New().String(), ProjectKey: body.ProjectKey, Title: body.Title,
		Summary: body.Summary, Color: body.Color, Status: "active", ParentPointID: body.ParentPointID}
	if err := s.store.CreateThread(t); err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, toThreadAPI(t))
}

// updateThread is PUT /api/threads/{id}. status=done проставляет ended_at.
func (s *Server) updateThread(w http.ResponseWriter, r *http.Request) {
	existing, err := s.store.GetThread(r.PathValue("id"))
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if existing == nil {
		jsonError(w, "thread not found", http.StatusNotFound)
		return
	}
	var body struct {
		Title   string `json:"title"`
		Summary *string `json:"summary"`
		Color   string `json:"color"`
		Status  string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if body.Title != "" {
		existing.Title = body.Title
	}
	if body.Summary != nil {
		existing.Summary = *body.Summary
	}
	if body.Color != "" {
		existing.Color = body.Color
	}
	if body.Status != "" {
		if !validThreadStatus(body.Status) {
			jsonError(w, "status must be active|done|dropped", http.StatusBadRequest)
			return
		}
		if body.Status != "active" && existing.Status == "active" {
			existing.EndedAt = time.Now().UTC().Format("2006-01-02")
		}
		if body.Status == "active" {
			existing.EndedAt = ""
		}
		existing.Status = body.Status
	}
	if err := s.store.UpdateThread(*existing); err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, toThreadAPI(*existing))
}

// deleteThread is DELETE /api/threads/{id}.
func (s *Server) deleteThread(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteThread(r.PathValue("id")); err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, map[string]string{"status": "deleted"})
}

// createPlannedPoint is POST /api/threads/{id}/points — planned-точки только.
func (s *Server) createPlannedPoint(w http.ResponseWriter, r *http.Request) {
	threadID := r.PathValue("id")
	th, err := s.store.GetThread(threadID)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if th == nil {
		jsonError(w, "thread not found", http.StatusNotFound)
		return
	}
	var body struct {
		Title    string `json:"title"`
		Summary  string `json:"summary"`
		Position int64  `json:"position"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if body.Title == "" {
		jsonError(w, "title is required", http.StatusBadRequest)
		return
	}
	p := store.ThreadPoint{ID: uuid.New().String(), ThreadID: threadID, Kind: "planned",
		Title: body.Title, Summary: body.Summary, Position: body.Position, Confirmed: true}
	if err := s.store.CreatePoint(p); err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, toPointAPI(p))
}

// updatePoint is PUT /api/points/{id}.
func (s *Server) updatePoint(w http.ResponseWriter, r *http.Request) {
	existing, err := s.store.GetPoint(r.PathValue("id"))
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if existing == nil {
		jsonError(w, "point not found", http.StatusNotFound)
		return
	}
	var body struct {
		Title    string `json:"title"`
		Summary  *string `json:"summary"`
		Position *int64 `json:"position"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if body.Title != "" {
		existing.Title = body.Title
	}
	if body.Summary != nil {
		existing.Summary = *body.Summary
	}
	if body.Position != nil {
		existing.Position = *body.Position
	}
	if err := s.store.UpdatePoint(*existing); err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, toPointAPI(*existing))
}

// deletePoint is DELETE /api/points/{id}.
func (s *Server) deletePoint(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeletePoint(r.PathValue("id")); err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, map[string]string{"status": "deleted"})
}

// threadsInbox is GET /api/threads/inbox — неподтверждённые точки.
func (s *Server) threadsInbox(w http.ResponseWriter, r *http.Request) {
	points, err := s.store.ListInboxPoints()
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	out := []pointAPI{}
	for _, p := range points {
		out = append(out, toPointAPI(p))
	}
	jsonResponse(w, out)
}

// confirmPoint is POST /api/points/{id}/confirm.
func (s *Server) confirmPoint(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body struct {
		ThreadID           string `json:"thread_id"`
		MaterializePointID string `json:"materialize_point_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if body.ThreadID == "" {
		jsonError(w, "thread_id is required", http.StatusBadRequest)
		return
	}
	th, err := s.store.GetThread(body.ThreadID)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if th == nil {
		jsonError(w, "thread not found", http.StatusNotFound)
		return
	}
	if body.MaterializePointID != "" {
		err = s.store.MaterializePoint(id, body.MaterializePointID, body.ThreadID)
	} else {
		err = s.store.ConfirmPoint(id, body.ThreadID)
	}
	if err != nil {
		code := http.StatusInternalServerError
		if errors.Is(err, store.ErrNotFound) {
			code = http.StatusNotFound
		}
		jsonError(w, err.Error(), code)
		return
	}
	jsonResponse(w, map[string]string{"status": "confirmed"})
}

// createThreadNote is POST /api/threads/{id}/notes.
func (s *Server) createThreadNote(w http.ResponseWriter, r *http.Request) {
	threadID := r.PathValue("id")
	th, err := s.store.GetThread(threadID)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if th == nil {
		jsonError(w, "thread not found", http.StatusNotFound)
		return
	}
	var body struct {
		Body   string `json:"body"`
		Source string `json:"source"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if body.Body == "" {
		jsonError(w, "body is required", http.StatusBadRequest)
		return
	}
	if body.Source == "" {
		body.Source = "manual"
	}
	n := store.ThreadNote{ID: uuid.New().String(), ThreadID: threadID,
		Body: body.Body, Source: body.Source}
	if err := s.store.CreateNote(n); err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, map[string]string{"id": n.ID, "status": "created"})
}

// createIdea is POST /api/ideas.
func (s *Server) createIdea(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Title     string   `json:"title"`
		Summary   string   `json:"summary"`
		ThreadIDs []string `json:"thread_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if body.Title == "" {
		jsonError(w, "title is required", http.StatusBadRequest)
		return
	}
	if body.ThreadIDs == nil {
		body.ThreadIDs = []string{}
	}
	i := store.Idea{ID: uuid.New().String(), Title: body.Title, Summary: body.Summary, Status: "active"}
	if err := s.store.CreateIdea(i); err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if len(body.ThreadIDs) > 0 {
		if err := s.store.SetIdeaThreads(i.ID, body.ThreadIDs); err != nil {
			jsonError(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}
	i.ThreadIDs = body.ThreadIDs
	jsonResponse(w, toIdeaAPI(i))
}

// updateIdea is PUT /api/ideas/{id} — load-then-merge partial update.
func (s *Server) updateIdea(w http.ResponseWriter, r *http.Request) {
	existing, err := s.store.GetIdea(r.PathValue("id"))
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if existing == nil {
		jsonError(w, "idea not found", http.StatusNotFound)
		return
	}
	var body struct {
		Title     string    `json:"title"`
		Summary   *string   `json:"summary"`
		Status    string    `json:"status"`
		ThreadIDs *[]string `json:"thread_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if body.Title != "" {
		existing.Title = body.Title
	}
	if body.Summary != nil {
		existing.Summary = *body.Summary
	}
	if body.Status != "" {
		if !validThreadStatus(body.Status) {
			jsonError(w, "status must be active|done|dropped", http.StatusBadRequest)
			return
		}
		existing.Status = body.Status
	}
	if err := s.store.UpdateIdea(*existing); err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if body.ThreadIDs != nil {
		if err := s.store.SetIdeaThreads(existing.ID, *body.ThreadIDs); err != nil {
			jsonError(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}
	jsonResponse(w, map[string]string{"status": "updated"})
}

// deleteIdea is DELETE /api/ideas/{id}.
func (s *Server) deleteIdea(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteIdea(r.PathValue("id")); err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, map[string]string{"status": "deleted"})
}
