package radar

import (
	"strings"
	"testing"

	"github.com/mtzanidakis/praktor/internal/store"
)

func TestBuildDigestPrompt(t *testing.T) {
	items := []store.RadarItem{
		{FullName: "o/alpha", Name: "alpha", Description: "an mcp server", Stars: 120, HTMLURL: "https://github.com/o/alpha"},
		{FullName: "o/beta", Name: "beta", Description: "a skill", Stars: 30, HTMLURL: "https://github.com/o/beta"},
	}
	p := buildDigestPrompt(items)
	for _, want := range []string{"o/alpha", "120", "o/beta", "an mcp server"} {
		if !strings.Contains(p, want) {
			t.Errorf("prompt missing %q\n%s", want, p)
		}
	}
}

func TestBuildDigestPromptEmpty(t *testing.T) {
	if buildDigestPrompt(nil) != "" {
		t.Error("empty items should yield empty prompt")
	}
}
