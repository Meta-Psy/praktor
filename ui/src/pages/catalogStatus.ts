export interface Capability {
  key: string;
  label: string;
  group: string;
  tools?: string[];
}

export interface MemoryStats {
  count: number;
  last_updated?: string;
  reported_at: string;
}

export interface AgentCapabilities {
  agent_id: string;
  description: string;
  model: string;
  builtin: Capability[];
  extensions: { mcp_servers: string[]; skills: string[]; plugins: string[] };
  allowed_tools: string[];
  restricted: boolean;
  memory: MemoryStats | null;
}

export interface CatalogResponse {
  user_profile_present: boolean;
  agents: AgentCapabilities[];
}

// formatMemory renders the one-line memory summary for an agent card.
export function formatMemory(mem: MemoryStats | null): string {
  if (!mem) return 'нет данных';
  const when = mem.last_updated ? ` · ${mem.last_updated.slice(0, 10)}` : '';
  return `${mem.count} записей${when}`;
}

// capabilityGroups returns the distinct capability group labels for chips.
export function capabilityGroups(agent: AgentCapabilities): string[] {
  return agent.builtin.map((c) => c.group);
}
