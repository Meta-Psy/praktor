import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { Button } from './Button';

afterEach(cleanup);

test('рендерит текст и variant-класс', () => {
  render(<Button variant="danger">Удалить</Button>);
  const btn = screen.getByRole('button', { name: 'Удалить' });
  expect(btn.className).toContain('ui-btn--danger');
});

test('primary по умолчанию', () => {
  render(<Button>Ок</Button>);
  expect(screen.getByRole('button').className).toContain('ui-btn--primary');
});

test('busy блокирует кнопку', () => {
  render(<Button busy>Сохранить</Button>);
  expect(screen.getByRole('button')).toBeDisabled();
});

test('busy не пропускает клики', () => {
  const onClick = vi.fn();
  render(<Button busy onClick={onClick}>Сохранить</Button>);
  fireEvent.click(screen.getByRole('button'));
  expect(onClick).not.toHaveBeenCalled();
});
