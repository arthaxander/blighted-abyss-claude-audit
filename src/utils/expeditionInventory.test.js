import { ITEM_DATA } from '../data/items';
import { GUILD_STASH_CAPACITY } from '../constants/gameplay';
import {
  applyExpeditionDeath, bankRunSilver, createExpeditionDeathResult, createItemStack, discardInventoryStack, extractRunInventory,
  getRunInventoryCapacity, getRunInventoryLayout, getStackLimit, hasOrdinaryFreeInventorySlot, insertItems, isSafeSlotIndex, moveInventoryStack,
  normalizeInventorySlots, simulateItemInsertion, sortOrdinaryInventory, slotsToLegacyInventory,
  unloadRunInventoryToStash,
} from './expeditionInventory';

describe('expedition inventory domain', () => {
  test('base and bag capacity keep exactly two fixed safe cells', () => {
    expect(getRunInventoryCapacity()).toBe(26);
    expect(getRunInventoryCapacity({ bag: 'Походная сумка Гильдии' })).toBe(32);
    expect([0, 1, 2, 13].map(isSafeSlotIndex)).toEqual([true, true, false, false]);
  });
  test('departure space ignores empty safe cells and respects bag-expanded ordinary cells', () => {
    const baseFullOrdinary = normalizeInventorySlots([null, null, ...Array(10).fill(createItemStack('Простая ткань'))], 26);
    expect(hasOrdinaryFreeInventorySlot({ equipment: {}, runInventory: baseFullOrdinary })).toBe(false);
    baseFullOrdinary[11] = null;
    expect(hasOrdinaryFreeInventorySlot({ equipment: {}, runInventory: baseFullOrdinary })).toBe(true);
    const bagSlots = normalizeInventorySlots([null, null, ...Array(11).fill(createItemStack('Обрывки кожи')), null], 32);
    expect(hasOrdinaryFreeInventorySlot({ equipment: { bag: 'Походная сумка Гильдии' }, runInventory: bagSlots })).toBe(true);
    bagSlots[13] = createItemStack('Обрывки кожи');
    expect(hasOrdinaryFreeInventorySlot({ equipment: { bag: 'Походная сумка Гильдии' }, runInventory: bagSlots })).toBe(false);
  });
  test('a legacy ten-cell layout expands without moving or losing stacks', () => {
    const old = normalizeInventorySlots(Array.from({ length: 10 }, (_, index) => createItemStack(`legacy-${index}`)), 10);
    const expanded = normalizeInventorySlots(old, getRunInventoryCapacity());
    expect(expanded).toHaveLength(26);
    expect(expanded.slice(0, 10)).toEqual(old);
    expect(expanded.slice(10)).toEqual(Array(16).fill(null));
  });
  test('legacy safe-slot names migrate into fixed positions', () => {
    const { legacyInventoryToSlots } = require('./expeditionInventory');
    const slots = legacyInventoryToSlots(['Простая ткань', 'Обрывки кожи'], 10, ['Обрывки кожи']);
    expect(slots[0].itemId).toBe('Обрывки кожи'); expect(slots[1]).toBeNull();
  });
  test('category stack policy overrides legacy definition sizes', () => {
    expect(getStackLimit('Простая ткань')).toBe(20);
    expect(getStackLimit('Эссенция Проклятий')).toBe(5);
    expect(getStackLimit('Кровяная припарка')).toBe(3);
    expect(getStackLimit(ITEM_DATA.find(item => item.type === 'equipment'))).toBe(1);
  });
  test('fills compatible partial stack before the first free cell', () => {
    const slots = normalizeInventorySlots([{ itemId: 'Простая ткань', quantity: 17 }], 10);
    const result = insertItems(slots, [{ itemId: 'Простая ткань', quantity: 8 }], { layout: getRunInventoryLayout() });
    expect(result.slots[0]).toEqual({ itemId: 'Простая ткань', quantity: 17 });
    expect(result.slots[14]).toEqual({ itemId: 'Простая ткань', quantity: 8 });
  });
  test('capacity simulation accounts for partial stacks', () => {
    const slots = normalizeInventorySlots([{ itemId: 'Простая ткань', quantity: 18 }], 2);
    expect(simulateItemInsertion(slots, [{ itemId: 'Простая ткань', quantity: 3 }]).additionalSlotsRequired).toBe(1);
  });
  test('drag swaps and compatible drag merges with source overflow', () => {
    let slots = normalizeInventorySlots([createItemStack('Простая ткань', 8), createItemStack('Простая ткань', 17)], 3);
    slots = moveInventoryStack(slots, 0, 1);
    expect(slots.slice(0, 2)).toEqual([{ itemId: 'Простая ткань', quantity: 5 }, { itemId: 'Простая ткань', quantity: 20 }]);
    slots = moveInventoryStack(slots, 0, 2);
    expect(slots[0]).toBeNull(); expect(slots[2].quantity).toBe(5);
  });
  test('sort never moves safe slots and discard removes whole stack', () => {
    const slots = normalizeInventorySlots([createItemStack('Эссенция Проклятий'), null, createItemStack('Простая ткань'), createItemStack('Малое зелье здоровья')], 26);
    const sorted = sortOrdinaryInventory(slots, getRunInventoryLayout());
    expect(sorted[0].itemId).toBe('Эссенция Проклятий'); expect(sorted[1]).toBeNull();
    expect(discardInventoryStack(sorted, 0)[0]).toBeNull();
  });
  test('death retains safe cells but loses ordinary cells, gear, bag, and run silver', () => {
    const dead = applyExpeditionDeath({ runInventory: normalizeInventorySlots([createItemStack('Простая ткань'), createItemStack('Эссенция Проклятий'), createItemStack('Обрывки кожи')], 10), equipment: { mainHand: 'weapon', bag: 'bag' }, runSilver: 43, guildSilver: 90 });
    expect(dead.runInventory.filter(Boolean)).toHaveLength(2); expect(dead.equipment).toEqual({ mainHand: null, bag: null }); expect(dead.runSilver).toBe(0); expect(dead.guildSilver).toBe(90);
  });
  test('successful extraction banks silver and preserves carry layout and equipment independent of stash', () => {
    expect(bankRunSilver({ guildSilver: 10, runSilver: 4 })).toMatchObject({ guildSilver: 14, runSilver: 0 });
    const runInventory = normalizeInventorySlots([createItemStack('Обрывки кожи'), null, createItemStack('Простая ткань', 7)], 32);
    const equipment = { mainHand: 'Ржавый меч новобранца', bag: 'Походная сумка Гильдии' };
    const result = extractRunInventory({ runInventory, equipment, fishingTool: 'Костяная удочка', guildSilver: 1, runSilver: 2, pendingReturnItems: [{ itemId: 'legacy' }] });
    expect(result.player).toMatchObject({ guildSilver: 3, runSilver: 0, equipment, fishingTool: 'Костяная удочка', pendingReturnItems: [{ itemId: 'legacy' }] });
    expect(result.player.runInventory).toEqual(runInventory);
    expect(result.player.inventory).toBeUndefined();
    expect(result).not.toHaveProperty('pendingReturnItems');
  });

  test('death loses carried Silver only while extraction banks it exactly once', () => {
    expect(applyExpeditionDeath({ silver: 1000, guildSilver: 1000, runSilver: 280, equipment: {}, runInventory: [] }))
      .toMatchObject({ silver: 1000, guildSilver: 1000, runSilver: 0 });
    expect(bankRunSilver({ silver: 1000, guildSilver: 1000, runSilver: 280 }))
      .toMatchObject({ silver: 1280, guildSilver: 1280, runSilver: 0 });
    expect(applyExpeditionDeath({ silver: 1000, guildSilver: 1000, runSilver: 0, equipment: {}, runInventory: [] }))
      .toMatchObject({ silver: 1000, guildSilver: 1000, runSilver: 0 });
    const nextRun = applyExpeditionDeath(bankRunSilver({ silver: 1000, guildSilver: 1000, runSilver: 280 }));
    expect(nextRun).toMatchObject({ silver: 1280, guildSilver: 1280, runSilver: 0 });
  });
  test('death result captures only exact Safe Slot stacks before reset', () => {
    const result = createExpeditionDeathResult({ equipment: {}, runInventory: normalizeInventorySlots([createItemStack('Простая ткань', 3), null, createItemStack('Обрывки кожи', 8)], 12) });
    expect(result.preservedStacks).toEqual([expect.objectContaining({ itemId: 'Простая ткань', quantity: 3 })]);
    expect(result.player.runInventory.filter(Boolean)).toHaveLength(1);
  });
  test('unload-all uses long-term 999 stacks without touching equipment', () => {
    const runInventory = normalizeInventorySlots([createItemStack('Простая ткань', 8), createItemStack('Обрывки кожи', 2), createItemStack('Малое зелье здоровья', 2)], 12);
    const stash = Array(GUILD_STASH_CAPACITY).fill(createItemStack('Эссенция Проклятий', 5));
    stash[0] = createItemStack('Простая ткань', 17);
    stash[1] = null;
    const equipment = { mainHand: 'Ржавый меч новобранца', bag: null };
    const result = unloadRunInventoryToStash({ runInventory, equipment, fishingTool: 'Костяная удочка' }, stash);
    expect(result.stashSlots.find(entry => entry.itemId === 'Простая ткань')).toMatchObject({ quantity: 25 });
    expect(result.player.runInventory[0]).toBeNull();
    expect(result.player.runInventory[1]).toBeNull();
    expect(result.player.runInventory[2]).toBeNull();
    expect(result).toMatchObject({ movedQuantity: 12, remainingQuantity: 0 });
    expect(result.player).toMatchObject({ equipment, fishingTool: 'Костяная удочка' });
    expect(result.player.inventory).toBeUndefined();
  });

  test('unload-rest is one transaction that preserves kept and Safe slots and commits multiple distinct entries', () => {
    const gear = { itemId: 'Капюшон Искателя Знаков', quantity: 1, instanceId: 'gear-one', socketedRuneId: 'stone_vigil' };
    const runInventory = normalizeInventorySlots([
      createItemStack('Эссенция Проклятий', 2), createItemStack('Обрывки кожи', 3),
      createItemStack('Простая ткань', 4), createItemStack('Малое зелье здоровья', 2), gear,
    ], 26);
    const result = unloadRunInventoryToStash({ equipment: {}, runInventory }, [], { keepSlotIndices: new Set([0, 1, 3]) });
    expect(result).toMatchObject({ movedQuantity: 5, remainingQuantity: 0 });
    expect([0, 1, 3].map(index => result.player.runInventory[index])).toEqual([runInventory[0], runInventory[1], runInventory[3]]);
    expect(result.player.runInventory[2]).toBeNull(); expect(result.player.runInventory[4]).toBeNull();
    expect(result.storageItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: 'Простая ткань', quantity: 4 }),
      expect.objectContaining({ itemId: gear.itemId, instanceId: gear.instanceId, socketedRuneId: gear.socketedRuneId }),
    ]));
    expect(result.storageItems.filter(Boolean)).toHaveLength(2);
  });

  test('unload-rest keeps rejected entries in their original slots after earlier moves fill Storage', () => {
    const fullStorage = Array(GUILD_STASH_CAPACITY).fill(null).map((_, index) => ({ itemId: `full-${index}`, quantity: 1, instanceId: `full-${index}` }));
    fullStorage[0] = null;
    const first = { itemId: 'Капюшон Искателя Знаков', quantity: 1, instanceId: 'first-instance', socketedRuneId: 'stone_vigil' };
    const rejected = { itemId: 'Куртка Мародёра', quantity: 1, instanceId: 'rejected-instance', socketedRuneId: 'test-rune' };
    const runInventory = normalizeInventorySlots([null, null, first, rejected], 26);
    const result = unloadRunInventoryToStash({ equipment: {}, runInventory }, fullStorage, { keepSlotIndices: [0, 1] });
    expect(result).toMatchObject({ movedQuantity: 1, remainingQuantity: 1 });
    expect(result.player.runInventory[2]).toBeNull();
    expect(result.player.runInventory[3]).toEqual(rejected);
    expect(result.storageItems.find(entry => entry?.instanceId === first.instanceId)).toMatchObject(first);
    expect([...result.storageItems, ...result.player.runInventory].filter(entry => entry?.instanceId === first.instanceId)).toHaveLength(1);
    expect([...result.storageItems, ...result.player.runInventory].filter(entry => entry?.instanceId === rejected.instanceId)).toHaveLength(1);
  });
});

