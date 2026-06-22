package web

import (
	"testing"

	"github.com/mtzanidakis/praktor/internal/config"
	"github.com/mtzanidakis/praktor/internal/extensions"
	"github.com/mtzanidakis/praktor/internal/store"
)

func TestAssembleCapabilitiesRestrictedAndMemory(t *testing.T) {
	a := store.Agent{ID: "coder", Description: "Software engineer"}
	def := config.AgentDefinition{AllowedTools: []string{"Bash", "Read"}, NixEnabled: true}
	mem := &MemoryStats{Count: 7, LastUpdated: "2026-06-20T08:00:00Z", ReportedAt: "2026-06-20T09:00:00Z"}

	got := assembleCapabilities(a, def, "claude-sonnet-4-6", nil, mem)

	if !got.Restricted {
		t.Error("expected Restricted=true when AllowedTools set")
	}
	if got.Memory == nil || got.Memory.Count != 7 {
		t.Errorf("memory = %+v", got.Memory)
	}
	if got.Model != "claude-sonnet-4-6" {
		t.Errorf("model = %q", got.Model)
	}
	// nix_enabled → nix builtin present.
	found := false
	for _, c := range got.Builtin {
		if c.Key == "nix" {
			found = true
		}
	}
	if !found {
		t.Error("nix builtin missing with nix_enabled")
	}
}

func TestAssembleCapabilitiesDefaults(t *testing.T) {
	got := assembleCapabilities(store.Agent{ID: "general"}, config.AgentDefinition{}, "m", nil, nil)

	if got.Restricted {
		t.Error("Restricted should be false with empty AllowedTools")
	}
	if got.Memory != nil {
		t.Error("Memory should be nil when no snapshot")
	}
	// Non-nil empty slices for stable JSON.
	if got.AllowedTools == nil || got.Extensions.MCPServers == nil {
		t.Error("expected non-nil empty slices")
	}
}

func TestAssembleCapabilitiesExtensions(t *testing.T) {
	ext := &extensions.AgentExtensions{
		MCPServers: map[string]extensions.MCPServerConfig{"weather": {Type: "stdio", Command: "x"}},
		Skills:     map[string]extensions.SkillConfig{"writing": {Description: "d", Content: "c"}},
		Plugins:    []extensions.PluginConfig{{Name: "fmt@official"}},
	}
	got := assembleCapabilities(store.Agent{ID: "g"}, config.AgentDefinition{}, "m", ext, nil)

	if len(got.Extensions.MCPServers) != 1 || got.Extensions.MCPServers[0] != "weather" {
		t.Errorf("mcp = %v", got.Extensions.MCPServers)
	}
	if len(got.Extensions.Skills) != 1 || got.Extensions.Plugins[0] != "fmt@official" {
		t.Errorf("ext = %+v", got.Extensions)
	}
}
