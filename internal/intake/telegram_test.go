package intake

import (
	"context"
	"testing"
	"time"
)

type capturingQueue struct{ last *Item }

func (c *capturingQueue) Put(_ context.Context, it Item) error { c.last = &it; return nil }
func (c *capturingQueue) PutMedia(_ context.Context, id, name string, _ []byte) (string, error) {
	return "items/" + id + "/" + name, nil
}

func TestBuildItemTextOnly(t *testing.T) {
	q := &capturingQueue{}
	p := &Poller{queue: q, now: func() time.Time { return time.Unix(0, 0).UTC() }, idSuffix: func() string { return "tg01" }}
	if err := p.enqueue(context.Background(), "ship the thing", nil, ""); err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	if q.last == nil || q.last.Source != "telegram" || q.last.RawText != "ship the thing" {
		t.Fatalf("item = %+v", q.last)
	}
	if q.last.ID != "19700101T000000Z-tg01" {
		t.Fatalf("id = %q", q.last.ID)
	}
}

func TestBuildItemWithMedia(t *testing.T) {
	q := &capturingQueue{}
	p := &Poller{queue: q, now: func() time.Time { return time.Unix(0, 0).UTC() }, idSuffix: func() string { return "tg02" }}
	err := p.enqueue(context.Background(), "caption", []mediaBlob{{Name: "photo.jpg", Data: []byte{9}}}, "histology")
	if err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	if len(q.last.Media) != 1 || q.last.Media[0] != "items/19700101T000000Z-tg02/photo.jpg" {
		t.Fatalf("media = %v", q.last.Media)
	}
	if q.last.TargetProject != "histology" {
		t.Fatalf("project = %q", q.last.TargetProject)
	}
}
