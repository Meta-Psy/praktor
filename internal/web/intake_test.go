package web

import (
	"bytes"
	"context"
	"errors"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/mtzanidakis/praktor/internal/intake"
)

type fakeIntakeFetcher struct {
	paths map[string][]string
	files map[string][]byte
	err   error
}

func (f *fakeIntakeFetcher) ListDir(_ context.Context, _, dir string) ([]string, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.paths[dir], nil
}
func (f *fakeIntakeFetcher) GetFileContent(_ context.Context, _, path string) ([]byte, error) {
	if f.err != nil {
		return nil, f.err
	}
	b, ok := f.files[path]
	if !ok {
		return nil, errors.New("not found: " + path)
	}
	return b, nil
}
func (f *fakeIntakeFetcher) GetFileWithSHA(_ context.Context, _, path string) ([]byte, string, error) {
	b, err := f.GetFileContent(context.Background(), "", path)
	if err != nil {
		return nil, "", err
	}
	return b, "sha-" + path, nil
}

func TestIntakeReaderSortsNewestFirst(t *testing.T) {
	f := &fakeIntakeFetcher{
		paths: map[string][]string{"items": {"items/a.json", "items/b.json"}},
		files: map[string][]byte{
			"items/a.json": []byte(`{"id":"a","status":"queued","created_at":"2026-06-14T08:00:00Z"}`),
			"items/b.json": []byte(`{"id":"b","status":"done","created_at":"2026-06-14T10:00:00Z"}`),
		},
	}
	r := &intakeReader{gh: f, repo: "r/q"}
	items, err := r.list(context.Background())
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(items) != 2 || items[0].ID != "b" || items[1].ID != "a" {
		t.Fatalf("order = %v", items)
	}
}

func TestIntakeCacheServesStaleOnError(t *testing.T) {
	good := &fakeIntakeFetcher{
		paths: map[string][]string{"items": {"items/a.json"}},
		files: map[string][]byte{"items/a.json": []byte(`{"id":"a","status":"queued","created_at":"2026-06-14T08:00:00Z"}`)},
	}
	r := &intakeReader{gh: good, repo: "r/q"}
	now := time.Now()
	c := &intakeCache{ttl: time.Minute, now: func() time.Time { return now }}

	first := c.get(r.list)
	if first.Stale || len(first.Items) != 1 {
		t.Fatalf("first = %+v", first)
	}
	// Force expiry + failing fetch → stale served from cache.
	good.err = errors.New("boom")
	now = now.Add(2 * time.Minute)
	second := c.get(r.list)
	if !second.Stale || len(second.Items) != 1 || second.FetchError == "" {
		t.Fatalf("second = %+v", second)
	}
}

func TestHandleIntakeListUnconfigured(t *testing.T) {
	s := &Server{}
	rec := httptest.NewRecorder()
	s.handleIntakeList(rec, httptest.NewRequest(http.MethodGet, "/api/intake", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("code = %d", rec.Code)
	}
}

type fakeQueue struct {
	put   *intake.Item
	media []string
}

func (f *fakeQueue) Put(_ context.Context, it intake.Item) error { f.put = &it; return nil }
func (f *fakeQueue) PutMedia(_ context.Context, id, name string, _ []byte) (string, error) {
	p := "items/" + id + "/" + name
	f.media = append(f.media, p)
	return p, nil
}

type fakeTranscriber struct{ text string }

func (f *fakeTranscriber) Transcribe(_ context.Context, _ []byte, _ string) (string, error) {
	return f.text, nil
}

func multipartBody(t *testing.T, fields map[string]string, files map[string]struct {
	name string
	data []byte
}) (string, *bytes.Buffer) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for k, v := range fields {
		_ = mw.WriteField(k, v)
	}
	for field, f := range files {
		fw, _ := mw.CreateFormFile(field, f.name)
		_, _ = fw.Write(f.data)
	}
	_ = mw.Close()
	return mw.FormDataContentType(), &buf
}

func newIntakeServer(q intakeWriter, tr transcriber) *Server {
	return &Server{intakeQueue: q, transcriber: tr}
}

func TestHandleIntakeCreateText(t *testing.T) {
	q := &fakeQueue{}
	s := newIntakeServer(q, &fakeTranscriber{})
	ct, body := multipartBody(t, map[string]string{"text": "fix readme", "project": "pdai"}, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/intake", body)
	req.Header.Set("Content-Type", ct)
	rec := httptest.NewRecorder()
	s.handleIntakeCreate(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("code = %d (%s)", rec.Code, rec.Body)
	}
	if q.put == nil || q.put.RawText != "fix readme" || q.put.TargetProject != "pdai" {
		t.Fatalf("queued = %+v", q.put)
	}
}

func TestHandleIntakeCreateVoiceTranscribed(t *testing.T) {
	q := &fakeQueue{}
	s := newIntakeServer(q, &fakeTranscriber{text: "dictated task"})
	ct, body := multipartBody(t, nil, map[string]struct {
		name string
		data []byte
	}{"audio": {"voice.ogg", []byte{1, 2}}})
	req := httptest.NewRequest(http.MethodPost, "/api/intake", body)
	req.Header.Set("Content-Type", ct)
	rec := httptest.NewRecorder()
	s.handleIntakeCreate(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("code = %d (%s)", rec.Code, rec.Body)
	}
	if q.put == nil || q.put.RawText != "dictated task" {
		t.Fatalf("queued = %+v", q.put)
	}
}

func TestHandleIntakeCreateEmpty400(t *testing.T) {
	s := newIntakeServer(&fakeQueue{}, &fakeTranscriber{})
	ct, body := multipartBody(t, map[string]string{}, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/intake", body)
	req.Header.Set("Content-Type", ct)
	rec := httptest.NewRecorder()
	s.handleIntakeCreate(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("code = %d", rec.Code)
	}
}

func TestIntakeReaderGetItem(t *testing.T) {
	item := `{"id":"20260615T100000Z-ab12","source":"web","raw_text":"build X","status":"awaiting-approval","created_at":"2026-06-15T10:00:00Z","updated_at":"2026-06-15T10:00:00Z"}`
	f := &fakeIntakeFetcher{files: map[string][]byte{
		"items/20260615T100000Z-ab12.json": []byte(item),
	}}
	r := &intakeReader{gh: f, repo: "r/q"}
	it, sha, err := r.getItem(context.Background(), "20260615T100000Z-ab12")
	if err != nil {
		t.Fatal(err)
	}
	if it.Status != "awaiting-approval" || it.RawText != "build X" {
		t.Fatalf("item = %+v", it)
	}
	if sha == "" {
		t.Fatal("expected non-empty sha")
	}
}
