import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import LocationSelectionScreen from './LocationSelectionScreen';
import { AVAILABLE_LOCATIONS } from '../data/locations';

test('current fullscreen location shell preserves all start-run choices and Guild return', () => {
  const select = jest.fn(); const cancel = jest.fn();
  const { container } = render(<LocationSelectionScreen onSelectLocation={select} onCancel={cancel} />);
  expect(container.querySelector('.location-selection-shell')).toBeInTheDocument();
  AVAILABLE_LOCATIONS.forEach(location => expect(screen.getByRole('button', { name: new RegExp(location.name) })).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: new RegExp(AVAILABLE_LOCATIONS[0].name) }));
  expect(select).toHaveBeenCalledWith(AVAILABLE_LOCATIONS[0].name);
  fireEvent.click(screen.getByRole('button', { name: 'Вернуться в Гильдию' }));
  expect(cancel).toHaveBeenCalledTimes(1);
});

test('all three authored level-two locations can be selected', () => {
  const onSelectLocation = jest.fn();
  render(<LocationSelectionScreen level={2} onSelectLocation={onSelectLocation} onCancel={jest.fn()} />);
  expect(screen.getByRole('heading', { name: 'Выберите следующий путь' })).toBeInTheDocument();
  const cards = screen.getAllByRole('button').filter(button => button.classList.contains('location-selection-card'));
  expect(cards).toHaveLength(3);
  expect(cards.every(card => !card.disabled)).toBe(true);
  for (const name of ['Лес Увядания', 'Руины Неупокоенных', 'Шахты Тления']) {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }));
  }
  expect(onSelectLocation.mock.calls).toEqual([
    ['Лес Увядания'], ['Руины Неупокоенных'], ['Шахты Тления'],
  ]);
});
