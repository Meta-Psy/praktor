package web

import (
	"context"
	"encoding/base64"
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

func TestGetFileContent(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/repos/o/data/contents/portfolio.json" {
			t.Errorf("path = %s", r.URL.Path)
		}
		// GitHub returns base64 with embedded newlines.
		b64 := base64.StdEncoding.EncodeToString([]byte(`{"hello":"world"}`))
		half := len(b64) / 2
		w.Write([]byte(`{"encoding":"base64","content":"` + b64[:half] + "\\n" + b64[half:] + `"}`))
	}))
	defer srv.Close()

	c := &GitHubClient{BaseURL: srv.URL, HTTP: srv.Client()}
	got, err := c.GetFileContent(context.Background(), "o/data", "portfolio.json")
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if string(got) != `{"hello":"world"}` {
		t.Errorf("content = %q", got)
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

func TestListDir(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/repos/r/q/contents/items" {
			t.Errorf("path = %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`[
			{"name":"a.json","path":"items/a.json","type":"file"},
			{"name":"b.json","path":"items/b.json","type":"file"},
			{"name":"sub","path":"items/sub","type":"dir"}
		]`))
	}))
	defer srv.Close()
	c := &GitHubClient{Token: "t", BaseURL: srv.URL, HTTP: srv.Client()}
	paths, err := c.ListDir(context.Background(), "r/q", "items")
	if err != nil {
		t.Fatalf("ListDir: %v", err)
	}
	if len(paths) != 2 || paths[0] != "items/a.json" || paths[1] != "items/b.json" {
		t.Fatalf("paths = %v", paths)
	}
}

func TestListDirMissingIsEmpty(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	c := &GitHubClient{Token: "t", BaseURL: srv.URL, HTTP: srv.Client()}
	paths, err := c.ListDir(context.Background(), "r/q", "items")
	if err != nil {
		t.Fatalf("ListDir on 404 should be empty, got err: %v", err)
	}
	if len(paths) != 0 {
		t.Fatalf("paths = %v, want empty", paths)
	}
}

func TestSearchRepos(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/search/repositories" {
			t.Errorf("path = %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"items":[
			{"full_name":"o/mcp-x","name":"mcp-x","description":"d","html_url":"https://github.com/o/mcp-x","stargazers_count":12,"pushed_at":"2026-06-20T08:00:00Z","archived":false,"fork":false}
		]}`))
	}))
	defer srv.Close()

	c := &GitHubClient{BaseURL: srv.URL}
	repos, err := c.SearchRepos(context.Background(), "q=topic:mcp")
	if err != nil {
		t.Fatal(err)
	}
	if len(repos) != 1 {
		t.Fatalf("len = %d", len(repos))
	}
	r := repos[0]
	if r.FullName != "o/mcp-x" || r.Stars != 12 || r.HTMLURL == "" || r.PushedAt == "" {
		t.Fatalf("repo = %+v", r)
	}
}

func TestGetFileWithSHA(t *testing.T) {
	const content = `{"status":"awaiting-approval"}`
	b64 := base64.StdEncoding.EncodeToString([]byte(content))
	half := len(b64) / 2
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/repos/o/data/contents/items/abc.json" {
			t.Errorf("path = %s", r.URL.Path)
		}
		w.Write([]byte(`{"encoding":"base64","sha":"deadbeef","content":"` +
			b64[:half] + "\\n" + b64[half:] + `"}`))
	}))
	defer srv.Close()

	c := &GitHubClient{BaseURL: srv.URL, HTTP: srv.Client()}
	got, sha, err := c.GetFileWithSHA(context.Background(), "o/data", "items/abc.json")
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if string(got) != content {
		t.Errorf("content = %q", got)
	}
	if sha != "deadbeef" {
		t.Errorf("sha = %q, want deadbeef", sha)
	}
}
