import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ExpeditionCombatPreview from './ExpeditionCombatPreview';

const player = (hp = 55) => ({
  hp, maxHp: 100, currentLocation: 'Лес Увядания',
  runInventory: [{ itemId: 'Кровяная повязка', quantity: 2 }],
  curses: [],
});

test('field consumables are accessible from the encounter preview', () => {
  const onUseFieldItem = jest.fn();
  render(<ExpeditionCombatPreview player={player()} room={{ enemies: [] }} onUseFieldItem={onUseFieldItem} />);
  expect(screen.getByText('Здоровье: 55 / 100')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Предметы перед боем/ }));
  expect(screen.getByText('Кровяная повязка')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Использовать' }));
  expect(onUseFieldItem).toHaveBeenCalledTimes(1);
  expect(onUseFieldItem).toHaveBeenCalledWith(0);
});

test('field healing is blocked when HP is full', () => {
  render(<ExpeditionCombatPreview player={player(100)} room={{ enemies: [] }} onUseFieldItem={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /Предметы перед боем/ }));
  expect(screen.getByRole('button', { name: 'Использовать' })).toBeDisabled();
});
