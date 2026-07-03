import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

afterEach(cleanup);

test('closed — ничего не рендерит', () => {
  render(
    <ConfirmDialog open={false} title="Удалить?" onConfirm={() => {}} onCancel={() => {}} />
  );
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('confirm вызывает onConfirm', () => {
  const onConfirm = vi.fn();
  render(
    <ConfirmDialog open title="Удалить отряд?" confirmLabel="Удалить" danger onConfirm={onConfirm} onCancel={() => {}} />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
  expect(onConfirm).toHaveBeenCalledOnce();
});

test('Escape вызывает onCancel', () => {
  const onCancel = vi.fn();
  render(<ConfirmDialog open title="Удалить?" onConfirm={() => {}} onCancel={onCancel} />);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onCancel).toHaveBeenCalledOnce();
});
