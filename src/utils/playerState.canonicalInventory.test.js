import { buildPlayerSnapshot, hydratePlayerSnapshot } from './playerState';

const equipment = { armor: { itemId: 'Куртка Новобранца', instanceId: 'equipped-1', quantity: 1 } };

test('old flat inventory and name-based Safe inputs migrate once into canonical typed slots', () => {
  const hydrated = hydratePlayerSnapshot({ class: 'Defender', equipment, inventory: ['Простая ткань', 'Обрывки кожи'], safeSlots: ['Обрывки кожи'] });
  expect(hydrated.runInventory[0]).toMatchObject({ itemId: 'Обрывки кожи', quantity: 1 });
  expect(hydrated.runInventory.some(stack => stack?.itemId === 'Простая ткань')).toBe(true);
  expect(hydrated.inventory).toBeUndefined(); expect(hydrated.safeSlots).toBeUndefined();
});

test('resaving migrated state persists one inventory source and unique equipment ownership', () => {
  const hydrated = hydratePlayerSnapshot({ class: 'Defender', equipment, inventory: [equipment.armor, 'Простая ткань'] });
  const saved = buildPlayerSnapshot(hydrated);
  expect(saved.inventory).toBeUndefined(); expect(saved.safeSlots).toBeUndefined();
  expect(saved.runInventory.filter(stack => stack?.instanceId === 'equipped-1')).toHaveLength(0);
  expect(Object.values(saved.equipment).filter(item => item?.instanceId === 'equipped-1')).toHaveLength(1);
});

test('changed class equipment rules return the exact socketed instance to typed ownership', () => {
  const incompatible = { itemId: 'Ржавый меч новобранца', instanceId: 'old-sword', socketedRuneId: 'stone_vigil', quantity: 1 };
  const hydrated = hydratePlayerSnapshot({ class: 'Mage', equipment: { mainHand: incompatible }, inventory: [] });
  expect(hydrated.equipment.mainHand).toBeNull();
  expect(hydrated.runInventory.filter(stack => stack?.instanceId === incompatible.instanceId)).toEqual([
    expect.objectContaining({ itemId: incompatible.itemId, instanceId: incompatible.instanceId, socketedRuneId: incompatible.socketedRuneId }),
  ]);
});
