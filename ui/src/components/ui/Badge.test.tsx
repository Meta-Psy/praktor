import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { Badge } from './Badge';

afterEach(cleanup);

test('tone задаёт класс', () => {
  render(<Badge tone="ok">вкл</Badge>);
  expect(screen.getByText('вкл').className).toContain('ui-badge--ok');
});

test('neutral по умолчанию', () => {
  render(<Badge>выкл</Badge>);
  expect(screen.getByText('выкл').className).toContain('ui-badge--neutral');
});
