import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import RuneTargetSelectionOverlay from './RuneTargetSelectionOverlay';

test('selected target footer confirms exactly once through the rendered button', () => {
  const onSelect = jest.fn(() => ({ success: true }));
  const target = { location: 'equipped', equipped: true, slot: 'amulet', item: { instanceId: 'a', itemId: 'Амулет Крысиной Жилы' } };
  render(<RuneTargetSelectionOverlay targets={[target]} onSelect={onSelect} onClose={jest.fn()} />);
  const picker = screen.getByRole('dialog', { name: 'Выбор снаряжения' });
  const confirm = within(picker).getByRole('button', { name: 'Вставить' });
  expect(confirm).toBeDisabled();
  fireEvent.click(within(picker).getByRole('button', { name: 'Выбрать Амулет Крысиной Жилы, надето' }));
  expect(confirm).toBeEnabled();
  fireEvent.click(confirm);
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(onSelect).toHaveBeenCalledWith(target);
});

test('equipped copy is presented before identical inventory copies', () => {
  const targets = [
    { location: 'storage', slot: 'amulet', item: { instanceId: 'stored-1', itemId: 'Амулет Крысиной Жилы' } },
    { location: 'equipped', equipped: true, slot: 'amulet', item: { instanceId: 'equipped-1', itemId: 'Амулет Крысиной Жилы' } },
    { location: 'storage', slot: 'amulet', item: { instanceId: 'stored-2', itemId: 'Амулет Крысиной Жилы' } },
  ];
  render(<RuneTargetSelectionOverlay targets={targets} onSelect={jest.fn()} onClose={jest.fn()} />);
  const choices = screen.getAllByRole('button', { name: /Выбрать Амулет Крысиной Жилы/ });
  expect(choices).toHaveLength(3);
  expect(choices[0]).toHaveAccessibleName(/надето/);
  expect(choices[1]).not.toHaveAccessibleName(/надето/);
});
