package web

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

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
