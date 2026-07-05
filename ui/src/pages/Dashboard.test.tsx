import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ToastProvider } from '../components/ui';
import { WebSocketProvider } from '../contexts/WebSocketContext';
import Dashboard from './Dashboard';

class FakeWebSocket {
  static OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: unknown) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close() {}
}

const statusData = {
  status: 'ok', version: 'v1.8', active_agents: 2, agents_count: 3,
  pending_tasks: 4, recent_messages: [],
};
const failedTask = {
  id: 't1', name: 'Утренняя сводка', status: 'active', enabled: true,
  schedule: '', last_status: 'error', last_error: 'AgentMail API: 401',
  last_run: '08:00', agent_name: 'mail',
};
const plan = {
  id: 'p1', source: 'web', raw_text: 'Скрейпер v2\nдетали плана',
  status: 'awaiting-approval', created_at: '2026-07-04T22:40:00Z',
  updated_at: '2026-07-04T22:40:00Z', target_project: 'mentis-vuzy-db',
};
const project = {
  name: 'praktor', repo: 'Meta-Psy/praktor', ci: { conclusion: 'success' },
  deploy: { ok: true, code: 200 },
  prs: [{ number: 14, title: 'feat: сводки', url: 'https://github.com/x/14', draft: false }],
};

let fetchMock: ReturnType<typeof vi.fn>;

function stubFetch(over: Record<string, unknown> = {}) {
  const routes: Record<string, unknown> = {
    '/api/status': statusData,
    '/api/tasks': [failedTask],
    '/api/projects': [project],
    '/api/intake': { items: [plan] },
    '/api/swarms': [],
    '/api/agents/definitions': [],
    ...over,
  };
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return Promise.resolve(new Response('{}'));
    const body = url in routes ? routes[url] : {};
    return Promise.resolve(new Response(JSON.stringify(body)));
  });
  vi.stubGlobal('fetch', fetchMock);
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  stubFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <WebSocketProvider>
        <ToastProvider>
          <Dashboard />
        </ToastProvider>
      </WebSocketProvider>
    </MemoryRouter>
  );
}

test('рендерит чипы и карточки всех типов', async () => {
  renderPage();
  expect(await screen.findByText('Скрейпер v2')).toBeTruthy();          // план
  expect(screen.getByText('#14 feat: сводки')).toBeTruthy();            // PR
  expect(screen.getByText(/Утренняя сводка/)).toBeTruthy();             // сбой
  expect(screen.getByText(/Агенты в работе/)).toBeTruthy();             // чип
});

test('«Подписать» шлёт approve только после подтверждения', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Подписать' }));

  const posts = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'POST');
  expect(posts()).toHaveLength(0); // диалог открыт, POST ещё не ушёл

  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Подписать' }));
  await waitFor(() => {
    expect(posts().map(([u]) => u)).toContain('/api/intake/p1/approve');
  });
});

test('«Повторить сейчас» шлёт POST /api/tasks/{id}/run', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Повторить сейчас' }));
  await waitFor(() => {
    const posts = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'POST');
    expect(posts.map(([u]) => u)).toContain('/api/tasks/t1/run');
  });
});

test('пусто → «Всё разобрано ✓»', async () => {
  stubFetch({ '/api/tasks': [], '/api/projects': [], '/api/intake': { items: [] } });
  renderPage();
  expect(await screen.findByText('Всё разобрано ✓')).toBeTruthy();
});
