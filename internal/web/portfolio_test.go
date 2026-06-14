package web

import (
	"context"
	"errors"
	"net/http/httptest"
	"testing"
	"time"
)

type fakePortfolioGH struct {
	data []byte
	err  error
}

func (f *fakePortfolioGH) GetFileContent(ctx context.Context, repo, path string) ([]byte, error) {
	return f.data, f.err
}

func TestPortfolioReader_Parses(t *testing.T) {
	gh := &fakePortfolioGH{data: []byte(`{"generated_at":"2026-06-11T10:00:00Z","projects":[{"key":"k","name":"N","status":"active","directions":[{"title":"d","state":"done"}]}]}`)}
	r := &portfolioReader{gh: gh, repo: "o/data", path: "portfolio.json"}
	p, err := r.read(context.Background())
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if len(p.Projects) != 1 || p.Projects[0].Key != "k" || p.Projects[0].Directions[0].State != "done" {
		t.Errorf("parsed: %+v", p)
	}
}

func TestPortfolioCache_ServesStaleOnError(t *testing.T) {
	good := []byte(`{"projects":[{"key":"k","name":"N","status":"active","directions":[]}]}`)
	gh := &fakePortfolioGH{data: good}
	r := &portfolioReader{gh: gh, repo: "o/data", path: "portfolio.json"}
	c := &portfolioCache{ttl: time.Minute, now: func() time.Time { return time.Unix(0, 0) }}

	resp := c.get(r.read) // first fetch: fresh, ok
	if resp.Stale || len(resp.Projects) != 1 {
		t.Fatalf("first: %+v", resp)
	}

	gh.err = errors.New("boom") // repo now unreachable
	gh.data = nil
	c.now = func() time.Time { return time.Unix(3600, 0) } // past TTL → refetch attempted
	resp = c.get(r.read)
	if !resp.Stale || len(resp.Projects) != 1 || resp.FetchError == "" {
		t.Errorf("stale serve failed: %+v", resp)
	}
}

func TestHandlePortfolio_NotConfigured(t *testing.T) {
	s := &Server{} // no portfolio reader
	req := httptest.NewRequest("GET", "/api/portfolio", nil)
	w := httptest.NewRecorder()
	s.handlePortfolio(w, req)
	if w.Code != 503 {
		t.Errorf("code = %d, want 503", w.Code)
	}
}
