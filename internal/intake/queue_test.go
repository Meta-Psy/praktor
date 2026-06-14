package intake

import (
	"context"
	"encoding/json"
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
		b := make([]byte, r.ContentLength)
		_, _ = r.Body.Read(b)
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
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
}
