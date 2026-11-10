import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import GuildScreen from './GuildScreen';
import { UIProvider } from '../contexts/UIContext';

const player = { class: 'Defender', silver: 10, inventory: [], equipment: {}, runes: { slots: {}, inventory: [] }, questLog: {} };

test('Storage filters, stable hidden selection, single details, and confirmed bulk selling share canonical values', () => {
  const onUpdateStorage = jest.fn(); const onUpdatePlayer = jest.fn();
  render(<UIProvider><GuildScreen player={player} onUpdatePlayer={onUpdatePlayer} storageItems={['Простая ткань', 'Простая ткань', 'Куртка Мародёра']} onUpdateStorage={onUpdateStorage} /></UIProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Хранилище' }));
  expect(screen.getByRole('heading', { name: 'Хранилище' })).toBeInTheDocument();
  expect(screen.getByText('2 / 300')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Простая ткань x2' }));
  expect(screen.getByRole('dialog', { name: 'Предмет: Простая ткань' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Продать' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
  fireEvent.click(screen.getByRole('button', { name: 'Выбрать' }));
  expect(screen.getByRole('button', { name: 'Подробнее: Простая ткань' })).toHaveClass('item-icon-info');
  expect(screen.getByText('2')).toHaveClass('item-icon-quantity');
  fireEvent.click(screen.getByRole('button', { name: 'Подробнее: Простая ткань' }));
  expect(screen.getByRole('dialog', { name: 'Предмет: Простая ткань' })).toBeInTheDocument();
  expect(screen.getByText('Выбрано: 0')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
  fireEvent.click(screen.getByRole('button', { name: 'Простая ткань x2' }));
  fireEvent.click(screen.getByRole('button', { name: 'Экипировка' }));
  expect(screen.getByText('Выбрано: 1')).toBeInTheDocument();
  expect(screen.getByText('Получите: 10 серебра')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Продать' }));
  expect(screen.getByRole('alertdialog', { name: 'Подтвердить продажу' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('alertdialog').querySelector('button'));
  expect(onUpdateStorage).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ itemId: 'Куртка Мародёра' })]));
  expect(onUpdatePlayer).toHaveBeenCalled();
});

test('sell selection accepts sellable consumable, material, and equipment together', () => {
  render(<UIProvider><GuildScreen player={player} onUpdatePlayer={jest.fn()} storageItems={['Малое зелье здоровья', 'Простая ткань', 'Куртка Мародёра']} onUpdateStorage={jest.fn()} /></UIProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Хранилище' }));
  fireEvent.click(screen.getByRole('button', { name: 'Выбрать' }));
  fireEvent.click(screen.getByRole('button', { name: 'Малое зелье здоровья' }));
  fireEvent.click(screen.getByRole('button', { name: 'Простая ткань' }));
  fireEvent.click(screen.getByRole('button', { name: 'Куртка Мародёра' }));
  expect(screen.getByText('Выбрано: 3')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Простая ткань' }));
  expect(screen.getByText('Выбрано: 2')).toBeInTheDocument();
});
