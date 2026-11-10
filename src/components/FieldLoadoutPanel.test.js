import React, { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import FieldLoadoutPanel from './FieldLoadoutPanel';
import { FIELD_CRAFTING_RECIPES } from '../data/recipes';
import { getSelectedFieldRecipes } from '../data/fieldCraftingLoadout';

test('Guild editor selects a recipe through the item picker, saves and restores a named preset', () => {
  let current;
  function Harness() {
    const [player, set] = useState({});
    current = player;
    return <FieldLoadoutPanel player={player} onUpdatePlayer={set} />;
  }
  render(<Harness />);
  fireEvent.click(screen.getByText('Полевой набор'));
  const id = FIELD_CRAFTING_RECIPES.find(r => r.name === 'Свиток Ядовитого облака').id;
  fireEvent.click(screen.getByRole('button', { name: 'Изменить: Свиток 1' }));
  const picker = screen.getByRole('dialog', { name: 'Выбор рецепта: Свиток 1' });
  fireEvent.click(within(picker).getByRole('button', { name: 'Выбрать: Свиток Ядовитого облака' }));
  expect(screen.queryByRole('dialog', { name: 'Выбор рецепта: Свиток 1' })).not.toBeInTheDocument();
  expect(getSelectedFieldRecipes(current).some(r => r.id === id)).toBe(true);

  fireEvent.click(screen.getByRole('button', { name: 'Переименовать набор 1' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Название набора 1' }), { target: { value: 'Против усилений' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить 1' }));

  fireEvent.click(screen.getByRole('button', { name: 'Изменить: Свиток 1' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Очистить слот' }));
  expect(getSelectedFieldRecipes(current).some(r => r.id === id)).toBe(false);

  fireEvent.click(screen.getByRole('button', { name: 'Применить 1' }));
  expect(getSelectedFieldRecipes(current).some(r => r.id === id)).toBe(true);
  expect(current.fieldCraftingPresets[0].name).toBe('Против усилений');
});

test('recipe picker prevents duplicates but allows choosing an empty slot', () => {
  const Harness = () => {
    const [player, set] = useState({});
    return <FieldLoadoutPanel player={player} onUpdatePlayer={set} />;
  };
  render(<Harness />);
  fireEvent.click(screen.getByText('Полевой набор'));
  fireEvent.click(screen.getByRole('button', { name: 'Изменить: Свиток 2' }));
  const picker = screen.getByRole('dialog', { name: 'Выбор рецепта: Свиток 2' });
  expect(within(picker).getByRole('button', { name: 'Выбрать: Свиток уязвимости' })).toBeDisabled();
  expect(within(picker).getByRole('button', { name: 'Выбрать: Свиток Ядовитого облака' })).toBeEnabled();
  fireEvent.click(within(picker).getByRole('button', { name: 'Закрыть выбор рецепта' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('expedition cannot open editor or save or apply presets', () => {
  render(<FieldLoadoutPanel player={{ currentLocation: 'Гоблинские Норы' }} onUpdatePlayer={jest.fn()} />);
  fireEvent.click(screen.getByText('Полевой набор'));
  expect(screen.getByRole('button', { name: 'Изменить: Зелье 1' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Сохранить 1' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Применить 1' })).toBeDisabled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
