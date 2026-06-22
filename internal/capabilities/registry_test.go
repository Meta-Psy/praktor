package capabilities

import (
	"testing"

	"github.com/mtzanidakis/praktor/internal/config"
)

func keys(caps []Capability) map[string]bool {
	m := make(map[string]bool, len(caps))
	for _, c := range caps {
		m[c.Key] = true
	}
	return m
}

func TestForAgentFiltersConditional(t *testing.T) {
	// Plain agent: no nix, no email.
	plain := ForAgent(config.AgentDefinition{})
	k := keys(plain)
	if !k["memory"] || !k["tasks"] || !k["web"] || !k["browser"] {
		t.Fatalf("plain agent missing always-on caps: %v", k)
	}
	if k["nix"] {
		t.Errorf("nix present without nix_enabled")
	}
	if k["email"] {
		t.Errorf("email present without agentmail_inbox_id")
	}

	// Nix + email enabled.
	full := ForAgent(config.AgentDefinition{NixEnabled: true, AgentMailInboxID: "inbox_123"})
	kf := keys(full)
	if !kf["nix"] {
		t.Errorf("nix missing with nix_enabled=true")
	}
	if !kf["email"] {
		t.Errorf("email missing with agentmail_inbox_id set")
	}
}

func TestMemoryCapabilityHasTools(t *testing.T) {
	for _, c := range ForAgent(config.AgentDefinition{}) {
		if c.Key == "memory" {
			if len(c.Tools) == 0 {
				t.Fatal("memory capability has no tools listed")
			}
			return
		}
	}
	t.Fatal("memory capability not found")
}
