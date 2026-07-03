import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
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
