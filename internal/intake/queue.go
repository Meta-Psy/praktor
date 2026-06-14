package intake

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// escapePath percent-encodes each path segment (preserving the slashes) so an
// arbitrary media filename — spaces, Unicode — produces a valid Contents API URL.
func escapePath(p string) string {
	parts := strings.Split(p, "/")
	for i, s := range parts {
		parts[i] = url.PathEscape(s)
	}
	return strings.Join(parts, "/")
}

// Queue writes intake Items and media to a GitHub data repo via the Contents API.
// Token comes from GITHUB_WRITE_TOKEN (same write-PAT as Mission Control actions).
type Queue struct {
	Token   string
	Repo    string // owner/name
	BaseURL string // default https://api.github.com
	HTTP    *http.Client
}

func (q *Queue) base() string {
	if q.BaseURL != "" {
		return q.BaseURL
	}
	return "https://api.github.com"
}

func (q *Queue) httpClient() *http.Client {
	if q.HTTP != nil {
		return q.HTTP
	}
	return &http.Client{Timeout: 15 * time.Second}
}

// putFile creates or updates a file. sha empty = create (expects 201);
// sha set = update (expects 200).
func (q *Queue) putFile(ctx context.Context, path string, content []byte, message, sha string) error {
	body := map[string]string{
		"message": message,
		"content": base64.StdEncoding.EncodeToString(content),
	}
	if sha != "" {
		body["sha"] = sha
	}
	b, err := json.Marshal(body)
	if err != nil {
		return err
	}
	endpoint := fmt.Sprintf("%s/repos/%s/contents/%s", q.base(), q.Repo, escapePath(path))
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, endpoint, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Content-Type", "application/json")
	if q.Token != "" {
		req.Header.Set("Authorization", "Bearer "+q.Token)
	}
	resp, err := q.httpClient().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		var ge struct {
			Message string `json:"message"`
		}
		_ = json.Unmarshal(raw, &ge)
		if ge.Message != "" {
			return fmt.Errorf("github put %s: %s (%s)", path, ge.Message, resp.Status)
		}
		return fmt.Errorf("github put %s: %s", path, resp.Status)
	}
	return nil
}

// Put writes items/<id>.json (create).
func (q *Queue) Put(ctx context.Context, it Item) error {
	data, err := json.MarshalIndent(it, "", "  ")
	if err != nil {
		return err
	}
	return q.putFile(ctx, "items/"+it.ID+".json", data, "intake: queue "+it.ID, "")
}

// Update overwrites items/<id>.json carrying sha (optimistic concurrency); a
// stale sha makes the Contents API reject the write.
func (q *Queue) Update(ctx context.Context, it Item, sha string) error {
	data, err := json.MarshalIndent(it, "", "  ")
	if err != nil {
		return err
	}
	return q.putFile(ctx, "items/"+it.ID+".json", data, "intake: "+it.Status+" "+it.ID, sha)
}

// PutMedia writes items/<id>/<name> and returns its repo-relative path.
func (q *Queue) PutMedia(ctx context.Context, id, name string, data []byte) (string, error) {
	path := fmt.Sprintf("items/%s/%s", id, name)
	if err := q.putFile(ctx, path, data, "intake: media "+id+"/"+name, ""); err != nil {
		return "", err
	}
	return path, nil
}
