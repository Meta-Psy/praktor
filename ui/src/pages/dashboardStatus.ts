import type { IntakeItem } from './intakeStatus';
import { ciLabel, type ProjectStatus } from './projectStatus';
import type { WsEvent } from '../hooks/useWebSocket';

export interface RecentMessage {
  id: string;
  agent: string;
  role: string;
  text: string;
  time: string;
}

export interface StatusData {
  status?: string;
  version?: string;
  active_agents?: number;
  agents_count?: number;
  pending_tasks?: number;
  recent_messages?: RecentMessage[];
}

export interface TaskItem {
  id: string;
  name: string;
  agent_id?: string;
  agent_name?: string;
  status: string;
  last_run?: string;
  last_status?: string;
  last_error?: string;
}

export interface SwarmRunItem {
  id: string;
  name?: string;
  status: string;
}

export type DecisionCard =
  | { kind: 'plan'; key: string; id: string; title: string; project: string; created: string; excerpt: string }
  | { kind: 'pr'; key: string; project: string; repo: string; number: number; title: string; url: string; ci: string }
  | { kind: 'audit'; key: string; project: string; repo: string; number: number; title: string; url: string }
  | { kind: 'failure'; key: string; taskId: string; name: string; agent: string; lastRun: string; error: string };

export interface FeedItem {
  key: string;
  time: string;
  icon: string;
  text: string;
}

const FEED_LIMIT = 30;

export function runningSwarms(swarms: SwarmRunItem[]): number {
  return swarms.filter((s) => s.status === 'running').length;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// buildDecisions собирает карточки «Требует решения» из уже опрошенных источников.
// Порядок: планы на подпись → PR → audit-issues → сбои дежурств.
export function buildDecisions(
  intake: IntakeItem[],
  projects: ProjectStatus[],
  tasks: TaskItem[],
): DecisionCard[] {
  const out: DecisionCard[] = [];
  for (const it of intake) {
    if (it.status !== 'awaiting-approval') continue;
    const lines = it.raw_text.split('\n');
    out.push({
      kind: 'plan',
      key: `plan-${it.id}`,
      id: it.id,
      title: lines[0] || 'Без названия',
      project: it.target_project || '—',
      created: it.created_at.slice(0, 10),
      excerpt: truncate(lines.slice(1).join(' ').trim(), 140),
    });
  }
  for (const p of projects) {
    for (const pr of p.prs ?? []) {
      if (pr.draft) continue;
      out.push({
        kind: 'pr',
        key: `pr-${p.name}-${pr.number}`,
        project: p.name,
        repo: p.repo,
        number: pr.number,
        title: pr.title,
        url: pr.url,
        ci: ciLabel(p.ci),
      });
    }
    for (const iss of p.audit_issues ?? []) {
      out.push({
        kind: 'audit',
        key: `audit-${p.name}-${iss.number}`,
        project: p.name,
        repo: p.repo,
        number: iss.number,
        title: iss.title,
        url: iss.url,
      });
    }
  }
  for (const t of tasks) {
    if (t.last_status !== 'error') continue;
    out.push({
      kind: 'failure',
      key: `fail-${t.id}`,
      taskId: t.id,
      name: t.name,
      agent: t.agent_name || t.agent_id || '—',
      lastRun: t.last_run || '',
      error: t.last_error || '',
    });
  }
  return out;
}

function fmtTime(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function eventToFeedItem(e: WsEvent, agentNames: Record<string, string>): FeedItem | null {
  const data = (e.data ?? {}) as Record<string, unknown>;
  const agent = agentNames[e.agent_id ?? ''] || e.agent_id || 'агент';
  switch (e.type) {
    case 'message': {
      if (data.role !== 'assistant') return null;
      const time = typeof data.time === 'string' && data.time ? data.time : fmtTime(e.timestamp);
      return { key: `msg-${String(data.id)}`, time, icon: '💬', text: `${agent} ответил` };
    }
    case 'agent_started':
      return { key: `as-${e.agent_id}-${e.timestamp}`, time: fmtTime(e.timestamp), icon: '▶', text: `${agent} запущен` };
    case 'agent_stopped':
      return { key: `ap-${e.agent_id}-${e.timestamp}`, time: fmtTime(e.timestamp), icon: '⏹', text: `${agent} остановлен` };
    case 'task_executed': {
      const ok = data.status === 'success';
      return {
        key: `te-${String(data.id)}-${e.timestamp}`,
        time: fmtTime(e.timestamp),
        icon: '⏰',
        text: `дежурство «${String(data.name ?? '')}»: ${ok ? 'успех' : 'сбой'}`,
      };
    }
    case 'swarm_started': {
      const nm = typeof data.name === 'string' && data.name ? `«${data.name}» ` : '';
      return { key: `sws-${e.timestamp}`, time: fmtTime(e.timestamp), icon: '🐝', text: `отряд ${nm}запущен` };
    }
    case 'swarm_agent_completed':
      return {
        key: `swa-${String(data.role)}-${e.timestamp}`,
        time: fmtTime(e.timestamp),
        icon: '🐝',
        text: `отряд: ${String(data.role ?? 'агент')} завершил (${data.status === 'error' ? 'сбой' : 'успех'})`,
      };
    case 'swarm_completed':
      return { key: `swc-${e.timestamp}`, time: fmtTime(e.timestamp), icon: '🐝', text: 'отряд завершён' };
    case 'swarm_failed':
      return { key: `swf-${e.timestamp}`, time: fmtTime(e.timestamp), icon: '🐝', text: 'отряд: сбой' };
    default:
      return null;
  }
}

// buildFeed строит ленту «Активность»: seed из /api/status (история из БД,
// новыми вперёд) + живые WS-события (в порядке поступления). Новые сверху,
// дубликаты сообщений (seed ∩ WS) схлопываются по key, максимум FEED_LIMIT.
export function buildFeed(
  seed: RecentMessage[],
  events: WsEvent[],
  agentNames: Record<string, string>,
): FeedItem[] {
  const items: FeedItem[] = [];
  // seed разворачиваем в хронологию, чтобы после общего разворота новые были сверху
  for (const m of [...seed].reverse()) {
    if (m.role !== 'assistant') continue;
    items.push({ key: `msg-${m.id}`, time: m.time, icon: '💬', text: `${m.agent} ответил` });
  }
  for (const e of events) {
    const it = eventToFeedItem(e, agentNames);
    if (it) items.push(it);
  }
  const seen = new Set<string>();
  const out: FeedItem[] = [];
  for (let i = items.length - 1; i >= 0 && out.length < FEED_LIMIT; i--) {
    if (seen.has(items[i].key)) continue;
    seen.add(items[i].key);
    out.push(items[i]);
  }
  return out;
}
