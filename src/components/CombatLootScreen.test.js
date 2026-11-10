import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import CombatLootScreen from './CombatLootScreen';
import { createPendingLoot } from '../utils/pendingLoot';

test('combat loot is a standalone screen with one shared pending reward UI', () => {
  const pending = createPendingLoot({ id: 'combat-screen', source: 'combat', loot: { silver: 12, items: [{ name: 'Простая ткань', quantity: 2 }] } });
  const onChange = jest.fn();
  const onOpenInventory = jest.fn();
  const { container } = render(<CombatLootScreen pendingLoot={pending} player={{ equipment: {}, runInventory: Array(12).fill(null) }} onChange={onChange} onResolve={jest.fn()} onOpenInventory={onOpenInventory} />);
  expect(container.querySelector('.combat-loot-screen')).toBeInTheDocument();
  expect(container.querySelector('.battlefield')).not.toBeInTheDocument();
  expect(container.querySelectorAll('.pending-loot-panel')).toHaveLength(1);
  expect(screen.getByText('+12 серебра')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { pressed: false }));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ selectedIds: [pending.items[0].id] }));
  expect(screen.getAllByText('Инвентарь 0/26')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Открыть инвентарь' }));
  expect(onOpenInventory).toHaveBeenCalledTimes(1);
});
