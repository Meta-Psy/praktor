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

test('повтор той же ошибки продлевает TTL', () => {
  vi.useFakeTimers();
  render(
    <ToastProvider>
      <Demo />
    </ToastProvider>
  );
  fireEvent.click(screen.getByText('fire'));           // t=0, TTL error = 8000
  act(() => { vi.advanceTimersByTime(5000); });        // t=5000
  fireEvent.click(screen.getByText('fire'));           // повтор — TTL должен перезапуститься
  act(() => { vi.advanceTimersByTime(4000); });        // t=9000 (> исходных 8000)
  expect(screen.getByText('Не удалось сохранить')).toBeInTheDocument();
  act(() => { vi.advanceTimersByTime(4000); });        // t=13000 = 5000+8000
  expect(screen.queryByText('Не удалось сохранить')).toBeNull();
});
