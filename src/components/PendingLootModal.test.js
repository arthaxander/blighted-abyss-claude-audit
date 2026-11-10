import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import PendingLootModal from './PendingLootModal';
// Existing reward-selection tests focus on inventory/selection behavior.
// The asynchronous art gate is verified in LootArtworkGate.test.js.
jest.mock('./LootArtworkGate', () => ({ __esModule: true, default: ({ children }) => children }));
import { createPendingLoot } from '../utils/pendingLoot';

describe('PendingLootModal', () => {
  test('selects physical loot, info does not toggle, previews capacity, and resolves explicitly', () => {
    const pending = createPendingLoot({ id: 'combat-1', source: 'combat', loot: { silver: 43, resonance: 12, items: [{ name: 'Простая ткань', quantity: 2 }] } });
    const onChange = jest.fn(); const onInfo = jest.fn(); const onResolve = jest.fn();
    render(<PendingLootModal pendingLoot={pending} player={{ runInventory: Array(10).fill(null), equipment: {} }} onChange={onChange} onInfo={onInfo} onResolve={onResolve} onOpenInventory={jest.fn()} />);
    expect(screen.getByText('+43 серебра')).toBeInTheDocument();
    expect(screen.getByText('+12 Резонанса Бездны')).toBeInTheDocument();
    expect(screen.getByLabelText('Подробнее: Простая ткань')).toHaveClass('compact-info-button');
    expect(screen.getByLabelText('Подробнее: Простая ткань')).toHaveClass('item-icon-info');
    expect(screen.getByText('2')).toHaveClass('item-icon-quantity');
    expect(screen.getByText('Выбрано: 0')).toBeInTheDocument();
    expect(screen.queryByText('Простая ткань')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Простая ткань, количество 2' })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Подробнее: Простая ткань'));
    expect(onInfo).toHaveBeenCalledTimes(1); expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { pressed: false }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ selectedIds: [pending.items[0].id] }));
    fireEvent.click(screen.getByRole('button', { name: 'Забрать выбранное' }));
    expect(screen.getByText('Оставить невыбранную добычу?')).toBeInTheDocument();
  });
  test('valuable loot still confirms abandonment when ordinary warnings are suppressed', () => {
    const pending = createPendingLoot({ id: 'rare', loot: { items: [{ name: 'Эссенция Проклятий' }] } });
    render(<PendingLootModal pendingLoot={pending} suppressAbandonWarnings player={{ runInventory: Array(10).fill(null), equipment: {} }} onChange={jest.fn()} onResolve={jest.fn()} onOpenInventory={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Забрать выбранное' }));
    expect(screen.getByText('Оставить невыбранную добычу?')).toBeInTheDocument();
  });
  test('omits zero silver while retaining non-zero rewards and one capacity label', () => {
    const zero = createPendingLoot({ id: 'zero', loot: { silver: 0, items: [] } });
    const props = { player: { runInventory: Array(12).fill(null), equipment: {} }, onChange: jest.fn(), onResolve: jest.fn(), onOpenInventory: jest.fn() };
    const view = render(<PendingLootModal pendingLoot={zero} {...props} />);
    expect(screen.queryByText('+0 серебра')).not.toBeInTheDocument();
    expect(screen.getAllByText('Инвентарь 0/26')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Открыть инвентарь' })).toHaveClass('ui-action--secondary');
    view.rerender(<PendingLootModal pendingLoot={{ ...zero, silver: 9 }} {...props} />);
    expect(screen.getByText('+9 серебра')).toBeInTheDocument();
  });
  test('session suppression carries across ordinary loot opportunities and resets with fresh state', () => {
    const first = createPendingLoot({ id: 'first', loot: { items: [{ name: 'Простая ткань' }] } });
    const second = createPendingLoot({ id: 'second', loot: { items: [{ name: 'Куртка Мародёра' }] } });
    const onSuppress = jest.fn(); const onResolve = jest.fn();
    const props = { player: { runInventory: Array(12).fill(null), equipment: {} }, onChange: jest.fn(), onResolve, onOpenInventory: jest.fn(), onSuppressAbandonWarningsChange: onSuppress };
    const view = render(<PendingLootModal pendingLoot={first} {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Забрать выбранное' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    view.rerender(<PendingLootModal pendingLoot={first} {...props} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onSuppress).toHaveBeenCalledWith(true);
    view.rerender(<PendingLootModal pendingLoot={second} suppressAbandonWarnings {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Забрать выбранное' }));
    expect(onResolve).toHaveBeenCalledTimes(1);
    view.rerender(<PendingLootModal pendingLoot={first} {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Забрать выбранное' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
  test('uses centralized artwork for mapped rewards and text fallback for unmapped rewards', () => {
    const pending = createPendingLoot({ id: 'art', loot: { items: [
      { name: 'Малое зелье здоровья' },
      { name: 'Металлические обломки' },
      { name: 'Куртка Мародёра' },
      { name: 'Простая ткань' },
    ] } });
    const { container } = render(<PendingLootModal pendingLoot={pending} player={{ runInventory: Array(12).fill(null), equipment: {} }} onChange={jest.fn()} onResolve={jest.fn()} onOpenInventory={jest.fn()} />);
    const cells = container.querySelectorAll('.pending-loot-cell');
    expect(cells[0].querySelector('img')).toHaveAttribute('src', expect.stringContaining('/assets/items/consumables/'));
    expect(cells[1].querySelector('img')).toHaveAttribute('src', expect.stringContaining('/assets/items/materials/metal_fragments.webp'));
    expect(cells[2].querySelector('img')).toHaveAttribute('src', expect.stringContaining('/assets/items/equipment/marauder_jacket.webp'));
    expect(cells[3].querySelector('img')).toHaveAttribute('src', expect.stringContaining('/assets/items/materials/simple_cloth.png'));
  });
});

test('take all resolves in one click when everything fits', () => {
  const pending = createPendingLoot({ id: 'all', loot: { items: [{ name: 'Простая ткань', quantity: 2 }] } });
  const onResolve = jest.fn();
  render(<PendingLootModal pendingLoot={pending} player={{ runInventory: Array(26).fill(null), equipment: {} }} onResolve={onResolve} onChange={jest.fn()} onOpenInventory={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Забрать всё' }));
  expect(onResolve).toHaveBeenCalledTimes(1);
  expect(onResolve.mock.calls[0][0].selectedIds).toEqual([pending.items[0].id]);
});

