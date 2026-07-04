import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { ToastProvider, useToast } from './Toast';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Demo() {
  const toast = useToast();
  return (
    <>
      <button onClick={() => toast.error('Не удалось сохранить')}>fire</button>
      <button onClick={() => toast.success('Сохранено')}>ok</button>
    </>
  );
}

test('показывает сообщение об ошибке', () => {
  render(
    <ToastProvider>
      <Demo />
    </ToastProvider>
  );
  fireEvent.click(screen.getByText('fire'));
  expect(screen.getByText('Не удалось сохранить')).toBeInTheDocument();
});

test('одинаковые ошибки не дублируются', () => {
  render(
    <ToastProvider>
      <Demo />
    </ToastProvider>
  );
  fireEvent.click(screen.getByText('fire'));
  fireEvent.click(screen.getByText('fire'));
  expect(screen.getAllByText('Не удалось сохранить')).toHaveLength(1);
});

test('ошибка помечена role=alert', () => {
  render(
    <ToastProvider>
      <Demo />
    </ToastProvider>
  );
  fireEvent.click(screen.getByText('fire'));
  expect(screen.getByRole('alert').textContent).toBe('Не удалось сохранить');
});

test('success живёт 4с (role=status), error переживает его и снимается через 8с', () => {
  vi.useFakeTimers();
  render(
    <ToastProvider>
      <Demo />
    </ToastProvider>
  );
  fireEvent.click(screen.getByText('ok'));
  fireEvent.click(screen.getByText('fire'));
  expect(screen.getByRole('status').textContent).toBe('Сохранено');

  act(() => { vi.advanceTimersByTime(4000); });
  expect(screen.queryByText('Сохранено')).toBeNull();
  expect(screen.getByText('Не удалось сохранить')).toBeInTheDocument();

  act(() => { vi.advanceTimersByTime(4000); });
  expect(screen.queryByText('Не удалось сохранить')).toBeNull();
});
