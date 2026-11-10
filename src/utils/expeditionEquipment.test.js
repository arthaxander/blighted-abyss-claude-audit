import { buildPlayerSnapshot, hydratePlayerSnapshot } from './playerState';
import {
  applyExpeditionDeath,
  createItemStack,
  equipRunInventoryItem,
  getRunInventoryCapacity,
  getStackLimit,
  normalizeInventorySlots,
  unequipRunEquipment,
} from './expeditionInventory';
import { ITEM_DATA } from '../data/items';
import { equipmentByName } from '../data/equipment';

const playerWith = (items, extra = {}) => ({
  name: 'Герой', class: 'Defender', hp: 100, maxHp: 100, abilities: [],
  equipment: { helmet: null, armor: null, mainHand: null, offHand: null, ring1: null, ring2: null, amulet: null, bag: null },
  runInventory: normalizeInventorySlots(items, extra.capacity || 26), inventory: [], ...extra,
});

describe('expedition equipment operations', () => {
  test('equips metadata equipment from its cell and blocks combat changes', () => {
    const player = playerWith([null, null, createItemStack('Ржавый меч новобранца')]);
    expect(equipRunInventoryItem(player, 2, { inCombat: true })).toMatchObject({ success: false });
    const result = equipRunInventoryItem(player, 2, { inCombat: false });
    expect(result.success).toBe(true); expect(result.player.equipment.mainHand).toBe('Ржавый меч новобранца'); expect(result.player.runInventory[2]).toBeNull();
  });

  test('full inventory swap returns old gear to exact source, including a safe source', () => {
    const full = normalizeInventorySlots([], 26); [0, 1, ...Array.from({ length: 10 }, (_, i) => i + 2)].forEach(i => { full[i] = createItemStack('Простая ткань', 1); });
    full[0] = createItemStack('Тесак Гоблинского Мясника');
    const player = playerWith(full, { equipment: { mainHand: 'Ржавый меч новобранца' } });
    const result = equipRunInventoryItem(player, 0);
    expect(result.success).toBe(true); expect(result.player.equipment.mainHand).toBe('Тесак Гоблинского Мясника'); expect(result.player.runInventory[0].itemId).toBe('Ржавый меч новобранца');
  });

  test('unequip uses ordinary space, never an empty safe cell, and blocks when ordinary cells are full', () => {
    let player = playerWith([], { equipment: { mainHand: 'Ржавый меч новобранца' } });
    let result = unequipRunEquipment(player, 'mainHand');
    expect(result.success).toBe(true); expect(result.player.runInventory[0]).toBeNull(); expect(result.player.runInventory[1]).toBeNull(); expect(result.player.runInventory[2].itemId).toBe('Ржавый меч новобранца');
    const fullOrdinary = normalizeInventorySlots([createItemStack('Простая ткань'), createItemStack('Простая ткань'), ...Array(10).fill(createItemStack('Простая ткань'))], 26);
    player = { ...player, runInventory: fullOrdinary };
    expect(unequipRunEquipment(player, 'mainHand')).toMatchObject({ success: false, reason: 'Нет свободной обычной или безопасной ячейки' });
  });

  test('bag removal migrates extension items, returns the bag, and preserves safe slots', () => {
    const equipment = { bag: 'Походная сумка Гильдии' };
    let player = playerWith([], { capacity: 32, equipment });
    player.runInventory[0] = createItemStack('Эссенция Проклятий');
    player.runInventory[1] = createItemStack('Простая ткань');
    player.runInventory[31] = createItemStack('Простая ткань');
    const result = unequipRunEquipment(player, 'bag');
    expect(result.success).toBe(true); expect(result.player.runInventory).toHaveLength(26);
    expect(result.player.runInventory[0]).toEqual(player.runInventory[0]); expect(result.player.runInventory[1]).toEqual(player.runInventory[1]);
    expect(result.player.runInventory.slice(2).map(stack => stack?.itemId).filter(Boolean)).toEqual(['Походная сумка Гильдии', 'Простая ткань']);
  });

  test('bag removal counts the returned bag, reports a dynamic deficit, and never mutates failure state', () => {
    const equipment = { bag: 'Походная сумка Гильдии' };
    const slots = normalizeInventorySlots([null, null, ...Array(12).fill(createItemStack('Ржавый меч новобранца'))], 32);
    const player = playerWith(slots, { capacity: 32, equipment, runInventory: slots });
    const result = unequipRunEquipment(player, 'bag');
    expect(result).toMatchObject({ success: false, code: 'BAG_REMOVAL_CAPACITY', deficit: 3, title: 'Нельзя снять сумку' });
    expect(result.reason).toBe('После снятия в инвентаре не хватит места для всех предметов. Освободите 3 ячеек и попробуйте снова.');
    expect(result.player).toBe(player); expect(player.equipment).toEqual(equipment); expect(player.runInventory).toEqual(slots);
  });

  test('bag replacement validates the final lower capacity atomically', () => {
    const fakeName = 'Тестовая малая сумка';
    const fakeItem = { name: fakeName, type: 'equipment', equipmentType: 'Bag', class: 'Any', inventorySlotBonuses: { general: 1, consumable: 0, resource: 0 }, rarity: 'Обычная' };
    ITEM_DATA.push(fakeItem); equipmentByName[fakeName] = { name: fakeName, type: 'Bag', class: 'Any', inventorySlotBonuses: { general: 1, consumable: 0, resource: 0 }, stats: {} };
    try {
      const sparseSlots = normalizeInventorySlots([null, null, createItemStack(fakeName), null, createItemStack('Простая ткань')], 32);
      const sparsePlayer = playerWith(sparseSlots, { capacity: 32, equipment: { bag: 'Походная сумка Гильдии' }, runInventory: sparseSlots });
      const valid = equipRunInventoryItem(sparsePlayer, 2);
      expect(valid.success).toBe(true); expect(valid.player.equipment.bag).toBe(fakeName); expect(valid.player.runInventory).toHaveLength(27);
      expect(valid.player.runInventory.slice(2).map(stack => stack?.itemId).filter(Boolean)).toEqual(['Походная сумка Гильдии', 'Простая ткань']);
      const slots = normalizeInventorySlots([null, null, createItemStack(fakeName), ...Array(12).fill(createItemStack('Ржавый меч новобранца'))], 32);
      const player = playerWith(slots, { capacity: 32, equipment: { bag: 'Походная сумка Гильдии' }, runInventory: slots });
      const result = equipRunInventoryItem(player, 2);
      expect(result).toMatchObject({ success: false, code: 'BAG_REPLACEMENT_CAPACITY', deficit: 2, title: 'Нельзя сменить сумку' });
      expect(result.reason).toBe('После замены в инвентаре не хватит места для всех предметов. Освободите 2 ячеек и попробуйте снова.');
      expect(result.player).toBe(player); expect(player.equipment.bag).toBe('Походная сумка Гильдии'); expect(player.runInventory).toEqual(slots);
    } finally {
      ITEM_DATA.pop(); delete equipmentByName[fakeName];
    }
  });

  test('equipped fishing tool uses no cell, swaps atomically, persists, and is lost on death', () => {
    let player = playerWith([null, null, createItemStack('Костяная удочка'), createItemStack('Светлячный мотыль', 20)]);
    let result = equipRunInventoryItem(player, 2);
    expect(result.success).toBe(true); expect(result.player.fishingTool).toBe('Костяная удочка'); expect(result.player.runInventory[2]).toBeNull(); expect(getStackLimit('Светлячный мотыль')).toBe(20);
    result.player.runInventory[2] = createItemStack('Жезл глубинного лова');
    result = equipRunInventoryItem(result.player, 2);
    expect(result.player.fishingTool).toBe('Жезл глубинного лова'); expect(result.player.runInventory[2].itemId).toBe('Костяная удочка');
    const restored = hydratePlayerSnapshot(buildPlayerSnapshot(result.player));
    expect(restored.fishingTool).toBe('Жезл глубинного лова'); expect(restored.runInventory.filter(stack => stack?.itemId === 'Жезл глубинного лова')).toHaveLength(0);
    const dead = applyExpeditionDeath({ ...restored, runInventory: normalizeInventorySlots([createItemStack('Светлячный мотыль', 4)], 10) });
    expect(dead.fishingTool).toBeNull(); expect(dead.runInventory[0].quantity).toBe(4);
  });

  test('equipped bag expands capacity without occupying a cell', () => {
    const player = playerWith([null, null, createItemStack('Походная сумка Гильдии')]);
    const result = equipRunInventoryItem(player, 2);
    expect(result.success).toBe(true); expect(getRunInventoryCapacity(result.player.equipment)).toBe(32); expect(result.player.runInventory).toHaveLength(32); expect(result.player.runInventory.filter(Boolean)).toHaveLength(0);
  });
});

test('occupied equivalent ring slots require an explicit preferred slot', () => {
  const ring = { itemId: 'Кольцо Туманного Мха', quantity: 1 };
  const player = playerWith([ring], { equipment: { ring1: 'Кольцо Туманного Мха', ring2: 'Кольцо Туманного Мха' } });
  const unresolved = equipRunInventoryItem(player, 0);
  expect(unresolved).toMatchObject({ success: false, requiresSlotChoice: true, player });
  const resolved = equipRunInventoryItem(player, 0, {}, 'ring2');
  expect(resolved.success).toBe(true);
  expect(resolved.player.equipment.ring1).toBe(player.equipment.ring1);
});
