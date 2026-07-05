import { describe, expect, test } from 'vitest';
import {
  buildDecisions, buildFeed, runningSwarms,
  type RecentMessage, type TaskItem,
} from '../dashboardStatus';
import type { IntakeItem } from '../intakeStatus';
import type { ProjectStatus } from '../projectStatus';
import type { WsEvent } from '../../hooks/useWebSocket';

const intakeItem = (over: Partial<IntakeItem>): IntakeItem => ({
  id: 'i1', source: 'web', raw_text: 'Задача', status: 'awaiting-approval',
  created_at: '2026-07-04T22:40:00Z', updated_at: '2026-07-04T22:40:00Z', ...over,
});

const project = (over: Partial<ProjectStatus>): ProjectStatus => ({
  name: 'praktor', repo: 'Meta-Psy/praktor', ci: { conclusion: 'success' }, deploy: { ok: true }, ...over,
});

const task = (over: Partial<TaskItem>): TaskItem => ({
  id: 't1', name: 'Сводка', status: 'active', ...over,
});

const ev = (type: string, data: unknown, over: Partial<WsEvent> = {}): WsEvent => ({
  type, data, timestamp: '2026-07-05T08:00:00Z', ...over,
});

describe('buildDecisions', () => {
  test('план: только awaiting-approval, заголовок и выдержка из raw_text', () => {
    const out = buildDecisions(
      [
        intakeItem({ id: 'a', raw_text: 'Скрейпер v2\nмигрируем на Playwright', target_project: 'mentis' }),
        intakeItem({ id: 'b', status: 'in_progress' }),
      ],
      [], [],
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: 'plan', id: 'a', title: 'Скрейпер v2',
      project: 'mentis', created: '2026-07-04', excerpt: 'мигрируем на Playwright',
    });
  });

  test('PR: draft пропускается, ci — проектный лейбл', () => {
    const out = buildDecisions([], [project({
      prs: [
        { number: 14, title: 'feat: x', url: 'https://g/14', draft: false },
        { number: 15, title: 'wip', url: 'https://g/15', draft: true },
      ],
    })], []);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'pr', number: 14, repo: 'Meta-Psy/praktor', ci: '✓ passing' });
  });

  test('audit-issue даёт карточку', () => {
    const out = buildDecisions([], [project({
      audit_issues: [{ number: 7, title: 'self-improve', url: 'https://g/7' }],
    })], []);
    expect(out).toEqual([expect.objectContaining({ kind: 'audit', number: 7 })]);
  });

  test('сбой: только last_status === error', () => {
    const out = buildDecisions([], [], [
      task({ id: 'bad', last_status: 'error', last_error: '401', agent_name: 'mail', last_run: '08:00' }),
      task({ id: 'good', last_status: 'success' }),
      task({ id: 'never' }),
    ]);
    expect(out).toEqual([expect.objectContaining({
      kind: 'failure', taskId: 'bad', error: '401', agent: 'mail', lastRun: '08:00',
    })]);
  });

  test('порядок: планы → PR → аудит → сбои; ключи уникальны', () => {
    const out = buildDecisions(
      [intakeItem({})],
      [project({
        prs: [{ number: 1, title: 'a', url: 'u', draft: false }],
        audit_issues: [{ number: 2, title: 'b', url: 'u' }],
      })],
      [task({ last_status: 'error' })],
    );
    expect(out.map((c) => c.kind)).toEqual(['plan', 'pr', 'audit', 'failure']);
    expect(new Set(out.map((c) => c.key)).size).toBe(4);
  });
});

describe('buildFeed', () => {
  const seed: RecentMessage[] = [
    { id: '2', agent: 'dev', role: 'assistant', text: 'готово', time: '07:10' },  // новее
    { id: '1', agent: 'mail', role: 'user', text: 'привет', time: '07:00' },
  ];

  test('seed: только ответы агентов, новые сверху', () => {
    const out = buildFeed(seed, [], {});
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ key: 'msg-2', text: 'dev ответил', time: '07:10' });
  });

  test('WS message дедуплицируется с seed по id', () => {
    const out = buildFeed(seed, [
      ev('message', { id: '2', role: 'assistant', text: 'готово', time: '07:10' }, { agent_id: 'dev' }),
    ], { dev: 'dev' });
    expect(out.filter((i) => i.key === 'msg-2')).toHaveLength(1);
  });

  test('маппинг типов: task_executed, agent_started, swarm_failed; неизвестный тип пропускается', () => {
    const out = buildFeed([], [
      ev('task_executed', { id: 't1', name: 'Сводка', status: 'error' }),
      ev('agent_started', {}, { agent_id: 'dev' }),
      ev('swarm_failed', { error: 'boom' }),
      ev('unknown_event', {}),
    ], { dev: 'Разработчик' });
    expect(out.map((i) => i.text)).toEqual([
      'отряд: сбой',
      'Разработчик запущен',
      'дежурство «Сводка»: сбой',
    ]);
  });

  test('message с role=user в ленту не попадает', () => {
    const out = buildFeed([], [ev('message', { id: '9', role: 'user', text: 'q', time: '10:00' })], {});
    expect(out).toHaveLength(0);
  });

  test('лента ограничена 30 элементами, новые сверху', () => {
    const events = Array.from({ length: 40 }, (_, i) =>
      ev('message', { id: String(i), role: 'assistant', text: 'x', time: '10:00' }, { agent_id: 'dev' }));
    const out = buildFeed([], events, {});
    expect(out).toHaveLength(30);
    expect(out[0].key).toBe('msg-39');
  });
});

test('runningSwarms считает только running', () => {
  expect(runningSwarms([
    { id: 'a', status: 'running' },
    { id: 'b', status: 'completed' },
    { id: 'c', status: 'running' },
  ])).toBe(2);
});
