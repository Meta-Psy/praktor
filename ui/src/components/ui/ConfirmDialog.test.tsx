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

test('клик по фону вызывает onCancel', () => {
  const onCancel = vi.fn();
  render(<ConfirmDialog open title="Удалить?" onConfirm={() => {}} onCancel={onCancel} />);
  fireEvent.click(document.querySelector('.ui-modal-backdrop')!);
  expect(onCancel).toHaveBeenCalledOnce();
});

test('busy: Escape и фон не закрывают', () => {
  const onCancel = vi.fn();
  render(<ConfirmDialog open busy title="Удаление…" onConfirm={() => {}} onCancel={onCancel} />);
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(document.querySelector('.ui-modal-backdrop')!);
  expect(onCancel).not.toHaveBeenCalled();
});

test('confirmDisabled блокирует кнопку подтверждения', () => {
  const onConfirm = vi.fn();
  render(
    <ConfirmDialog open title="Отклонить план?" confirmLabel="Отклонить" confirmDisabled onConfirm={onConfirm} onCancel={() => {}} />
  );
  const btn = screen.getByRole('button', { name: 'Отклонить' });
  expect(btn).toBeDisabled();
  fireEvent.click(btn);
  expect(onConfirm).not.toHaveBeenCalled();
});
