// Package capabilities holds the static registry of built-in agent
// capabilities surfaced read-only in the Mission Control catalog (S4).
package capabilities

import "github.com/mtzanidakis/praktor/internal/config"

// Capability is one built-in capability available to an agent.
type Capability struct {
	Key         string   `json:"key"`
	Label       string   `json:"label"`
	Group       string   `json:"group"`
	Tools       []string `json:"tools,omitempty"`
	Conditional string   `json:"-"` // "" | "nix_enabled" | "agentmail_inbox_id"
}

// Builtins is the static set every agent gets; some are gated per-agent via
// Conditional. Mirrors the MCP servers registered in agent-runner/src/index.ts
// plus always-on web/browser tools.
var Builtins = []Capability{
	{Key: "tasks", Label: "Scheduled Tasks", Group: "tasks", Tools: []string{"scheduled_task_create", "scheduled_task_list", "scheduled_task_delete"}},
	{Key: "profile", Label: "User Profile", Group: "profile", Tools: []string{"user_profile_read", "user_profile_update"}},
	{Key: "memory", Label: "Memory", Group: "memory", Tools: []string{"memory_store", "memory_recall", "memory_list", "memory_delete", "memory_forget"}},
	{Key: "file", Label: "File Send", Group: "files", Tools: []string{"file_send"}},
	{Key: "history", Label: "History Search", Group: "history", Tools: []string{"search_history"}},
	{Key: "web", Label: "Web Access", Group: "web", Tools: []string{"WebSearch", "WebFetch"}},
	{Key: "browser", Label: "Browser Automation", Group: "browser", Tools: []string{"agent-browser"}},
	{Key: "nix", Label: "Nix Packages", Group: "nix", Tools: []string{"nix_search", "nix_add", "nix_list_installed", "nix_remove", "nix_upgrade"}, Conditional: "nix_enabled"},
	{Key: "email", Label: "Email (AgentMail)", Group: "email", Conditional: "agentmail_inbox_id"},
}

// ForAgent returns the built-in capabilities for an agent, dropping conditional
// ones whose enabling flag is unset.
func ForAgent(def config.AgentDefinition) []Capability {
	out := make([]Capability, 0, len(Builtins))
	for _, c := range Builtins {
		switch c.Conditional {
		case "nix_enabled":
			if !def.NixEnabled {
				continue
			}
		case "agentmail_inbox_id":
			if def.AgentMailInboxID == "" {
				continue
			}
		}
		out = append(out, c)
	}
	return out
}
