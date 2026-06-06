package web

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

// GitHubClient is a minimal read-only GitHub REST client for the MC roll-up.
type GitHubClient struct {
	Token   string
	BaseURL string // default https://api.github.com
	HTTP    *http.Client
}

// PRInfo is a single open pull request.
type PRInfo struct {
	Number int    `json:"number"`
	Title  string `json:"title"`
	URL    string `json:"url"`
	Draft  bool   `json:"draft"`
}

// IssueInfo is a single open issue.
type IssueInfo struct {
	Number int    `json:"number"`
	Title  string `json:"title"`
	URL    string `json:"url"`
}

// CIStatus is the latest workflow run on the default branch.
type CIStatus struct {
	Status     string `json:"status"`     // queued|in_progress|completed
	Conclusion string `json:"conclusion"` // success|failure|...
	URL        string `json:"url"`
}

func (c *GitHubClient) base() string {
	if c.BaseURL != "" {
		return c.BaseURL
	}
	return "https://api.github.com"
}

func (c *GitHubClient) httpClient() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return &http.Client{Timeout: 8 * time.Second}
}

func (c *GitHubClient) get(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base()+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	resp, err := c.httpClient().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("github %s: %s", path, resp.Status)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// OpenPRs returns open pull requests for owner/name.
func (c *GitHubClient) OpenPRs(ctx context.Context, repo string) ([]PRInfo, error) {
	var raw []struct {
		Number  int    `json:"number"`
		Title   string `json:"title"`
		HTMLURL string `json:"html_url"`
		Draft   bool   `json:"draft"`
	}
	if err := c.get(ctx, "/repos/"+repo+"/pulls", &raw); err != nil {
		return nil, err
	}
	out := make([]PRInfo, 0, len(raw))
	for _, p := range raw {
		out = append(out, PRInfo{Number: p.Number, Title: p.Title, URL: p.HTMLURL, Draft: p.Draft})
	}
	return out, nil
}

// AuditIssues returns open issues with the given label (e.g. "audit-report").
// The GitHub issues endpoint also returns PRs; entries with a pull_request field are skipped.
func (c *GitHubClient) AuditIssues(ctx context.Context, repo, label string) ([]IssueInfo, error) {
	var raw []struct {
		Number      int             `json:"number"`
		Title       string          `json:"title"`
		HTMLURL     string          `json:"html_url"`
		PullRequest json.RawMessage `json:"pull_request"`
	}
	q := url.Values{"state": {"open"}, "labels": {label}}
	if err := c.get(ctx, "/repos/"+repo+"/issues?"+q.Encode(), &raw); err != nil {
		return nil, err
	}
	out := make([]IssueInfo, 0, len(raw))
	for _, i := range raw {
		if len(i.PullRequest) > 0 {
			continue // it's a PR, not an issue
		}
		out = append(out, IssueInfo{Number: i.Number, Title: i.Title, URL: i.HTMLURL})
	}
	return out, nil
}

// LatestCI returns the most recent workflow run on the repo's default branch.
func (c *GitHubClient) LatestCI(ctx context.Context, repo string) (CIStatus, error) {
	var meta struct {
		DefaultBranch string `json:"default_branch"`
	}
	if err := c.get(ctx, "/repos/"+repo, &meta); err != nil {
		return CIStatus{}, err
	}
	var runs struct {
		WorkflowRuns []struct {
			Status     string `json:"status"`
			Conclusion string `json:"conclusion"`
			HTMLURL    string `json:"html_url"`
		} `json:"workflow_runs"`
	}
	q := url.Values{"branch": {meta.DefaultBranch}, "per_page": {"1"}}
	if err := c.get(ctx, "/repos/"+repo+"/actions/runs?"+q.Encode(), &runs); err != nil {
		return CIStatus{}, err
	}
	if len(runs.WorkflowRuns) == 0 {
		return CIStatus{Status: "none"}, nil
	}
	r := runs.WorkflowRuns[0]
	return CIStatus{Status: r.Status, Conclusion: r.Conclusion, URL: r.HTMLURL}, nil
}
