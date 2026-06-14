package intake

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestQueuePut(t *testing.T) {
	var gotPath, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			t.Errorf("method = %s", r.Method)
		}
		gotPath = r.URL.Path
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	q := &Queue{Token: "t", Repo: "Meta-Psy/intake-queue", BaseURL: srv.URL, HTTP: srv.Client()}
	it := Assemble("web", "hello", nil, "", time.Unix(0, 0).UTC(), "zz")
	if err := q.Put(context.Background(), it); err != nil {
		t.Fatalf("Put: %v", err)
	}
	if gotPath != "/repos/Meta-Psy/intake-queue/contents/items/"+it.ID+".json" {
		t.Fatalf("path = %s", gotPath)
	}
	var body struct {
		Message string `json:"message"`
		Content string `json:"content"`
	}
	if err := json.Unmarshal([]byte(gotBody), &body); err != nil {
		t.Fatalf("body not json: %v", err)
	}
	if !strings.Contains(body.Message, it.ID) || body.Content == "" {
		t.Fatalf("body = %+v", body)
	}
}

func TestQueuePutMedia(t *testing.T) {
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()
	q := &Queue{Token: "t", Repo: "r/q", BaseURL: srv.URL, HTTP: srv.Client()}
	path, err := q.PutMedia(context.Background(), "id1", "photo.jpg", []byte{1, 2, 3})
	if err != nil {
		t.Fatalf("PutMedia: %v", err)
	}
	if path != "items/id1/photo.jpg" {
		t.Fatalf("path = %s", path)
	}
	if gotPath != "/repos/r/q/contents/items/id1/photo.jpg" {
		t.Fatalf("url path = %s", gotPath)
	}
}

func TestQueuePutMediaEscapesName(t *testing.T) {
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.EscapedPath()
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()
	q := &Queue{Token: "t", Repo: "r/q", BaseURL: srv.URL, HTTP: srv.Client()}
	if _, err := q.PutMedia(context.Background(), "id1", "my photo.jpg", []byte{1}); err != nil {
		t.Fatalf("PutMedia: %v", err)
	}
	if gotPath != "/repos/r/q/contents/items/id1/my%20photo.jpg" {
		t.Fatalf("escaped url path = %s", gotPath)
	}
}

func TestQueueUpdateSendsSHA(t *testing.T) {
	var gotBody map[string]any
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			t.Errorf("method = %s", r.Method)
		}
		gotPath = r.URL.Path
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &gotBody)
		w.WriteHeader(http.StatusOK) // update → 200
	}))
	defer srv.Close()

	q := &Queue{Token: "t", Repo: "o/r", BaseURL: srv.URL, HTTP: srv.Client()}
	it := Item{ID: "id1", Status: StatusApproved}
	if err := q.Update(context.Background(), it, "sha-abc"); err != nil {
		t.Fatal(err)
	}
	if gotPath != "/repos/o/r/contents/items/id1.json" {
		t.Errorf("path = %s", gotPath)
	}
	if gotBody["sha"] != "sha-abc" {
		t.Fatalf("sha in body = %v, want sha-abc", gotBody["sha"])
	}
}
