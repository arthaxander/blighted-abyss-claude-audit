import React, { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import FieldCraftingModal from './FieldCraftingModal';
import { insertItems, getRunInventoryLayout } from '../utils/expeditionInventory';

jest.mock('../contexts/UIContext', () => ({ useToast: () => ({ pushToast: jest.fn() }) }));

const player = () => ({
  abyssLevel: 1,
  equipment: {},
  runInventoryLayoutVersion: 2,
  runInventory: insertItems(Array(26).fill(null), [
    { itemId: 'Простая ткань', quantity: 1 },
    { itemId: 'Кровяной мох', quantity: 1 },
    { itemId: 'Простые чернила', quantity: 1 },
  ], { layout: getRunInventoryLayout() }).slots,
});

const row = name => screen.getAllByTestId('recipe-cell').find(node =>
  within(node).queryByRole('button', { name: `Создать: ${name}` })
);
const craft = name => within(row(name)).getByRole('button', { name: `Создать: ${name}` });

test('field craft uses the same compact icon/material/action rows as Guild craft', () => {
  render(<FieldCraftingModal player={player()} />);
  expect(screen.getByRole('dialog', { name: 'Полевой крафт' })).toBeInTheDocument();
  expect(screen.getByRole('list', { name: 'Рецепты' })).toBeInTheDocument();
  expect(row('Свиток уязвимости')).toHaveClass('guild-recipe-row');
  expect(within(row('Свиток уязвимости')).getByRole('button', { name: 'Подробнее: Кровяной мох' })).toHaveTextContent('1/1');
  expect(craft('Свиток уязвимости')).toBeEnabled();
  expect(craft('Свиток Конус льда')).toBeDisabled();
});

test('result and ingredient icons open inspect-only item cards without crafting', () => {
  const update = jest.fn();
  render(<FieldCraftingModal player={player()} onUpdatePlayer={update} />);
  fireEvent.click(within(row('Малое зелье здоровья')).getByRole('button', { name: 'Подробнее: Малое зелье здоровья' }));
  const resultCard = screen.getByRole('dialog', { name: 'Предмет: Малое зелье здоровья' });
  expect(resultCard).toBeInTheDocument();
  expect(within(resultCard).queryByRole('button', { name: 'Использовать' })).not.toBeInTheDocument();
  expect(update).not.toHaveBeenCalled();
  fireEvent.click(within(resultCard).getByRole('button', { name: 'Закрыть' }));
  fireEvent.click(within(row('Малое зелье здоровья')).getByRole('button', { name: 'Подробнее: Кровяной мох' }));
  expect(screen.getByRole('dialog', { name: 'Предмет: Кровяной мох' })).toBeInTheDocument();
  expect(update).not.toHaveBeenCalled();
});

test('categories and available-only toggle keep recipe row behavior', () => {
  render(<FieldCraftingModal player={player()} />);
  fireEvent.click(screen.getByRole('tab', { name: 'Западни' }));
  expect(screen.getAllByTestId('recipe-cell')).toHaveLength(1);
  expect(row('Колючая западня')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Все' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Можно создать' }));
  expect(row('Свиток уязвимости')).toBeInTheDocument();
  expect(row('Свиток Конус льда')).toBeUndefined();
  fireEvent.click(screen.getByRole('tab', { name: 'Западни' }));
  expect(screen.getByText(/Нет рецептов, доступных для создания/)).toBeInTheDocument();
});

test('full inventory blocks craft and cannot spend ingredients', () => {
  const p = player();
  for (let i = 0; i < 14; i++) p.runInventory[i] = { itemId: 'Колючая западня', quantity: 3 };
  const update = jest.fn();
  render(<FieldCraftingModal player={p} onUpdatePlayer={update} />);
  expect(craft('Свиток уязвимости')).toBeDisabled();
  fireEvent.click(craft('Свиток уязвимости'));
  expect(update).not.toHaveBeenCalled();
});

test('craft action updates the inventory exactly once and refreshes availability', () => {
  const Harness = () => {
    const [p, set] = useState(player);
    return <FieldCraftingModal player={p} onUpdatePlayer={set} />;
  };
  render(<Harness />);
  fireEvent.click(craft('Свиток уязвимости'));
  expect(screen.getByText('Создано: Свиток уязвимости')).toBeInTheDocument();
  expect(craft('Свиток уязвимости')).toBeDisabled();
});

test('successive field crafts refresh every recipe without switching tabs or reopening', () => {
  const wellStocked = () => ({
    ...player(),
    runInventory: insertItems(Array(26).fill(null), [
      { itemId: 'Простая ткань', quantity: 3 },
      { itemId: 'Кровяной мох', quantity: 3 },
      { itemId: 'Простые чернила', quantity: 3 },
    ], { layout: getRunInventoryLayout() }).slots,
  });
  let latest;
  const Harness = () => {
    const [p, set] = useState(wellStocked);
    latest = p;
    return <FieldCraftingModal player={p} onUpdatePlayer={set} />;
  };
  render(<Harness />);
  expect(craft('Свиток уязвимости')).toBeEnabled();
  expect(craft('Кровяная припарка')).toBeEnabled();

  fireEvent.click(craft('Свиток уязвимости'));
  expect(craft('Свиток уязвимости')).toBeEnabled();
  expect(craft('Кровяная припарка')).toBeEnabled();

  fireEvent.click(craft('Кровяная припарка'));
  expect(craft('Свиток уязвимости')).toBeEnabled();

  fireEvent.click(craft('Свиток уязвимости'));
  expect(craft('Свиток уязвимости')).toBeDisabled();
  expect(craft('Кровяная припарка')).toBeDisabled();
  expect(latest.runInventory.filter(Boolean).some(stack =>
    stack.itemId === 'Свиток уязвимости' && stack.quantity === 2
  )).toBe(true);
  expect(latest.runInventory.filter(Boolean).some(stack =>
    stack.itemId === 'Кровяная припарка' && stack.quantity === 1
  )).toBe(true);
});

test('prepared trap remains cancellable', () => {
  const update = jest.fn();
  render(<FieldCraftingModal player={{ ...player(), preparedTrap: 'Колючая западня' }} onUpdatePlayer={update} />);
  fireEvent.click(screen.getByRole('button', { name: 'Отменить подготовку' }));
  expect(update).toHaveBeenCalledWith({ preparedTrap: null });
});
