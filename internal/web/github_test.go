package web

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGitHubOpenPRs(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/repos/o/r/pulls" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer tok" {
			t.Errorf("missing auth header")
		}
		_, _ = w.Write([]byte(`[{"number":2,"title":"fix x","html_url":"http://gh/2","draft":false}]`))
	}))
	defer srv.Close()

	gh := &GitHubClient{Token: "tok", BaseURL: srv.URL, HTTP: srv.Client()}
	prs, err := gh.OpenPRs(context.Background(), "o/r")
	if err != nil {
		t.Fatalf("OpenPRs: %v", err)
	}
	if len(prs) != 1 || prs[0].Number != 2 || prs[0].Title != "fix x" || prs[0].URL != "http://gh/2" {
		t.Fatalf("got %+v", prs)
	}
}

func TestGitHubAuditIssuesSkipsPRs(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`[
			{"number":13,"title":"audit","html_url":"http://gh/13"},
			{"number":9,"title":"a pr","html_url":"http://gh/9","pull_request":{"url":"x"}}
		]`))
	}))
	defer srv.Close()
	gh := &GitHubClient{BaseURL: srv.URL, HTTP: srv.Client()}
	issues, err := gh.AuditIssues(context.Background(), "o/r", "audit-report")
	if err != nil {
		t.Fatal(err)
	}
	if len(issues) != 1 || issues[0].Number != 13 {
		t.Fatalf("expected only issue #13, got %+v", issues)
	}
}

func TestGitHubLatestCI(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/o/r":
			_, _ = w.Write([]byte(`{"default_branch":"main"}`))
		case "/repos/o/r/actions/runs":
			if r.URL.Query().Get("branch") != "main" {
				t.Errorf("branch = %s", r.URL.Query().Get("branch"))
			}
			_, _ = w.Write([]byte(`{"workflow_runs":[{"status":"completed","conclusion":"success","html_url":"http://gh/run"}]}`))
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
		}
	}))
	defer srv.Close()
	gh := &GitHubClient{BaseURL: srv.URL, HTTP: srv.Client()}
	ci, err := gh.LatestCI(context.Background(), "o/r")
	if err != nil {
		t.Fatal(err)
	}
	if ci.Conclusion != "success" || ci.URL != "http://gh/run" {
		t.Fatalf("got %+v", ci)
	}
}
