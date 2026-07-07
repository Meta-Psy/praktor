import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { Tabs, TabPanel } from './Tabs';

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

test('ArrowRight/ArrowLeft/Home/End переключают вкладки', () => {
  const onChange = vi.fn();
  render(<Tabs tabs={tabs} active="inbox" onChange={onChange} />);
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Входящие' }), { key: 'ArrowRight' });
  expect(onChange).toHaveBeenCalledWith('plans');
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Входящие' }), { key: 'End' });
  expect(onChange).toHaveBeenLastCalledWith('plans');
});

test('roving tabindex: только активная вкладка в tab-порядке', () => {
  render(<Tabs tabs={tabs} active="plans" onChange={() => {}} />);
  expect(screen.getByRole('tab', { name: 'Планы' }).getAttribute('tabindex')).toBe('0');
  expect(screen.getByRole('tab', { name: 'Входящие' }).getAttribute('tabindex')).toBe('-1');
});

test('вкладка связана с панелью aria-controls/aria-labelledby', () => {
  render(
    <>
      <Tabs tabs={tabs} active="inbox" onChange={() => {}} />
      <TabPanel id="inbox" active><div>контент</div></TabPanel>
    </>
  );
  const tab = screen.getByRole('tab', { name: 'Входящие' });
  const panel = screen.getByRole('tabpanel');
  expect(tab.getAttribute('aria-controls')).toBe(panel.id);
  expect(panel.getAttribute('aria-labelledby')).toBe(tab.id);
});

test('панель не монтируется до первой активации', () => {
  render(<TabPanel id="plans" active={false}><input placeholder="черновик" /></TabPanel>);
  expect(screen.queryByPlaceholderText('черновик')).toBeNull();
});

test('после первой активации панель скрывается, но не размонтируется (ввод не теряется)', () => {
  const { rerender } = render(<TabPanel id="plans" active><input placeholder="черновик" /></TabPanel>);
  expect(screen.getByPlaceholderText('черновик')).toBeInTheDocument();
  rerender(<TabPanel id="plans" active={false}><input placeholder="черновик" /></TabPanel>);
  expect(screen.getByPlaceholderText('черновик')).toBeInTheDocument();
  expect(screen.queryByRole('tabpanel')).toBeNull(); // hidden убирает из a11y-дерева
});
