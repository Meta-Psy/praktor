package web

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	pathpkg "path"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/mtzanidakis/praktor/internal/intake"
)

// intakeFetcher is the read surface the reader needs (mockable in tests).
type intakeFetcher interface {
	ListDir(ctx context.Context, repo, dir string) ([]string, error)
	GetFileContent(ctx context.Context, repo, path string) ([]byte, error)
	GetFileWithSHA(ctx context.Context, repo, path string) ([]byte, string, error)
}

type intakeReader struct {
	gh   intakeFetcher
	repo string
}

// list fetches all queue items, newest CreatedAt first.
func (r *intakeReader) list(ctx context.Context) ([]intake.Item, error) {
	paths, err := r.gh.ListDir(ctx, r.repo, "items")
	if err != nil {
		return nil, err
	}
	items := make([]intake.Item, 0, len(paths))
	for _, p := range paths {
		raw, err := r.gh.GetFileContent(ctx, r.repo, p)
		if err != nil {
			return nil, err
		}
		var it intake.Item
		if err := json.Unmarshal(raw, &it); err != nil {
			return nil, err
		}
		items = append(items, it)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].CreatedAt > items[j].CreatedAt })
	return items, nil
}

// getItem fetches one queue item plus its blob SHA, for status transitions.
func (r *intakeReader) getItem(ctx context.Context, id string) (intake.Item, string, error) {
	raw, sha, err := r.gh.GetFileWithSHA(ctx, r.repo, "items/"+id+".json")
	if err != nil {
		return intake.Item{}, "", err
	}
	var it intake.Item
	if err := json.Unmarshal(raw, &it); err != nil {
		return intake.Item{}, "", err
	}
	return it, sha, nil
}

type intakeResponse struct {
	Items      []intake.Item `json:"items"`
	Stale      bool          `json:"stale,omitempty"`
	FetchError string        `json:"fetch_error,omitempty"`
}

// intakeCache memoizes the last good list and serves it (flagged stale) on a
// failed refetch, so a transient outage doesn't blank the page.
type intakeCache struct {
	ttl  time.Duration
	now  func() time.Time
	mu   sync.Mutex
	at   time.Time
	last []intake.Item
	has  bool
}

func (c *intakeCache) get(read func(context.Context) ([]intake.Item, error)) intakeResponse {
	nowFn := time.Now
	if c.now != nil {
		nowFn = c.now
	}
	c.mu.Lock()
	if c.has && nowFn().Sub(c.at) < c.ttl {
		resp := intakeResponse{Items: c.last}
		c.mu.Unlock()
		return resp
	}
	c.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	items, err := read(ctx)
	if err != nil {
		c.mu.Lock()
		defer c.mu.Unlock()
		if c.has {
			return intakeResponse{Items: c.last, Stale: true, FetchError: err.Error()}
		}
		return intakeResponse{Stale: true, FetchError: err.Error()}
	}
	c.mu.Lock()
	c.last = items
	c.has = true
	c.at = nowFn()
	c.mu.Unlock()
	return intakeResponse{Items: items}
}

// handleIntakeList is GET /api/intake.
func (s *Server) handleIntakeList(w http.ResponseWriter, r *http.Request) {
	if s.intake == nil || s.intakeCache == nil {
		jsonError(w, "intake not configured", http.StatusServiceUnavailable)
		return
	}
	jsonResponse(w, s.intakeCache.get(s.intake.list))
}

// transcriber is the STT surface (satisfied by *speech.Client).
type transcriber interface {
	Transcribe(ctx context.Context, audio []byte, filename string) (string, error)
}

// intakeWriter is the queue write surface (satisfied by *intake.Queue).
type intakeWriter interface {
	Put(ctx context.Context, it intake.Item) error
	PutMedia(ctx context.Context, id, name string, data []byte) (string, error)
	Update(ctx context.Context, it intake.Item, sha string) error
}

const intakeMaxUpload = 12 << 20 // 12 MiB

// handleIntakeCreate is POST /api/intake (multipart: text, project, audio, photo).
func (s *Server) handleIntakeCreate(w http.ResponseWriter, r *http.Request) {
	if s.intakeQueue == nil {
		jsonError(w, "intake not configured", http.StatusServiceUnavailable)
		return
	}
	if err := r.ParseMultipartForm(intakeMaxUpload); err != nil {
		jsonError(w, "invalid multipart form", http.StatusBadRequest)
		return
	}
	text := strings.TrimSpace(r.FormValue("text"))
	project := strings.TrimSpace(r.FormValue("project"))

	// Optional voice → STT.
	if file, hdr, err := r.FormFile("audio"); err == nil {
		defer file.Close()
		audio, err := io.ReadAll(io.LimitReader(file, intakeMaxUpload))
		if err != nil {
			jsonError(w, "read audio failed", http.StatusBadRequest)
			return
		}
		if s.transcriber == nil {
			jsonError(w, "voice intake not configured (no STT key)", http.StatusServiceUnavailable)
			return
		}
		spoken, err := s.transcriber.Transcribe(r.Context(), audio, baseName(hdr.Filename, "voice.ogg"))
		if err != nil {
			jsonError(w, "transcription failed: "+err.Error(), http.StatusBadGateway)
			return
		}
		spoken = strings.TrimSpace(spoken)
		if text == "" {
			text = spoken
		} else if spoken != "" {
			text = text + "\n\n" + spoken
		}
	}

	if text == "" {
		jsonError(w, "text or audio is required", http.StatusBadRequest)
		return
	}

	now := time.Now()
	id := newIntakeID(now)
	var media []string
	if file, hdr, err := r.FormFile("photo"); err == nil {
		defer file.Close()
		data, err := io.ReadAll(io.LimitReader(file, intakeMaxUpload))
		if err != nil {
			jsonError(w, "read photo failed", http.StatusBadRequest)
			return
		}
		path, err := s.intakeQueue.PutMedia(r.Context(), id, baseName(hdr.Filename, "photo.jpg"), data)
		if err != nil {
			jsonError(w, "store photo failed: "+err.Error(), http.StatusBadGateway)
			return
		}
		media = append(media, path)
	}

	it := intake.Assemble("web", text, media, project, now, id[len(id)-4:])
	it.ID = id // keep the id used for media paths
	if err := s.intakeQueue.Put(r.Context(), it); err != nil {
		jsonError(w, "queue write failed: "+err.Error(), http.StatusBadGateway)
		return
	}
	// Set Content-Type before WriteHeader so the 201 carries it.
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(it)
}

// newIntakeID returns a timestamp id with a short random suffix.
func newIntakeID(now time.Time) string {
	b := make([]byte, 2)
	_, _ = rand.Read(b)
	return now.UTC().Format("20060102T150405Z") + "-" + hex.EncodeToString(b)
}

// baseName returns the file's base name, or fallback if empty. Backslashes are
// normalized to slashes first so a Windows-style upload name can't smuggle a
// path (path.Base only splits on "/").
func baseName(name, fallback string) string {
	name = strings.ReplaceAll(strings.TrimSpace(name), "\\", "/")
	name = pathpkg.Base(name)
	if name == "" || name == "." || name == "/" {
		return fallback
	}
	return name
}
