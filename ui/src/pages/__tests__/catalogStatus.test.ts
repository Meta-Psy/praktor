import { describe, it, expect } from 'vitest';
import { formatMemory, type AgentCapabilities } from '../catalogStatus';

const base: AgentCapabilities = {
  agent_id: 'a', description: '', model: 'm',
  builtin: [], extensions: { mcp_servers: [], skills: [], plugins: [] },
  allowed_tools: [], restricted: false, memory: null,
};

describe('formatMemory', () => {
  it('reports no data when memory is null', () => {
    expect(formatMemory(base.memory)).toBe('нет данных');
  });
  it('summarises count and date when present', () => {
    const out = formatMemory({ count: 47, last_updated: '2026-06-18T08:00:00Z', reported_at: '2026-06-20T09:00:00Z' });
    expect(out).toContain('47');
  });
});
