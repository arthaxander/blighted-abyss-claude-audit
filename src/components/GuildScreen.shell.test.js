import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { UIProvider } from '../contexts/UIContext';
import GuildScreen from './GuildScreen';
import { GUILD_HALL_SERVICES } from './guild/guildNavigation';

const player = { name: 'Герой', class: 'Defender', equipment: {}, runInventory: [], inventory: ['legacy-only'], questLog: {}, relics: {}, silver: 0 };
const show = props => render(<UIProvider><GuildScreen player={player} storageItems={[]} onUpdatePlayer={jest.fn()} {...props} /></UIProvider>);

test('Guild opens on data-driven Hall and exposes no abandoned Arena', () => {
  const onStartRun = jest.fn(); show({ onStartRun });
  expect(screen.getByRole('heading', { name: 'Зал гильдии' })).toBeInTheDocument();
  expect(GUILD_HALL_SERVICES.map(x => x.label)).toEqual(['Реликвии', 'Класс', 'Задания', 'Торговцы']);
  expect(screen.queryByRole('button', { name: /арена/i })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'НАЧАТЬ ПОХОД' })); expect(onStartRun).toHaveBeenCalledTimes(1);
});

test('permanent primary navigation has the fixed order and persists', () => {
  show(); const nav = screen.getByRole('navigation', { name: 'Основные разделы гильдии' });
  expect(within(nav).getAllByRole('button').map(x => x.getAttribute('aria-label'))).toEqual(['Холл','Рюкзак','Хранилище','Персонаж','Крафт']);
  fireEvent.click(within(nav).getByRole('button', { name: 'Хранилище' }));
  expect(screen.getByRole('navigation', { name: 'Основные разделы гильдии' })).toBeInTheDocument();
});

test('Backpack presents canonical runInventory and ignores a legacy-only mirror item', () => {
  show(); fireEvent.click(screen.getByRole('button', { name: 'Рюкзак' }));
  expect(screen.queryByText('legacy-only')).not.toBeInTheDocument();
  expect(screen.getAllByTestId('backpack-slot')).toHaveLength(26);
  expect(screen.getAllByLabelText('Пустая ячейка')).toHaveLength(26);
  ['Безопасные', 'Основные', 'Расходники', 'Ресурсы'].forEach(label => expect(screen.getByRole('heading', { name: new RegExp(label) })).toBeInTheDocument());
});

