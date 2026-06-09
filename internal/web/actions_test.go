package web

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mtzanidakis/praktor/internal/config"
)

type fakeGHWriter struct {
	comment    string
	merged     int
	dispatched string
	err        error
}

func (f *fakeGHWriter) AddComment(_ context.Context, repo string, issue int, body string) error {
	f.comment = body
	return f.err
}
func (f *fakeGHWriter) MergePR(_ context.Context, repo string, n int, method string) error {
	f.merged = n
	return f.err
}
func (f *fakeGHWriter) DispatchWorkflow(_ context.Context, repo, wf, ref string) error {
	f.dispatched = wf
	return f.err
}

type fakeAuditor struct{ last string }

func (f *fakeAuditor) Notify(_ context.Context, text string) { f.last = text }

func testServer(gh ghWriter, aud auditor, run oneShotRunner) *Server {
	return &Server{
		ghWrite: gh,
		tg:      aud,
		oneShot: run,
		projects: map[string]config.ProjectDefinition{
			"pdai":       {Repo: "Meta-Psy/pdai_calculator", DeployWorkflow: "deploy.yml"},
			"gnathology": {Repo: "Meta-Psy/gnathology-bot", DeployHostDir: "/opt/apps/gnathology-bot/deploy", DeployComposeProject: "gnathology-bot"},
		},
	}
}

func do(t *testing.T, s *Server, method, path, body string, h http.HandlerFunc) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.SetPathValue("key", strings.Split(strings.TrimPrefix(path, "/api/projects/"), "/")[0])
	rec := httptest.NewRecorder()
	h(rec, req)
	return rec
}

func TestHandleApprove(t *testing.T) {
	gh, aud := &fakeGHWriter{}, &fakeAuditor{}
	s := testServer(gh, aud, nil)
	rec := do(t, s, http.MethodPost, "/api/projects/pdai/approve", `{"tier":"all","issue":7}`, s.handleApprove)
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d (%s)", rec.Code, rec.Body)
	}
	if gh.comment != "/approve all" {
		t.Errorf("comment = %q", gh.comment)
	}
	if !strings.Contains(aud.last, "approve") {
		t.Errorf("audit not fired: %q", aud.last)
	}
}

func TestHandleApproveBadTier(t *testing.T) {
	gh := &fakeGHWriter{}
	s := testServer(gh, &fakeAuditor{}, nil)
	rec := do(t, s, http.MethodPost, "/api/projects/pdai/approve", `{"tier":"everything","issue":7}`, s.handleApprove)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rec.Code)
	}
	if gh.comment != "" {
		t.Errorf("must not comment on bad tier")
	}
}

func TestHandleApproveUnknownProject(t *testing.T) {
	s := testServer(&fakeGHWriter{}, &fakeAuditor{}, nil)
	rec := do(t, s, http.MethodPost, "/api/projects/nope/approve", `{"tier":"all","issue":7}`, s.handleApprove)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", rec.Code)
	}
}

func TestHandleDeployPdaiDispatches(t *testing.T) {
	gh, aud := &fakeGHWriter{}, &fakeAuditor{}
	s := testServer(gh, aud, nil)
	rec := do(t, s, http.MethodPost, "/api/projects/pdai/deploy", ``, s.handleDeploy)
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d (%s)", rec.Code, rec.Body)
	}
	if gh.dispatched != "deploy.yml" {
		t.Errorf("dispatched = %q", gh.dispatched)
	}
}

func TestHandleDeployGnathologyUsesRunner(t *testing.T) {
	gh, aud := &fakeGHWriter{}, &fakeAuditor{}
	run := &fakeRunner{exit: []int{0, 0}}
	s := testServer(gh, aud, run)
	rec := do(t, s, http.MethodPost, "/api/projects/gnathology/deploy", ``, s.handleDeploy)
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d (%s)", rec.Code, rec.Body)
	}
	if len(run.calls) != 2 {
		t.Errorf("want 2 container runs, got %d", len(run.calls))
	}
}

func TestHandleMergeError(t *testing.T) {
	gh := &fakeGHWriter{err: context.DeadlineExceeded}
	aud := &fakeAuditor{}
	s := testServer(gh, aud, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/projects/pdai/pulls/12/merge", nil)
	req.SetPathValue("key", "pdai")
	req.SetPathValue("n", "12")
	rec := httptest.NewRecorder()
	s.handleMerge(rec, req)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("want 502, got %d", rec.Code)
	}
	if !strings.Contains(aud.last, "❌") {
		t.Errorf("failed action must audit with failure marker: %q", aud.last)
	}
}
