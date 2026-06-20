package web

import (
	"sort"

	"github.com/mtzanidakis/praktor/internal/capabilities"
	"github.com/mtzanidakis/praktor/internal/config"
	"github.com/mtzanidakis/praktor/internal/extensions"
	"github.com/mtzanidakis/praktor/internal/store"
)

// MemoryStats is the per-agent memory summary surfaced in the catalog.
type MemoryStats struct {
	Count       int    `json:"count"`
	LastUpdated string `json:"last_updated,omitempty"`
	ReportedAt  string `json:"reported_at"`
}

// ExtensionsSummary lists the names of user-added extensions for an agent.
type ExtensionsSummary struct {
	MCPServers []string `json:"mcp_servers"`
	Skills     []string `json:"skills"`
	Plugins    []string `json:"plugins"`
}

// AgentCapabilities is one agent's read-only catalog entry.
type AgentCapabilities struct {
	AgentID      string                    `json:"agent_id"`
	Description  string                    `json:"description"`
	Model        string                    `json:"model"`
	Builtin      []capabilities.Capability `json:"builtin"`
	Extensions   ExtensionsSummary         `json:"extensions"`
	AllowedTools []string                  `json:"allowed_tools"`
	Restricted   bool                      `json:"restricted"`
	Memory       *MemoryStats              `json:"memory"`
}

// CatalogResponse is the GET /api/agents/capabilities body.
type CatalogResponse struct {
	UserProfilePresent bool                `json:"user_profile_present"`
	Agents             []AgentCapabilities `json:"agents"`
}

// assembleCapabilities builds one agent's entry from its definition, extensions,
// and optional memory snapshot. Pure — no I/O — so it is unit-testable.
func assembleCapabilities(a store.Agent, def config.AgentDefinition, model string, ext *extensions.AgentExtensions, mem *MemoryStats) AgentCapabilities {
	exts := ExtensionsSummary{MCPServers: []string{}, Skills: []string{}, Plugins: []string{}}
	if ext != nil {
		for name := range ext.MCPServers {
			exts.MCPServers = append(exts.MCPServers, name)
		}
		for name := range ext.Skills {
			exts.Skills = append(exts.Skills, name)
		}
		for _, p := range ext.Plugins {
			exts.Plugins = append(exts.Plugins, p.Name)
		}
	}
	sort.Strings(exts.MCPServers)
	sort.Strings(exts.Skills)
	sort.Strings(exts.Plugins)

	allowed := def.AllowedTools
	if allowed == nil {
		allowed = []string{}
	}

	return AgentCapabilities{
		AgentID:      a.ID,
		Description:  a.Description,
		Model:        model,
		Builtin:      capabilities.ForAgent(def),
		Extensions:   exts,
		AllowedTools: allowed,
		Restricted:   len(def.AllowedTools) > 0,
		Memory:       mem,
	}
}