test('Backpack derives Safe presentation only from physical typed slots', () => {
  const runInventory = Array(26).fill(null);
  runInventory[0] = { itemId: 'Простая ткань', quantity: 1 };
  runInventory[2] = { itemId: 'Простая ткань', quantity: 1 };
  const { rerender } = render(<UIProvider><GuildScreen player={{ ...player, runInventory, safeSlots: [] }} storageItems={[]} onUpdatePlayer={jest.fn()} /></UIProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Рюкзак' }));
  const slots = screen.getAllByTestId('backpack-slot');
  expect(slots[0]).toHaveClass('is-safe'); expect(slots[2]).not.toHaveClass('is-safe');
  expect(slots[0]).toHaveAccessibleName('Простая ткань');
  expect(slots[0].querySelector('strong')).toBeNull();
  expect(screen.getAllByLabelText('Пустая ячейка')[0].tagName).toBe('DIV');
  expect(screen.queryByRole('button', { name: /сделать безопасным|убрать из безопасных/i })).not.toBeInTheDocument();
  rerender(<UIProvider><GuildScreen player={{ ...player, runInventory, safeSlots: ['Простая ткань'] }} storageItems={[]} onUpdatePlayer={jest.fn()} /></UIProvider>);
  const updatedSlots = screen.getAllByTestId('backpack-slot');
  expect(updatedSlots[0]).toHaveClass('is-safe'); expect(updatedSlots[2]).not.toHaveClass('is-safe');
});

test('unload-rest delegates selected slots to one App transaction', () => {
  const onUnloadBackpackExceptKept = jest.fn(() => ({ movedQuantity: 2, remainingQuantity: 0 }));
  show({ onUnloadBackpackExceptKept });
  fireEvent.click(screen.getByRole('button', { name: 'Рюкзак' }));
  fireEvent.click(screen.getByRole('button', { name: 'Выбрать' }));
  fireEvent.click(screen.getByRole('button', { name: 'Выгрузить остальное' }));
  expect(onUnloadBackpackExceptKept).toHaveBeenCalledTimes(1);
  expect(onUnloadBackpackExceptKept).toHaveBeenCalledWith([]);
});

test('normal class switch uses the shared ConfirmDialog flow', async () => {
  const onChangeClass = jest.fn(); show({ onChangeClass });
  fireEvent.click(screen.getByRole('button', { name: 'Класс' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Смена класса' }));
  fireEvent.click(screen.getByRole('button', { name: 'Элементалист' }));
  expect(screen.getByRole('heading', { name: 'Сменить класс на «Элементалист»?' })).toBeInTheDocument();
  expect(screen.getByText(/Смена бесплатна.*Сумка останется экипированной/s)).toBeInTheDocument();
  expect(onChangeClass).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Сменить класс' }));
  await waitFor(() => expect(onChangeClass).toHaveBeenCalledWith('Mage'));
});

test('service uses one content title and no legacy back header', () => {
  show(); fireEvent.click(screen.getByRole('button', { name: 'Реликвии' }));
  expect(screen.getAllByRole('heading', { name: 'Реликвии' })).toHaveLength(1);
  expect(screen.queryByText('← В зал')).not.toBeInTheDocument();
});

test('discovered level-zero and multiple discovered relics are visible while authored undiscovered details stay hidden', () => {
  show({ player: { ...player, relics: { discoveredRelicIds: ['blood_amulet', 'ritual_blade'] } } });
  fireEvent.click(screen.getByRole('button', { name: 'Реликвии' }));
  expect(screen.getByRole('listitem', { name: /Кровавый Амулет/ })).toBeInTheDocument();
  expect(screen.getByRole('listitem', { name: /Ритуальный Клинок/ })).toBeInTheDocument();
  expect(screen.getAllByTestId('relic-detail')).toHaveLength(1);
  const hidden = GUILD_HALL_SERVICES.length && 'Сердце Карающего Света';
  expect(screen.queryByText(hidden)).not.toBeInTheDocument();
});

test('grant-all makes all 19 authored relics visible', () => {
  const { RELIC_DEFINITIONS, grantAllRelics } = require('../data/relics');
  show({ player: { ...player, relics: grantAllRelics() } });
  fireEvent.click(screen.getByRole('button', { name: 'Реликвии' }));
  expect(screen.getAllByTestId('relic-selector-cell')).toHaveLength(19);
  fireEvent.click(screen.getByRole('listitem', { name: /Ритуальный Клинок/ }));
  expect(screen.getByTestId('relic-detail')).toHaveTextContent('Ритуальный Клинок');
});

test('vendor UI omits technical item type metadata', () => {
  show(); fireEvent.click(screen.getByRole('button', { name: 'Торговцы' }));
  expect(screen.getByRole('heading', { name: 'Торговый квартал' })).toBeInTheDocument();
  expect(screen.queryByText(/\(consumable\)/)).not.toBeInTheDocument();
});

test('selecting a discovered relic delegates to the persistent relic transaction', () => {
  const onUpdateRelics = jest.fn();
  show({ player: { ...player, relics: { discoveredRelicIds: ['blood_amulet'] } }, onUpdateRelics });
  fireEvent.click(screen.getByRole('button', { name: 'Реликвии' }));
  fireEvent.click(screen.getByRole('listitem', { name: /Кровавый Амулет/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Сделать активной' }));
  const next = onUpdateRelics.mock.calls[0][0]({ activeRelicId: 'recruit_seal', discoveredRelicIds: ['recruit_seal', 'blood_amulet'], progress: { recruit_seal: { level: 3, xp: 42 } } });
  expect(next.activeRelicId).toBe('blood_amulet');
  expect(next.progress.recruit_seal).toEqual({ level: 3, xp: 42 });
});

test('shell keeps navigation outside the mode-specific content viewport', () => {
  const { container } = show();
  const shell = container.querySelector('.guild-shell');
  expect(shell.firstElementChild).toHaveClass('guild-fullscreen-title');
  expect(shell.children[1]).toHaveClass('guild-primary-nav');
  expect(shell.children[2]).toHaveClass('guild-content-viewport', 'is-hall');
  fireEvent.click(screen.getByRole('button', { name: 'Крафт' }));
  expect(shell.children[2]).toHaveClass('guild-content-viewport', 'is-service');
});

test('Craft uses clean recipe rows and stackable quantity dialog', () => {
  show(); fireEvent.click(screen.getByRole('button', { name: 'Крафт' }));
  expect(screen.getAllByTestId('recipe-cell').length).toBeGreaterThan(0);
  const icon = screen.getAllByTestId('recipe-cell')[0].querySelector('.guild-recipe-result');
  expect(icon.querySelector('strong')).toBeNull(); expect(icon).not.toHaveTextContent('Можно');
});

test('Vendor merchandise is a price-badged grid and opens purchase details', () => {
  show(); fireEvent.click(screen.getByRole('button', { name: 'Торговцы' }));
  expect(screen.getAllByTestId('vendor-cell').length).toBeGreaterThan(0);
  expect(screen.getAllByText(/◈/).length).toBeGreaterThan(0);
  fireEvent.click(screen.getAllByTestId('vendor-cell')[0]);
  expect(screen.getByRole('dialog', { name: /Товар:/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Купить' })).toBeInTheDocument();
});

test('Character is a paper doll without legacy inventory and internal class output', () => {
  show(); fireEvent.click(screen.getByRole('button', { name: 'Персонаж' }));
  expect(screen.getByLabelText('Экипировка персонажа')).toBeInTheDocument();
  expect(document.querySelectorAll('.equipment-paper-slot')).toHaveLength(9);
  expect(screen.queryByText('Доступная экипировка')).not.toBeInTheDocument();
  expect(screen.queryByText(/\(Defender\)/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Подробнее: Физическая защита' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Подробнее: Магическая защита' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Подробнее: Физическая защита' }));
  expect(screen.getByRole('dialog', { name: 'Физическая защита' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Эффекты' }));
  expect(screen.getByRole('heading', { name: 'Активные эффекты' })).toBeInTheDocument();
});

test('Hall illustration layer exists only on Hall and does not leak to service tabs', () => {
  show();
  expect(screen.getByTestId('guild-hall-background')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Хранилище' }));
  expect(screen.queryByTestId('guild-hall-background')).not.toBeInTheDocument();
});

test('Hall has a separate field loadout editor while normal Guild craft stays recipe-only', () => {
  show();
  const hallButton = screen.getByRole('button', { name: 'Настроить полевой набор' });
  expect(hallButton).toBeInTheDocument();
  fireEvent.click(hallButton);
  expect(screen.getByRole('heading', { name: 'Полевой набор' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Изменить: Свиток 1' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Крафт' }));
  expect(screen.getAllByTestId('recipe-cell').length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: 'Изменить: Свиток 1' })).not.toBeInTheDocument();
  expect(screen.queryByText('Сохранённые наборы')).not.toBeInTheDocument();
});
