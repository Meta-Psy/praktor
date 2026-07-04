import { render, cleanup } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { Modal } from './Modal';

afterEach(cleanup);

test('открытая модалка блокирует скролл body и возвращает фокус после закрытия', () => {
  const opener = document.createElement('button');
  document.body.appendChild(opener);
  opener.focus();

  const { rerender } = render(
    <Modal open onClose={() => {}} title="Тест"><button>Ок</button></Modal>
  );
  expect(document.body.style.overflow).toBe('hidden');
  expect(document.activeElement?.textContent).toBe('Ок');

  rerender(<Modal open={false} onClose={() => {}} title="Тест"><button>Ок</button></Modal>);
  expect(document.body.style.overflow).toBe('');
  expect(document.activeElement).toBe(opener);

  opener.remove();
});
