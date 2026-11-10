import React, { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import GuildScreen from './GuildScreen';
import { UIProvider } from '../contexts/UIContext';
import { depositRunInventoryEntry, equipStorageEntry, withdrawStorageEntry } from '../utils/storageTransactions';
import { sellStorageSelection } from '../utils/storageManagement';
import { buildPlayerSnapshot, hydratePlayerSnapshot } from '../utils/playerState';

const basePlayer = { class: 'Defender', silver: 10, inventory: [], runInventory: Array(26).fill(null), runInventoryLayoutVersion: 2, equipment: {}, runes: { slots: {}, inventory: [] }, questLog: {}, maxHp: 100, hp: 100 };

const Harness = ({ initialStorage, initialPlayer = basePlayer }) => {
  const [storage, setStorage] = useState(initialStorage);
  const [player, setPlayer] = useState(initialPlayer);
  const withdraw = (entry, quantity) => {
    const result = withdrawStorageEntry({ storageItems: storage, player, entryId: entry.id, quantity });
    if (!result.success) return false;
    setStorage(result.storageItems); setPlayer(result.player); return true;
  };
  const equip = (entry, preferredSlot = null) => { const result = equipStorageEntry({ storageItems: storage, player, entryId: entry.id, preferredSlot }); if (result.requiresSlotChoice) return result; if (!result.success) return false; setStorage(result.storageItems); setPlayer(result.player); return true; };
  const deposit = item => { const result = depositRunInventoryEntry({ storageItems: storage, player, sourceIndex: item.sourceIndex, itemId: item.itemId, quantity: 1 }); if (!result.success) return false; setStorage(result.storageItems); setPlayer(result.player); return true; };
  const sell = (ids, options) => { const result = sellStorageSelection(storage, ids, options); if (!result.success) return result; setStorage(result.storage); setPlayer(prev => ({ ...prev, silver: prev.silver + result.silver })); return result; };
  return <UIProvider><GuildScreen player={player} onUpdatePlayer={updater => setPlayer(prev => typeof updater === 'function' ? { ...prev, ...updater(prev) } : updater)} storageItems={storage} onUpdateStorage={setStorage} onDepositItem={deposit} onWithdrawItem={withdraw} onEquipStorageItem={equip} onSellStorage={sell} /><output data-testid="state">{JSON.stringify({ storage, player })}</output></UIProvider>;
};

test.each([
  [{ movedQuantity: 3, remainingQuantity: 0 }, null],
  [{ movedQuantity: 2, remainingQuantity: 1 }, 'Инвентарь выгружен частично'],
  [{ movedQuantity: 0, remainingQuantity: 3 }, 'На складе нет места'],
])('unload-all invokes once without confirmation and reports transaction result %#', (result, toast) => {
  const unload = jest.fn(() => result);
  render(<UIProvider><GuildScreen player={basePlayer} storageItems={[]} onUpdatePlayer={jest.fn()} onUnloadAllToStorage={unload} /></UIProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Рюкзак' }));
  fireEvent.click(screen.getByRole('button', { name: 'Выгрузить всё на склад' }));
  expect(unload).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  if (toast) expect(screen.getByText(toast)).toBeInTheDocument();
  else expect(screen.queryByText('Инвентарь выгружен на склад')).not.toBeInTheDocument();
  if (result.remainingQuantity && result.movedQuantity) expect(screen.getByText('Перемещено: 2. Не поместилось: 1.')).toBeInTheDocument();
});

test('real Guild single-deposit action persists stackables and exact equipment instances', () => {
  const gear = { instanceId: 'guild-deposit-gear', itemId: 'Капюшон Искателя Знаков', socketedRuneId: 'stone_vigil', quantity: 1 };
  const runInventory = [{ itemId: 'Простая ткань', quantity: 2 }, gear, ...Array(10).fill(null)];
  render(<Harness initialStorage={[]} initialPlayer={{ ...basePlayer, runInventory, inventory: ['Простая ткань', 'Простая ткань', gear] }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Рюкзак' }));
  fireEvent.click(screen.getByRole('listitem', { name: 'Простая ткань' }));
  fireEvent.click(screen.getByRole('button', { name: 'В хранилище' }));
  let state = JSON.parse(screen.getByTestId('state').textContent);
  expect(state.player.runInventory[0].quantity).toBe(1);
  expect(state.storage.find(item => item.itemId === 'Простая ткань').quantity).toBe(1);
  fireEvent.click(screen.getByRole('listitem', { name: 'Капюшон Искателя Знаков' }));
  fireEvent.click(screen.getByRole('button', { name: 'В хранилище' }));
  state = JSON.parse(screen.getByTestId('state').textContent);
  expect(state.player.runInventory.some(item => item?.instanceId === gear.instanceId)).toBe(false);
  expect(state.storage.find(item => item.instanceId === gear.instanceId)).toMatchObject(gear);
  const restored = hydratePlayerSnapshot(JSON.parse(JSON.stringify(buildPlayerSnapshot(state.player))));
  expect(restored.runInventory.some(item => item?.instanceId === gear.instanceId)).toBe(false);
  expect(JSON.parse(JSON.stringify(state.storage)).find(item => item.instanceId === gear.instanceId)).toMatchObject(gear);
});

test('Guild equips the exact typed Backpack instance and keeps its legacy mirror synchronized', () => {
  const gear = { instanceId: 'backpack-hood', itemId: 'Капюшон Искателя Знаков', socketedRuneId: 'stone_vigil', quantity: 1 };
  const runInventory = Array(26).fill(null); runInventory[2] = gear;
  render(<Harness initialStorage={[]} initialPlayer={{ ...basePlayer, runInventory, inventory: [gear] }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Рюкзак' }));
  fireEvent.click(screen.getByRole('listitem', { name: 'Капюшон Искателя Знаков' }));
  fireEvent.click(screen.getByRole('button', { name: 'Надеть' }));
  const state = JSON.parse(screen.getByTestId('state').textContent).player;
  expect(state.runInventory[2]).toBeNull();
  expect(state.equipment.helmet).toMatchObject({ itemId: gear.itemId, instanceId: gear.instanceId, socketedRuneId: gear.socketedRuneId });
  expect(state.inventory).toBeUndefined();
});

test('Guild Character unequips through typed inventory and preserves instance and rune identity', () => {
  const gear = { instanceId: 'equipped-hood', itemId: 'Капюшон Искателя Знаков', name: 'Капюшон Искателя Знаков', socketedRuneId: 'stone_vigil' };
  render(<Harness initialStorage={[]} initialPlayer={{ ...basePlayer, equipment: { helmet: gear }, runInventory: Array(26).fill(null), inventory: [] }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Персонаж' }));
  fireEvent.click(screen.getByRole('button', { name: /Шлем: Капюшон Искателя Знаков/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Снять' }));
  const state = JSON.parse(screen.getByTestId('state').textContent).player;
  expect(state.equipment.helmet).toBeNull();
  expect(state.runInventory[2]).toMatchObject({ itemId: gear.itemId, instanceId: gear.instanceId, socketedRuneId: gear.socketedRuneId });
  expect(state.inventory).toBeUndefined();
});

test('real Storage Item Details withdrawal moves the same socketed equipment instance into Run Inventory', () => {
  const item = { instanceId: 'hood-instance-1', itemId: 'Капюшон Искателя Знаков', socketedRuneId: 'test-rune', quantity: 1 };
  render(<Harness initialStorage={[item]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Хранилище' }));
  fireEvent.click(screen.getByRole('button', { name: 'Капюшон Искателя Знаков' }));
  fireEvent.click(screen.getByRole('button', { name: 'Забрать' }));
  const state = JSON.parse(screen.getByTestId('state').textContent);
  expect(state.storage).toEqual([]);
  const moved = state.player.runInventory.filter(Boolean).find(entry => entry.instanceId === item.instanceId);
  expect(moved).toMatchObject(item);
  expect([...state.storage, ...state.player.runInventory.filter(Boolean)].filter(entry => entry.instanceId === item.instanceId)).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Рюкзак' }));
  expect(screen.getByRole('listitem', { name: 'Капюшон Искателя Знаков' })).toBeInTheDocument();
  const restored = hydratePlayerSnapshot(JSON.parse(JSON.stringify(buildPlayerSnapshot(state.player))));
  expect(restored.runInventory.find(entry => entry?.instanceId === item.instanceId)).toMatchObject(item);
});

test('Storage equipment details expose direct equip, withdraw, and close actions', () => {
  const item = { instanceId: 'hood-actions', itemId: 'Капюшон Искателя Знаков', socketedRuneId: null, quantity: 1 };
  render(<Harness initialStorage={[item]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Хранилище' }));
  fireEvent.click(screen.getByRole('button', { name: 'Капюшон Искателя Знаков' }));
  expect(screen.getByRole('button', { name: 'Надеть' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Забрать' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Закрыть' })).toBeInTheDocument();
});

test('sellable Storage details expose canonical quantity-aware sale', () => {
  render(<Harness initialStorage={[{ entryId: 'cloth-sale', itemId: 'Простая ткань', quantity: 4 }]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Хранилище' })); fireEvent.click(screen.getByRole('button', { name: 'Простая ткань x4' }));
  expect(screen.getByRole('button', { name: 'Продать' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Продать' }));
  expect(screen.getByRole('dialog', { name: 'Продать предметы' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Макс.' }));
  expect(screen.getByRole('dialog', { name: 'Продать предметы' })).toHaveTextContent('Получите: 20 серебра');
  fireEvent.click(Array.from(screen.getByRole('dialog', { name: 'Продать предметы' }).querySelectorAll('button')).find(button => button.textContent === 'Продать'));
  const state = JSON.parse(screen.getByTestId('state').textContent);
  expect(state.storage).toEqual([]); expect(state.player.silver).toBe(30);
});

test('quantity controls live only in child overlays and cancellation preserves parent details', () => {
  render(<Harness initialStorage={[{ entryId: 'cloth-compact', itemId: 'Простая ткань', quantity: 8 }]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Хранилище' })); fireEvent.click(screen.getByRole('button', { name: 'Простая ткань x8' }));
  const parent = screen.getByRole('dialog', { name: 'Предмет: Простая ткань' });
  expect(parent).not.toHaveTextContent('Стак'); expect(parent).not.toHaveTextContent('Макс.'); expect(screen.getByRole('button', { name: 'Забрать' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Забрать' }));
  const child = screen.getByRole('dialog', { name: 'Забрать предметы' });
  expect(child).toBeInTheDocument(); expect(child).toHaveAttribute('data-overlay-layer', 'child');
  expect(child.querySelector('[data-overlay-layer="child-panel"]')).toBeInTheDocument();
  expect(child.querySelector('.quantity-action')).toBeInTheDocument();
  expect(screen.getByLabelText('Уменьшить количество').closest('.quantity-action-controls')).toBeInTheDocument();
  expect(within(child).getByRole('button', { name: 'Забрать' })).toHaveClass('quantity-action__primary');
  expect(child).not.toBe(parent.parentElement); expect(screen.getByLabelText('Уменьшить количество')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
  expect(screen.getByRole('dialog', { name: 'Предмет: Простая ткань' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Продать' }));
  expect(screen.getByRole('dialog', { name: 'Продать предметы' }).querySelector('[data-overlay-layer="child-panel"]')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Макс.' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
  expect(screen.getByRole('dialog', { name: 'Предмет: Простая ткань' })).toBeInTheDocument();
});

test('direct Storage equip updates loadout and returns displaced item to Storage', () => {
  const incoming = { instanceId: 'new-hood', itemId: 'Капюшон Искателя Знаков', socketedRuneId: null, quantity: 1 };
  const old = { instanceId: 'old-hood', itemId: 'Капюшон Следопыта', socketedRuneId: null, quantity: 1 };
  render(<Harness initialStorage={[incoming]} initialPlayer={{ ...basePlayer, equipment: { helmet: old } }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Хранилище' })); fireEvent.click(screen.getByRole('button', { name: 'Капюшон Искателя Знаков' })); fireEvent.click(screen.getByRole('button', { name: 'Надеть' }));
  const state = JSON.parse(screen.getByTestId('state').textContent);
  expect(state.player.equipment.helmet.instanceId).toBe('new-hood'); expect(state.storage).toEqual([expect.objectContaining({ instanceId: 'old-hood' })]);
});

test('real Storage flow conserves a stack while filling an existing partial Run Inventory stack', () => {
  const player = { ...basePlayer, inventory: Array(13).fill('Простая ткань'), runInventory: [...Array(14).fill(null), { itemId: 'Простая ткань', quantity: 13 }, ...Array(11).fill(null)] };
  render(<Harness initialStorage={[{ entryId: 'cloth-stack', itemId: 'Простая ткань', quantity: 654 }]} initialPlayer={player} />);
  fireEvent.click(screen.getByRole('button', { name: 'Хранилище' }));
  fireEvent.click(screen.getByRole('button', { name: 'Простая ткань x654' }));
  fireEvent.click(screen.getByRole('button', { name: 'Забрать' }));
  expect(screen.getByRole('dialog', { name: 'Забрать предметы' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Стак' }));
  fireEvent.click(Array.from(screen.getByRole('dialog', { name: 'Забрать предметы' }).querySelectorAll('button')).find(button => button.textContent === 'Забрать'));
  const state = JSON.parse(screen.getByTestId('state').textContent);
  expect(state.storage[0].quantity).toBe(647);
  expect(state.player.runInventory[14].quantity).toBe(20);
  expect(state.storage[0].quantity + state.player.runInventory[14].quantity).toBe(667);
});

test('loose Storage rune opens canonical details with artwork, compatibility, and description', () => {
  render(<Harness initialStorage={[{ entryId: 'stone-stack', itemId: 'stone_vigil', quantity: 3 }]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Хранилище' })); fireEvent.click(screen.getByRole('button', { name: /Руна Стального Отпора x3/ }));
  expect(screen.getByRole('dialog', { name: 'Предмет: Руна Стального Отпора' })).toBeInTheDocument();
  expect(screen.getByText('Нагрудная броня')).toBeInTheDocument(); expect(screen.getByText(/20% шанс после прямого урона/)).toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'Предмет: Руна Стального Отпора' }).querySelector('img')).toHaveAttribute('src', '/assets/items/runes/stone_vigil.webp');
});

test('loose Astral Echo rune sockets directly from Storage into the exact amulet instance', () => {
  const amulet = { instanceId: 'astral-amulet', itemId: 'Амулет Ветерана Бездны', socketedRuneId: null, quantity: 1 };
  render(<Harness initialStorage={[{ entryId: 'astral', itemId: 'astral_focus', quantity: 1 }, amulet]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Хранилище' }));
  fireEvent.click(screen.getByRole('button', { name: 'Руна Астрального эха' }));
  expect(screen.getByRole('button', { name: 'Вставить' })).toBeEnabled();
  expect(screen.getByRole('dialog', { name: 'Предмет: Руна Астрального эха' })).not.toHaveTextContent(/^rune$/i);
  fireEvent.click(screen.getByRole('button', { name: 'Вставить' }));
  const picker = screen.getByRole('dialog', { name: 'Выбор снаряжения' });
  fireEvent.click(within(picker).getByRole('button', { name: 'Выбрать Амулет Ветерана Бездны' }));
  fireEvent.click(within(picker).getByRole('button', { name: 'Вставить' }));
  const state = JSON.parse(screen.getByTestId('state').textContent);
  expect(state.storage.find(entry => entry.instanceId === 'astral-amulet')).toMatchObject({ socketedRuneId: 'astral_focus' });
  expect(state.storage.some(entry => entry.itemId === 'astral_focus')).toBe(false);
});

test('equipment-first Rune Selection shows only compatible runes and sockets one atomically', () => {
  const armor = { instanceId: 'armor-rune-target', itemId: 'Куртка Мародёра', socketedRuneId: null, quantity: 1 };
  render(<Harness initialStorage={[armor, { entryId: 'stone', itemId: 'stone_vigil', quantity: 2 }, { entryId: 'ember', itemId: 'ember_heart', quantity: 4 }]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Хранилище' })); fireEvent.click(screen.getByRole('button', { name: 'Куртка Мародёра' })); fireEvent.click(screen.getByRole('button', { name: 'Вставить руну' }));
  const overlay = screen.getByRole('dialog', { name: 'Выбор руны' });
  expect(overlay).toHaveAttribute('data-overlay-layer', 'child');
  expect(overlay.querySelector('[data-overlay-layer="child-panel"]')).toBeVisible();
  expect(overlay).toHaveTextContent('Руна Стального Отпора'); expect(overlay).toHaveTextContent('Нагрудник · ×2'); expect(overlay).not.toHaveTextContent('Руна Пламенного сердца');
  const candidate = within(overlay).getByRole('button', { name: 'Выбрать Руна Стального Отпора' });
  const confirm = within(overlay).getByRole('button', { name: 'Вставить' });
  expect(confirm).toBeDisabled(); fireEvent.click(candidate); expect(confirm).toBeEnabled(); fireEvent.click(confirm);
  const state = JSON.parse(screen.getByTestId('state').textContent);
  expect(state.storage.find(entry => entry.instanceId === armor.instanceId)).toMatchObject({ instanceId: armor.instanceId, socketedRuneId: 'stone_vigil' });
  expect(state.storage.find(entry => entry.entryId === 'stone').quantity).toBe(1);
  expect(screen.getByRole('dialog', { name: 'Предмет: Куртка Мародёра' })).toHaveTextContent('Руна Стального Отпора');
  const persisted = JSON.parse(JSON.stringify(state.storage));
  expect(persisted.find(entry => entry.instanceId === armor.instanceId)).toMatchObject({ instanceId: armor.instanceId, socketedRuneId: 'stone_vigil' });
});

test('no-compatible Storage rune state disables insertion without opening an error picker', () => {
  const armor = { instanceId: 'armor-empty', itemId: 'Куртка Мародёра', socketedRuneId: null, quantity: 1 };
  render(<Harness initialStorage={[armor]} />); fireEvent.click(screen.getByRole('button', { name: 'Хранилище' })); fireEvent.click(screen.getByRole('button', { name: 'Куртка Мародёра' }));
  expect(screen.getByText('Нет подходящих рун')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Вставить руну' })).toBeDisabled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: 'Выбор руны' })).not.toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'Предмет: Куртка Мародёра' })).toBeInTheDocument();
});


test('Storage ring equip waits for a slot choice, supports ring2, and cancel is atomic', () => {
  const incoming = { instanceId: 'incoming-ring', itemId: 'Кольцо Туманного Мха', quantity: 1 };
  const ring1 = { instanceId: 'old-ring-1', itemId: 'Железное Кольцо Караульного' };
  const ring2 = { instanceId: 'old-ring-2', itemId: 'Кольцо Меткой Тетивы' };
  render(<Harness initialStorage={[incoming]} initialPlayer={{ ...basePlayer, equipment: { ring1, ring2 } }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Хранилище' }));
  fireEvent.click(screen.getByRole('button', { name: 'Кольцо Туманного Мха' }));
  fireEvent.click(screen.getByRole('button', { name: 'Надеть' }));
  const chooser = screen.getByRole('dialog', { name: 'Что заменить?' });
  let state = JSON.parse(screen.getByTestId('state').textContent);
  expect(state.player.equipment).toMatchObject({ ring1, ring2 });
  expect(state.storage).toEqual([incoming]);
  fireEvent.click(within(chooser).getByRole('button', { name: 'Отмена' }));
  state = JSON.parse(screen.getByTestId('state').textContent);
  expect(state.player.equipment).toMatchObject({ ring1, ring2 });
  expect(state.storage).toEqual([incoming]);
  fireEvent.click(screen.getByRole('button', { name: 'Надеть' }));
  fireEvent.click(screen.getByRole('button', { name: 'Подробнее: Кольцо Меткой Тетивы' }));
  expect(screen.getByRole('dialog', { name: 'Предмет: Кольцо Меткой Тетивы' })).toBeInTheDocument();
  state = JSON.parse(screen.getByTestId('state').textContent);
  expect(state.player.equipment).toMatchObject({ ring1, ring2 });
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Предмет: Кольцо Меткой Тетивы' })).getByRole('button', { name: 'Закрыть' }));
  fireEvent.click(screen.getByRole('button', { name: 'Заменить Кольцо 2: Кольцо Меткой Тетивы' }));
  state = JSON.parse(screen.getByTestId('state').textContent);
  expect(state.player.equipment.ring1).toMatchObject(ring1);
  expect(state.player.equipment.ring2).toMatchObject({ instanceId: 'incoming-ring', itemId: 'Кольцо Туманного Мха' });
  expect(state.storage).toEqual([expect.objectContaining(ring2)]);
});

test('legacy/internal material stacks render authored art and open canonical details', () => {
  render(<Harness initialStorage={[
    { entryId: 'legacy-mycelium', itemId: 'azure_mycelium', quantity: 21 },
    { entryId: 'legacy-spores', itemId: 'Споры', quantity: 12 },
  ]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Хранилище' }));

  const mycelium = screen.getByRole('button', { name: 'Лазурный мицелий x21' });
  expect(within(mycelium).getByRole('img', { hidden: true })).toHaveAttribute('src', expect.stringContaining('azure_mycelium.png'));
  fireEvent.click(mycelium);
  expect(screen.getByRole('dialog', { name: 'Предмет: Лазурный мицелий' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));

  const spores = screen.getByRole('button', { name: 'Блуждающие споры x12' });
  expect(within(spores).getByRole('img', { hidden: true })).toHaveAttribute('src', expect.stringContaining('wandering_spores.png'));
  fireEvent.click(spores);
  expect(screen.getByRole('dialog', { name: 'Предмет: Блуждающие споры' })).toBeInTheDocument();
});
