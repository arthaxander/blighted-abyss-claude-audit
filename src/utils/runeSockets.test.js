import { normalizeStorage } from './storageManagement';
import { canSocketRune, extractRuneToStorage, getActiveSocketedRunes, migrateLegacyRunes, socketRuneIntoEquipment, socketRuneIntoEquippedItem } from './runeSockets';

const instance = (instanceId, itemId, socketedRuneId = null) => ({ instanceId, itemId, socketedRuneId, quantity: 1 });

test('canonical rune compatibility is weapon, chest armor, and amulet only', () => {
  expect(canSocketRune('ember_heart', instance('w', 'Тесак Гоблинского Мясника'), 'mainHand')).toBe(true);
  expect(canSocketRune('stone_vigil', instance('a', 'Куртка Мародёра'), 'armor')).toBe(true);
  expect(canSocketRune('astral_focus', instance('m', 'Амулет Ветерана Бездны'), 'amulet')).toBe(true);
  expect(canSocketRune('astral_focus', instance('r', 'Кольцо Туманного Мха'), 'ring1')).toBe(false);
  expect(canSocketRune('stone_vigil', instance('s', 'Щит Новобранца'), 'offHand')).toBe(false);
});

test('socketing consumes exactly one rune atomically and active authority is equipped gear', () => {
  const weapon = instance('w', 'Тесак Гоблинского Мясника');
  const runes = [{ entryId: 'r', itemId: 'ember_heart', quantity: 5 }];
  const result = socketRuneIntoEquipment({ equipment: { mainHand: weapon }, equipmentSlot: 'mainHand', runeId: 'ember_heart', sourceEntries: runes });
  expect(result.success).toBe(true); expect(result.sourceEntries[0].quantity).toBe(4);
  expect(getActiveSocketedRunes(result.equipment)).toEqual({ mainHand: 'ember_heart' });
  expect(getActiveSocketedRunes({ mainHand: weapon })).toEqual({});
});

test('Run Inventory socket source preserves slot positions and cannot overwrite a socket', () => {
  const weapon = instance('run-w', 'Ржавый меч новобранца');
  const slots = [{ itemId: 'ember_heart', quantity: 1 }, null, weapon, null];
  const result = socketRuneIntoEquipment({ equipment: { mainHand: weapon }, equipmentSlot: 'mainHand', runeId: 'ember_heart', sourceEntries: slots, preserveSourceSlots: true });
  expect(result.success).toBe(true);
  expect(result.sourceEntries).toEqual([null, null, weapon, null]);
  expect(result.equipment.mainHand).toMatchObject({ instanceId: 'run-w', socketedRuneId: 'ember_heart' });
  const rejected = socketRuneIntoEquipment({ equipment: result.equipment, equipmentSlot: 'mainHand', runeId: 'ember_heart', sourceEntries: slots, preserveSourceSlots: true });
  expect(rejected).toMatchObject({ success: false, equipment: result.equipment, sourceEntries: slots });
});

test('equipped-slot transaction atomically upgrades a legacy target and reports stale picker identity', () => {
  const slots = [null, { itemId: 'astral_focus', quantity: 1 }, null];
  const equipment = { amulet: 'Амулет Крысиной Жилы' };
  const result = socketRuneIntoEquippedItem({ equipment, equipmentSlot: 'amulet', expectedItemId: 'Амулет Крысиной Жилы', runeId: 'astral_focus', sourceEntries: slots, preserveSourceSlots: true });
  expect(result).toMatchObject({ success: true, equipment: { amulet: { itemId: 'Амулет Крысиной Жилы', socketedRuneId: 'astral_focus' } }, sourceEntries: [null, null, null] });
  expect(result.equipment.amulet.instanceId).toBeTruthy();
  const stale = socketRuneIntoEquippedItem({ equipment, equipmentSlot: 'amulet', expectedItemId: 'Амулет Ветерана Бездны', runeId: 'astral_focus', sourceEntries: slots, preserveSourceSlots: true });
  expect(stale).toMatchObject({ success: false, reason: 'target-not-found', equipment, sourceEntries: slots });
});

test('combat socketing and run extraction are rejected without mutation', () => {
  const equipment = { mainHand: instance('w', 'Тесак Гоблинского Мясника') }; const sourceEntries = [{ entryId: 'r', itemId: 'ember_heart', quantity: 1 }];
  expect(socketRuneIntoEquipment({ equipment, equipmentSlot: 'mainHand', runeId: 'ember_heart', sourceEntries, inCombat: true })).toMatchObject({ success: false, equipment, sourceEntries });
  const socketed = { mainHand: instance('w', 'Тесак Гоблинского Мясника', 'ember_heart') };
  expect(extractRuneToStorage({ equipment: socketed, equipmentSlot: 'mainHand', storage: [], inGuild: false })).toMatchObject({ success: false, equipment: socketed });
});

test('free Guild extraction merges and capacity failure preserves socket', () => {
  const equipment = { mainHand: instance('w', 'Тесак Гоблинского Мясника', 'ember_heart') };
  const result = extractRuneToStorage({ equipment, equipmentSlot: 'mainHand', storage: [{ entryId: 'r', itemId: 'ember_heart', quantity: 998 }], inGuild: true });
  expect(result.success).toBe(true); expect(result.silverCost).toBe(0); expect(result.storage[0].quantity).toBe(999); expect(result.equipment.mainHand.socketedRuneId).toBeNull();
});

test('legacy abstract runes migrate with exact conservation and no remaining authority', () => {
  const migrated = migrateLegacyRunes({ equipment: { mainHand: 'Тесак Гоблинского Мясника' }, runes: { slots: { weapon: 'ember_heart', ring: 'astral_focus' }, inventory: ['stone_vigil'] }, storage: normalizeStorage([]) });
  expect(migrated.equipment.mainHand.socketedRuneId).toBe('ember_heart');
  expect(migrated.storage.reduce((sum, entry) => sum + entry.quantity, 0)).toBe(2);
  expect(migrated.runes).toEqual({ slots: {}, inventory: [] });
  expect(migrated.pendingRuneMigration).toEqual([]);
});
