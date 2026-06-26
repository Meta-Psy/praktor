package intel

import (
	"strings"
	"testing"

	"github.com/mtzanidakis/praktor/internal/store"
)

func TestBuildPrompt(t *testing.T) {
	p := buildPrompt("Count centers", nil)
	if !strings.Contains(p, "Count centers") {
		t.Error("prompt missing instruction")
	}
	if !strings.Contains(p, "change_note") {
		t.Error("prompt missing output contract")
	}
	if !strings.Contains(p, "first snapshot") {
		t.Error("prompt should note this is the first snapshot")
	}

	prev := &store.IntelSnapshot{Payload: `{"summary":"40 centers"}`}
	p2 := buildPrompt("Count centers", prev)
	if !strings.Contains(p2, "40 centers") {
		t.Error("prompt should embed previous snapshot payload")
	}
}

func TestParseSnapshot(t *testing.T) {
	cases := []struct {
		name    string
		in      string
		wantErr bool
		summary string
		note    string
	}{
		{
			name:    "fenced json",
			in:      "Here is the result:\n```json\n{\"summary\":\"42 centers\",\"change_note\":\"+2\"}\n```\nDone.",
			summary: "42 centers", note: "+2",
		},
		{
			name:    "bare json",
			in:      `{"summary":"x","metrics":{"n":5},"change_note":"first snapshot"}`,
			summary: "x", note: "first snapshot",
		},
		{name: "garbage", in: "no json here", wantErr: true},
		{name: "empty", in: "", wantErr: true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			snap, err := parseSnapshot(c.in)
			if c.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if snap.Summary != c.summary {
				t.Errorf("summary = %q, want %q", snap.Summary, c.summary)
			}
			if snap.ChangeNote != c.note {
				t.Errorf("change_note = %q, want %q", snap.ChangeNote, c.note)
			}
		})
	}
}
