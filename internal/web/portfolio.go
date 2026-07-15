package web

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"
)

// Direction is one roadmap item with its lane.
type Direction struct {
	Title string `json:"title"`
	State string `json:"state"` // planned|doing|done
}

// Metric is one granular counter (e.g. 33 of 2102 конспектов). Values are
// resolved by the publisher; the source spec is never published, so it does not
// appear here.
type Metric struct {
	Key    string  `json:"key"`
	Label  string  `json:"label"`
	Unit   string  `json:"unit,omitempty"`
	Done   int     `json:"done"`
	Total  int     `json:"total"`
	AsOf   string  `json:"as_of,omitempty"` // ISO date the number is current as of
	Weight float64 `json:"weight,omitempty"`
	Error  bool    `json:"error,omitempty"` // true when the publisher could not resolve it
}

// Subproject groups metrics under a project (e.g. "Конспекты", "Видео").
type Subproject struct {
	Key     string   `json:"key"`
	Label   string   `json:"label"`
	Weight  float64  `json:"weight,omitempty"`
	Metrics []Metric `json:"metrics"`
}

// PortfolioProject is one project's roadmap, as published to the data repo.
type PortfolioProject struct {
	Key         string       `json:"key"`
	Name        string       `json:"name"`
	Status      string       `json:"status"` // active|paused|done
	NextAction  string       `json:"next_action,omitempty"`
	McKey       string       `json:"mc_key,omitempty"`
	Directions  []Direction  `json:"directions"`
	Subprojects []Subproject `json:"subprojects,omitempty"`
}

// Portfolio is the published document.
type Portfolio struct {
	GeneratedAt string             `json:"generated_at"`
	Projects    []PortfolioProject `json:"projects"`
}

// portfolioResponse is what the API returns: the portfolio plus degradation flags.
type portfolioResponse struct {
	Portfolio
	Stale      bool   `json:"stale,omitempty"`
	FetchError string `json:"fetch_error,omitempty"`
}

// portfolioFetcher is the read surface the reader needs (mockable in tests).
type portfolioFetcher interface {
	GetFileContent(ctx context.Context, repo, path string) ([]byte, error)
}

type portfolioReader struct {
	gh   portfolioFetcher
	repo string
	path string
}

func (r *portfolioReader) read(ctx context.Context) (Portfolio, error) {
	raw, err := r.gh.GetFileContent(ctx, r.repo, r.path)
	if err != nil {
		return Portfolio{}, err
	}
	var p Portfolio
	if err := json.Unmarshal(raw, &p); err != nil {
		return Portfolio{}, err
	}
	return p, nil
}

// portfolioCache memoizes the last good portfolio and serves it (flagged stale)
// when a refetch fails, so a transient data-repo outage doesn't blank the page.
type portfolioCache struct {
	ttl  time.Duration
	now  func() time.Time
	mu   sync.Mutex
	at   time.Time
	last *Portfolio
}

func (c *portfolioCache) get(read func(context.Context) (Portfolio, error)) portfolioResponse {
	nowFn := time.Now
	if c.now != nil {
		nowFn = c.now
	}

	c.mu.Lock()
	if c.last != nil && nowFn().Sub(c.at) < c.ttl {
		resp := portfolioResponse{Portfolio: *c.last}
		c.mu.Unlock()
		return resp
	}
	c.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	p, err := read(ctx)
	if err != nil {
		c.mu.Lock()
		defer c.mu.Unlock()
		if c.last != nil {
			return portfolioResponse{Portfolio: *c.last, Stale: true, FetchError: err.Error()}
		}
		return portfolioResponse{Stale: true, FetchError: err.Error()}
	}

	c.mu.Lock()
	c.last = &p
	c.at = nowFn()
	c.mu.Unlock()
	return portfolioResponse{Portfolio: p}
}

// handlePortfolio is the GET /api/portfolio handler.
func (s *Server) handlePortfolio(w http.ResponseWriter, r *http.Request) {
	if s.portfolio == nil || s.portfolioCache == nil {
		jsonError(w, "portfolio not configured", http.StatusServiceUnavailable)
		return
	}
	jsonResponse(w, s.portfolioCache.get(s.portfolio.read))
}
