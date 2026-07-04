import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { ToastProvider, useToast } from './Toast';

afterEach(cleanup);

function Demo() {
  const toast = useToast();
  return (
    <button onClick={() => toast.error('Не удалось сохранить')}>fire</button>
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
