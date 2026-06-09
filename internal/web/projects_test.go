package web

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/mtzanidakis/praktor/internal/config"
	"github.com/mtzanidakis/praktor/internal/container"
)

type fakeGH struct {
	prs    []PRInfo
	issues []IssueInfo
	ci     CIStatus
	err    error
}

func (f *fakeGH) OpenPRs(ctx context.Context, repo string) ([]PRInfo, error) {
	return f.prs, f.err
}
func (f *fakeGH) AuditIssues(ctx context.Context, repo, label string) ([]IssueInfo, error) {
	return f.issues, f.err
}
func (f *fakeGH) LatestCI(ctx context.Context, repo string) (CIStatus, error) {
	return f.ci, f.err
}

func TestBuildProjectStatus_OK(t *testing.T) {
	deploy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer deploy.Close()

	agg := &Aggregator{
		gh:   &fakeGH{prs: []PRInfo{{Number: 2}}, issues: []IssueInfo{{Number: 13}}, ci: CIStatus{Conclusion: "success"}},
		http: deploy.Client(),
	}
	def := config.ProjectDefinition{Repo: "o/r", Agents: []string{"coder", "ghost"}, DeployURL: deploy.URL}
	running := []container.ContainerInfo{{AgentID: "coder", Status: "running"}}

	st := agg.BuildProjectStatus(context.Background(), "pdai", def, running)

	if st.Name != "pdai" || st.Repo != "o/r" {
		t.Errorf("identity: %+v", st)
	}
	if len(st.PRs) != 1 || len(st.AuditIssues) != 1 || st.CI.Conclusion != "success" {
		t.Errorf("github: %+v", st)
	}
	if !st.Deploy.OK || st.Deploy.Code != 200 {
		t.Errorf("deploy: %+v", st.Deploy)
	}
	live := map[string]bool{}
	for _, a := range st.Agents {
		live[a.ID] = a.Running
	}
	if !live["coder"] || live["ghost"] {
		t.Errorf("agents: %+v", st.Agents)
	}
}

func TestBuildProjectStatus_PartialDegradation(t *testing.T) {
	agg := &Aggregator{
		gh:   &fakeGH{err: errors.New("boom")},
		http: &http.Client{},
	}
	def := config.ProjectDefinition{Repo: "o/r", DeployURL: "http://127.0.0.1:1/nope"}
	st := agg.BuildProjectStatus(context.Background(), "x", def, nil)

	if st.PRError == "" || st.AuditError == "" || st.CI.Error == "" {
		t.Errorf("expected error fields set, got %+v", st)
	}
	if st.Deploy.OK || st.Deploy.Error == "" {
		t.Errorf("expected deploy error, got %+v", st.Deploy)
	}
	if st.Name != "x" {
		t.Errorf("identity lost: %+v", st)
	}
}

func TestProjectsCache(t *testing.T) {
	calls := 0
	c := &projectsCache{ttl: time.Minute, now: func() time.Time { return time.Unix(1000, 0) }}
	build := func() []ProjectStatus {
		calls++
		return []ProjectStatus{{Name: "pdai"}}
	}
	_ = c.get(build)
	_ = c.get(build) // within TTL → must NOT rebuild
	if calls != 1 {
		t.Fatalf("expected 1 build within TTL, got %d", calls)
	}
}

func TestOverlayDeployRuns(t *testing.T) {
	d := newDeployStore()
	d.tryStart("pdai")
	data := []ProjectStatus{
		{Name: "pdai", Repo: "x/pdai"},
		{Name: "gnathology", Repo: "x/g"},
	}
	out := overlayDeployRuns(data, d)
	if out[0].DeployRun.State != "running" {
		t.Fatalf("pdai deploy_run = %q, want running", out[0].DeployRun.State)
	}
	if out[1].DeployRun.State != "" {
		t.Fatalf("gnathology deploy_run = %q, want empty", out[1].DeployRun.State)
	}
	// The input slice (which may be the shared cache) must NOT be mutated.
	if data[0].DeployRun.State != "" {
		t.Fatal("overlay must not mutate the input (cached) slice")
	}
}
