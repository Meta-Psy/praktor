import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ToastProvider } from '../components/ui';
import { WebSocketProvider } from '../contexts/WebSocketContext';
import Tasks from './Tasks';

class FakeWebSocket {
  static OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: unknown) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close() {}
}

const task = {
  id: 't1',
  name: 'Сводка',
  schedule: '{"kind":"cron","cron_expr":"0 9 * * *"}',
  schedule_display: '0 9 * * *',
  enabled: true,
  status: 'active',
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/tasks' && !init?.method) {
      return Promise.resolve(new Response(JSON.stringify([task])));
    }
    if (url === '/api/agents/definitions') {
      return Promise.resolve(new Response(JSON.stringify([])));
    }
    return Promise.resolve(new Response('{}'));
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPage() {
  return render(
    <WebSocketProvider>
      <ToastProvider>
        <Tasks />
      </ToastProvider>
    </WebSocketProvider>
  );
}

test('удаление идёт через ConfirmDialog, DELETE только после подтверждения', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Удалить' }));

  // диалог открыт, DELETE ещё не ушёл
  const dialog = screen.getByRole('dialog');
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(0);

  fireEvent.click(within(dialog).getByRole('button', { name: 'Удалить' }));
  await waitFor(() => {
    const del = fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE');
    expect(del).toHaveLength(1);
    expect(del[0][0]).toBe('/api/tasks/t1');
  });
});
