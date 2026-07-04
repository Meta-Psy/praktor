import { render, screen, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import Recon from './Recon';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ items: [], sources: [] }),
      })
    )
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('по умолчанию открыта вкладка «Радар»', async () => {
  render(
    <MemoryRouter initialEntries={['/radar']}>
      <Recon />
    </MemoryRouter>
  );
  await act(() => Promise.resolve());
  expect(screen.getByRole('tab', { name: 'Радар' }).getAttribute('aria-selected')).toBe('true');
});

test('?tab=intel открывает «Сводки»', async () => {
  render(
    <MemoryRouter initialEntries={['/radar?tab=intel']}>
      <Recon />
    </MemoryRouter>
  );
  await act(() => Promise.resolve());
  expect(screen.getByRole('tab', { name: 'Сводки' }).getAttribute('aria-selected')).toBe('true');
});
