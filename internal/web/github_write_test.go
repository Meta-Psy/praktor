package web

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAddComment(t *testing.T) {
	var gotPath, gotAuth, gotBody string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":1}`))
	}))
	defer ts.Close()

	c := &WriteGitHubClient{Token: "tok", BaseURL: ts.URL, HTTP: ts.Client()}
	if err := c.AddComment(context.Background(), "o/r", 7, "/approve all"); err != nil {
		t.Fatalf("AddComment: %v", err)
	}
	if gotPath != "/repos/o/r/issues/7/comments" {
		t.Errorf("path = %q", gotPath)
	}
	if gotAuth != "Bearer tok" {
		t.Errorf("auth = %q", gotAuth)
	}
	var parsed map[string]string
	_ = json.Unmarshal([]byte(gotBody), &parsed)
	if parsed["body"] != "/approve all" {
		t.Errorf("body = %q", gotBody)
	}
}

func TestMergePR(t *testing.T) {
	var gotPath, gotMethod string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotMethod = r.URL.Path, r.Method
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"merged":true}`))
	}))
	defer ts.Close()

	c := &WriteGitHubClient{Token: "tok", BaseURL: ts.URL, HTTP: ts.Client()}
	if err := c.MergePR(context.Background(), "o/r", 12, "squash"); err != nil {
		t.Fatalf("MergePR: %v", err)
	}
	if gotMethod != http.MethodPut || gotPath != "/repos/o/r/pulls/12/merge" {
		t.Errorf("%s %s", gotMethod, gotPath)
	}
}

func TestMergePRConflict(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusMethodNotAllowed)
		_, _ = w.Write([]byte(`{"message":"Pull Request is not mergeable"}`))
	}))
	defer ts.Close()

	c := &WriteGitHubClient{Token: "tok", BaseURL: ts.URL, HTTP: ts.Client()}
	err := c.MergePR(context.Background(), "o/r", 12, "squash")
	if err == nil || !strings.Contains(err.Error(), "not mergeable") {
		t.Fatalf("want mergeable error, got %v", err)
	}
}

func TestDispatchWorkflow(t *testing.T) {
	var gotPath, gotBody string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer ts.Close()

	c := &WriteGitHubClient{Token: "tok", BaseURL: ts.URL, HTTP: ts.Client()}
	if err := c.DispatchWorkflow(context.Background(), "o/r", "deploy.yml", "main"); err != nil {
		t.Fatalf("DispatchWorkflow: %v", err)
	}
	if gotPath != "/repos/o/r/actions/workflows/deploy.yml/dispatches" {
		t.Errorf("path = %q", gotPath)
	}
	if !strings.Contains(gotBody, `"ref":"main"`) {
		t.Errorf("body = %q", gotBody)
	}
}
