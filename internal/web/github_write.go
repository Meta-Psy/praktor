package web

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// WriteGitHubClient performs the small set of write actions Mission Control needs.
// Token comes from GITHUB_WRITE_TOKEN (separate from the read-only roll-up token).
type WriteGitHubClient struct {
	Token   string
	BaseURL string // default https://api.github.com
	HTTP    *http.Client
}

func (c *WriteGitHubClient) base() string {
	if c.BaseURL != "" {
		return c.BaseURL
	}
	return "https://api.github.com"
}

func (c *WriteGitHubClient) httpClient() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return &http.Client{Timeout: 15 * time.Second}
}

// do sends a request, treats any status outside wantStatus as an error
// (surfacing the GitHub "message" field when present).
func (c *WriteGitHubClient) do(ctx context.Context, method, path string, body any, wantStatus int) error {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base()+path, rdr)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Content-Type", "application/json")
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	resp, err := c.httpClient().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != wantStatus {
		raw, _ := io.ReadAll(resp.Body)
		var ge struct {
			Message string `json:"message"`
		}
		_ = json.Unmarshal(raw, &ge)
		if ge.Message != "" {
			return fmt.Errorf("github %s %s: %s (%s)", method, path, ge.Message, resp.Status)
		}
		return fmt.Errorf("github %s %s: %s", method, path, resp.Status)
	}
	return nil
}

// AddComment posts a comment on an issue (used to trigger approve-handler.yml).
func (c *WriteGitHubClient) AddComment(ctx context.Context, repo string, issue int, body string) error {
	return c.do(ctx, http.MethodPost,
		fmt.Sprintf("/repos/%s/issues/%d/comments", repo, issue),
		map[string]string{"body": body}, http.StatusCreated)
}

// MergePR merges a pull request. method is "merge"|"squash"|"rebase".
func (c *WriteGitHubClient) MergePR(ctx context.Context, repo string, number int, method string) error {
	return c.do(ctx, http.MethodPut,
		fmt.Sprintf("/repos/%s/pulls/%d/merge", repo, number),
		map[string]string{"merge_method": method}, http.StatusOK)
}

// DispatchWorkflow triggers a workflow_dispatch on the given workflow file.
func (c *WriteGitHubClient) DispatchWorkflow(ctx context.Context, repo, workflow, ref string) error {
	return c.do(ctx, http.MethodPost,
		fmt.Sprintf("/repos/%s/actions/workflows/%s/dispatches", repo, workflow),
		map[string]string{"ref": ref}, http.StatusNoContent)
}