test('canonical death and unload transactions strip contaminated legacy ownership fields', () => {
  const contaminated = {
    equipment: {},
    runInventory: normalizeInventorySlots([createItemStack('Простая ткань'), null, createItemStack('Обрывки кожи')], 26),
    inventory: ['duplicate'],
    safeSlots: ['duplicate'],
  };
  const dead = applyExpeditionDeath(contaminated);
  expect(dead.runInventory[0]).toMatchObject({ itemId: 'Простая ткань' });
  expect(dead.inventory).toBeUndefined(); expect(dead.safeSlots).toBeUndefined();
  const unloaded = unloadRunInventoryToStash(contaminated, []);
  expect(unloaded.player.runInventory.filter(Boolean)).toHaveLength(0);
  expect(unloaded.player.inventory).toBeUndefined(); expect(unloaded.player.safeSlots).toBeUndefined();
});

describe('abyss link sever death result', () => {
  test('preserves safe slots but explicitly disables relic insurance', () => {
    const { createExpeditionDeathResult } = require('./expeditionInventory');
    const player = {
      runInventory: [{ itemId: 'Простая ткань', quantity: 1 }, null, { itemId: 'Простая ткань', quantity: 2 }],
      equipment: {}, runSilver: 50,
      relics: { activeRelicId: 'guild_recruit_seal', progress: { guild_recruit_seal: { level: 10 } } },
    };
    const result = createExpeditionDeathResult(player, { rng: () => 0, allowInsurance: false });
    expect(result.preservedStacks).toEqual([{ itemId: 'Простая ткань', quantity: 1 }]);
    expect(result.insurance).toMatchObject({ eligible: false, successful: false, reason: 'disabled' });
    expect(result.player.runSilver).toBe(0);
  });
});
