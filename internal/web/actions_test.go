package web

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

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
		deploys: newDeployStore(),
		projects: map[string]config.ProjectDefinition{
			"pdai":       {Repo: "Meta-Psy/pdai_calculator", DeployWorkflow: "deploy.yml"},
			"gnathology": {Repo: "Meta-Psy/gnathology-bot", DeployHostDir: "/opt/apps/gnathology-bot/deploy", DeployComposeProject: "gnathology-bot"},
			"bare":       {Repo: "Meta-Psy/bare"},
		},
	}
}

// waitDeploy polls until project key reaches the wanted deploy state (or fails the test).
func waitDeploy(t *testing.T, s *Server, key, want string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for s.deploys.snapshot(key).State != want {
		if time.Now().After(deadline) {
			t.Fatalf("deploy %s state = %q, want %q", key, s.deploys.snapshot(key).State, want)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// blockingRunner hangs each Run until released, so a test can observe the
// "running" window and the 409 guard.
type blockingRunner struct {
	release chan struct{}
}

func (b *blockingRunner) Run(_ context.Context, _ oneShotSpec) (string, int, error) {
	<-b.release
	return "", 0, nil
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
	if rec.Code != http.StatusAccepted {
		t.Fatalf("code = %d (%s), want 202", rec.Code, rec.Body)
	}
	waitDeploy(t, s, "pdai", "ok")
	if gh.dispatched != "deploy.yml" {
		t.Errorf("dispatched = %q", gh.dispatched)
	}
}

func TestHandleDeployGnathologyUsesRunner(t *testing.T) {
	gh, aud := &fakeGHWriter{}, &fakeAuditor{}
	run := &fakeRunner{exit: []int{0, 0}}
	s := testServer(gh, aud, run)
	rec := do(t, s, http.MethodPost, "/api/projects/gnathology/deploy", ``, s.handleDeploy)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("code = %d (%s), want 202", rec.Code, rec.Body)
	}
	waitDeploy(t, s, "gnathology", "ok")
	if len(run.calls) != 2 {
		t.Errorf("want 2 container runs, got %d", len(run.calls))
	}
}

func TestHandleDeployGuardsConcurrent(t *testing.T) {
	gh, aud := &fakeGHWriter{}, &fakeAuditor{}
	run := &blockingRunner{release: make(chan struct{})}
	s := testServer(gh, aud, run)

	// First deploy returns 202 and blocks in the runner.
	if rec := do(t, s, http.MethodPost, "/api/projects/gnathology/deploy", ``, s.handleDeploy); rec.Code != http.StatusAccepted {
		t.Fatalf("first deploy code = %d, want 202", rec.Code)
	}
	waitDeploy(t, s, "gnathology", "running")

	// Second deploy while running → 409.
	if rec := do(t, s, http.MethodPost, "/api/projects/gnathology/deploy", ``, s.handleDeploy); rec.Code != http.StatusConflict {
		t.Fatalf("concurrent deploy code = %d, want 409", rec.Code)
	}

	close(run.release)
	waitDeploy(t, s, "gnathology", "ok")
}

func TestHandleDeployNoMechanism(t *testing.T) {
	s := testServer(&fakeGHWriter{}, &fakeAuditor{}, nil)
	rec := do(t, s, http.MethodPost, "/api/projects/bare/deploy", ``, s.handleDeploy)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400", rec.Code)
	}
	if s.deploys.snapshot("bare").State != "" {
		t.Error("misconfigured project must not enter running state")
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
