import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ToastProvider } from '../components/ui';
import { IntakeContent } from './Intake';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify({ items: [] }))))
  );
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(() => Promise.reject(new Error('Permission denied'))) },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('отказ в доступе к микрофону показывает тост, а не молчит', async () => {
  render(
    <ToastProvider>
      <IntakeContent />
    </ToastProvider>
  );
  fireEvent.click(screen.getByText('🎙 Запись'));
  expect(await screen.findByText('Микрофон недоступен: Permission denied')).toBeInTheDocument();
});
