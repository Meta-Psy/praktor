import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ToastProvider } from '../components/ui';
import { WebSocketProvider } from '../contexts/WebSocketContext';
import Conversations from './Conversations';

class FakeWebSocket {
  static OPEN = 1;
  static last: FakeWebSocket | null = null;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeWebSocket.last = this;
  }
  close() {}
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  fetchMock = vi.fn((url: string) => {
    if (url === '/api/agents/definitions') {
      return Promise.resolve(new Response(JSON.stringify([{ id: 'a1', name: 'Alpha' }])));
    }
    if (url === '/api/agents') {
      return Promise.resolve(new Response(JSON.stringify([])));
    }
    if (url === '/api/agents/definitions/a1/messages') {
      return Promise.resolve(new Response(JSON.stringify([])));
    }
    return Promise.resolve(new Response('{}'));
  });
  vi.stubGlobal('fetch', fetchMock);
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPage() {
  return render(
    <WebSocketProvider>
      <ToastProvider>
        <Conversations />
      </ToastProvider>
    </WebSocketProvider>
  );
}

test('Enter отправляет сообщение, очищает поле и включает «печатает…»', async () => {
  renderPage();
  const input = await screen.findByPlaceholderText('Сообщение агенту…');
  fireEvent.change(input, { target: { value: 'привет' } });
  fireEvent.keyDown(input, { key: 'Enter' });

  await waitFor(() => {
    const post = fetchMock.mock.calls.find(
      ([url, init]) => url === '/api/agents/definitions/a1/message' && init?.method === 'POST'
    );
    expect(post).toBeTruthy();
    expect(JSON.parse(post![1].body as string)).toEqual({ text: 'привет' });
  });
  expect(await screen.findByText('печатает…')).toBeTruthy();
  expect((input as HTMLTextAreaElement).value).toBe('');
});

test('Shift+Enter не отправляет', async () => {
  renderPage();
  const input = await screen.findByPlaceholderText('Сообщение агенту…');
  fireEvent.change(input, { target: { value: 'строка' } });
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});

test('ответ агента по WS появляется в ленте и снимает «печатает…»', async () => {
  renderPage();
  const input = await screen.findByPlaceholderText('Сообщение агенту…');
  fireEvent.change(input, { target: { value: 'привет' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await screen.findByText('печатает…');

  act(() => {
    FakeWebSocket.last?.onmessage?.({
      data: JSON.stringify({
        type: 'message',
        agent_id: 'a1',
        timestamp: '2026-07-05T12:00:00Z',
        data: { id: 7, role: 'assistant', text: 'здравствуйте', time: '12:00' },
      }),
    });
  });

  expect(await screen.findByText('здравствуйте')).toBeTruthy();
  expect(screen.queryByText('печатает…')).toBeNull();
});

test('батч из двух WS-сообщений обрабатывается целиком', async () => {
  renderPage();
  await screen.findByPlaceholderText('Сообщение агенту…');

  act(() => {
    FakeWebSocket.last?.onmessage?.({
      data: JSON.stringify({
        type: 'message',
        agent_id: 'a1',
        timestamp: '2026-07-05T12:00:00Z',
        data: { id: 7, role: 'assistant', text: 'первое сообщение', time: '12:00' },
      }),
    });
    FakeWebSocket.last?.onmessage?.({
      data: JSON.stringify({
        type: 'message',
        agent_id: 'a1',
        timestamp: '2026-07-05T12:00:01Z',
        data: { id: 8, role: 'assistant', text: 'второе сообщение', time: '12:00' },
      }),
    });
  });

  expect(await screen.findByText('первое сообщение')).toBeTruthy();
  expect(await screen.findByText('второе сообщение')).toBeTruthy();
});

test('agent_stopped снимает «печатает…» даже без message-события', async () => {
  renderPage();
  const input = await screen.findByPlaceholderText('Сообщение агенту…');
  fireEvent.change(input, { target: { value: 'долгий запрос' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await screen.findByText('печатает…');

  act(() => {
    FakeWebSocket.last?.onmessage?.({
      data: JSON.stringify({
        type: 'agent_stopped',
        agent_id: 'a1',
        timestamp: '2026-07-05T12:00:02Z',
      }),
    });
  });

  await waitFor(() => {
    expect(screen.queryByText('печатает…')).toBeNull();
  });
});

test('кнопка «Отменить» шлёт abort и снимает индикатор', async () => {
  renderPage();
  const input = await screen.findByPlaceholderText('Сообщение агенту…');
  fireEvent.change(input, { target: { value: 'долгий запрос' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  const cancel = await screen.findByRole('button', { name: 'Отменить' });
  fireEvent.click(cancel);

  await waitFor(() => {
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => url === '/api/agents/definitions/a1/abort' && init?.method === 'POST'
      )
    ).toBe(true);
    expect(screen.queryByText('печатает…')).toBeNull();
  });
});
