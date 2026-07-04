import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import Reception from './Reception';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ items: [] }),
        text: () => Promise.resolve(''),
      })
    )
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('по умолчанию открыта вкладка «Входящие»', async () => {
  render(
    <MemoryRouter initialEntries={['/intake']}>
      <Reception />
    </MemoryRouter>
  );
  await act(() => Promise.resolve());
  expect(screen.getByRole('tab', { name: 'Входящие' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('tab', { name: 'Планы' }).getAttribute('aria-selected')).toBe('false');
});

test('?tab=plans открывает «Планы», клик переключает обратно', async () => {
  render(
    <MemoryRouter initialEntries={['/intake?tab=plans']}>
      <Reception />
    </MemoryRouter>
  );
  await act(() => Promise.resolve());
  expect(screen.getByRole('tab', { name: 'Планы' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByRole('tab', { name: 'Входящие' }));
  await act(() => Promise.resolve());
  expect(screen.getByRole('tab', { name: 'Входящие' }).getAttribute('aria-selected')).toBe('true');
});
