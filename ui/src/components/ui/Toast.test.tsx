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
