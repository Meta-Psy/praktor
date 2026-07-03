import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { Tabs } from './Tabs';

afterEach(cleanup);

const tabs = [
  { id: 'inbox', label: 'Входящие' },
  { id: 'plans', label: 'Планы' },
];

test('активная вкладка помечена aria-selected', () => {
  render(<Tabs tabs={tabs} active="plans" onChange={() => {}} />);
  expect(screen.getByRole('tab', { name: 'Планы' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('tab', { name: 'Входящие' }).getAttribute('aria-selected')).toBe('false');
});

test('клик зовёт onChange с id', () => {
  const onChange = vi.fn();
  render(<Tabs tabs={tabs} active="inbox" onChange={onChange} />);
  fireEvent.click(screen.getByRole('tab', { name: 'Планы' }));
  expect(onChange).toHaveBeenCalledWith('plans');
});
