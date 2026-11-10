import { equipmentByName } from '../data/equipment';
import { normalizeStorage } from './storageManagement';
import { depositRunInventoryEntry, equipStorageEntry, withdrawStorageEntry } from './storageTransactions';
import { equipRunInventoryItem } from './expeditionInventory';
import { buildPlayerSnapshot, hydratePlayerSnapshot } from './playerState';
import { prepareFreshDungeonRun } from './dungeonRunState';

const instance = (instanceId, itemId, socketedRuneId = null) => ({ instanceId, itemId, socketedRuneId, quantity: 1 });
const player = (overrides = {}) => ({ class: 'Defender', inventory: [], runInventory: Array(12).fill(null), equipment: {}, runes: { slots: {}, inventory: [] }, maxHp: 100, hp: 100, ...overrides });

test('full inventory rejects equipment atomically but permits a compatible partial stack', () => {
  const hood = instance('hood', 'Капюшон Искателя Знаков');
  const full = Array.from({ length: 12 }, (_, i) => ({ itemId: `item-${i}`, quantity: 1 }));
  const failed = withdrawStorageEntry({ storageItems: [hood], player: player({ runInventory: full }), entryId: 'hood' });
  expect(failed).toMatchObject({ success: false, reason: 'inventory-full', storageItems: [hood] });
  expect(failed.player.runInventory).toBe(full);
  const partial = [...full]; partial[14] = { itemId: 'Простая ткань', quantity: 19 };
  const success = withdrawStorageEntry({ storageItems: [{ entryId: 'cloth', itemId: 'Простая ткань', quantity: 2 }], player: player({ runInventory: partial }), entryId: 'cloth', quantity: 1 });
  expect(success.success).toBe(true); expect(success.player.runInventory[14].quantity).toBe(20); expect(success.storageItems[0].quantity).toBe(1);
});

test('single Run Inventory deposit conserves stacks and preserves equipment identity atomically', () => {
  const clothPlayer = player({ runInventory: [{ itemId: 'Простая ткань', quantity: 13 }, ...Array(11).fill(null)] });
  const cloth = depositRunInventoryEntry({ storageItems: [{ entryId: 'cloth', itemId: 'Простая ткань', quantity: 654 }], player: clothPlayer, sourceIndex: 0, quantity: 1 });
  expect(cloth.success).toBe(true);
  expect(cloth.player.runInventory[0].quantity).toBe(12);
  expect(cloth.storageItems[0].quantity).toBe(655);
  expect(cloth.player.runInventory[0].quantity + cloth.storageItems[0].quantity).toBe(667);

  const gear = instance('deposit-gear', 'Капюшон Искателя Знаков', 'stone_vigil');
  const gearPlayer = player({ runInventory: [gear, ...Array(11).fill(null)] });
  const moved = depositRunInventoryEntry({ storageItems: [], player: gearPlayer, sourceIndex: 0 });
  expect(moved.storageItems[0]).toMatchObject(gear);
  expect(moved.player.runInventory[0]).toBeNull();
  expect([...moved.storageItems, ...moved.player.runInventory.filter(Boolean)].filter(item => item.instanceId === gear.instanceId)).toHaveLength(1);
});

test('failed single deposit returns the original player and Storage references without deletion', () => {
  const gear = instance('blocked-gear', 'Капюшон Искателя Знаков', 'stone_vigil');
  const sourcePlayer = player({ runInventory: [gear, ...Array(11).fill(null)] });
  const full = Array.from({ length: 300 }, (_, index) => instance(`full-${index}`, 'Куртка Новобранца'));
  const result = depositRunInventoryEntry({ storageItems: full, player: sourcePlayer, sourceIndex: 0 });
  expect(result).toMatchObject({ success: false, player: sourcePlayer, storageItems: full, reason: 'capacity' });
  expect(sourcePlayer.runInventory[0]).toBe(gear);
});

test('repeated withdrawal cannot duplicate an equipment instance', () => {
  const hood = instance('hood', 'Капюшон Искателя Знаков', 'astral_focus');
  const first = withdrawStorageEntry({ storageItems: [hood], player: player(), entryId: 'hood' });
  const second = withdrawStorageEntry({ storageItems: first.storageItems, player: first.player, entryId: 'hood' });
  expect(first.success).toBe(true); expect(second).toMatchObject({ success: false, reason: 'source-missing' });
  expect(first.player.runInventory.filter(entry => entry?.instanceId === 'hood')).toHaveLength(1);
});

test('Storage direct equip swaps to the source container and succeeds one-for-one at 300/300', () => {
  const incoming = instance('new-hood', 'Капюшон Искателя Знаков', 'astral_focus');
  const old = instance('old-hood', 'Капюшон Следопыта', 'ember_heart');
  const fillers = Array.from({ length: 299 }, (_, i) => instance(`f-${i}`, 'Куртка Новобранца'));
  const result = equipStorageEntry({ storageItems: [incoming, ...fillers], player: player({ equipment: { helmet: old } }), entryId: incoming.instanceId });
  expect(result.success).toBe(true);
  expect(result.player.equipment.helmet).toMatchObject({ instanceId: incoming.instanceId, itemId: incoming.itemId, socketedRuneId: incoming.socketedRuneId });
  expect(result.storageItems.find(entry => entry.instanceId === old.instanceId)).toMatchObject(old);
  expect(result.storageItems).toHaveLength(300);
  expect(result.storageItems.some(entry => entry.instanceId === incoming.instanceId)).toBe(false);
});

test('two-handed Storage equip displaces main and off hand and aborts if final Storage lacks the net slot', () => {
  const twoHandedName = Object.values(equipmentByName).find(item => item.type === 'Weapon' && item.hands === 2 && item.class === 'Defender')?.name || 'Алебарда Пограничного Дозора';
  const incoming = instance('two-hand', twoHandedName);
  const main = instance('main', 'Ржавый меч новобранца'); const off = instance('off', 'Щит Новобранца');
  const base = player({ equipment: { mainHand: main, offHand: off } });
  const success = equipStorageEntry({ storageItems: [incoming], player: base, entryId: incoming.instanceId });
  expect(success.success).toBe(true); expect(success.displaced.map(item => item.instanceId).sort()).toEqual(['main', 'off']);
  const full = [incoming, ...Array.from({ length: 299 }, (_, i) => instance(`f-${i}`, 'Куртка Новобранца'))];
  const failed = equipStorageEntry({ storageItems: full, player: base, entryId: incoming.instanceId });
  expect(failed).toMatchObject({ success: false, reason: 'storage-full', storageItems: full, player: base });
});

test('Run Inventory-origin two-handed swap returns both displaced instances to Run Inventory atomically', () => {
  const incoming = instance('two-hand', 'Алебарда Пограничного Дозора');
  const main = instance('main', 'Ржавый меч новобранца'); const off = instance('off', 'Щит Новобранца');
  const slots = [null, null, incoming, ...Array(9).fill(null)];
  const before = player({ runInventory: slots, equipment: { mainHand: main, offHand: off } });
  const result = equipRunInventoryItem(before, 2);
  expect(result.success).toBe(true);
  expect(result.player.equipment.mainHand).toMatchObject({ instanceId: 'two-hand' });
  expect(result.player.runInventory.filter(Boolean).map(item => item.instanceId).sort()).toEqual(['main', 'off']);
});

test('Storage rings auto-fill empty equivalent slots and defer when both are occupied', () => {
  const incoming = { instanceId: 'new-ring', itemId: 'Кольцо Туманного Мха', quantity: 1 };
  const empty = equipStorageEntry({ storageItems: [incoming], player: player({ equipment: {} }), entryId: incoming.instanceId });
  expect(empty.success).toBe(true); expect(empty.player.equipment.ring1).toMatchObject({ instanceId: 'new-ring' });
  const one = equipStorageEntry({ storageItems: [incoming], player: player({ equipment: { ring1: 'Железное Кольцо Караульного' } }), entryId: incoming.instanceId });
  expect(one.success).toBe(true); expect(one.player.equipment.ring2).toMatchObject({ instanceId: 'new-ring' });
  const occupiedPlayer = player({ equipment: { ring1: 'Железное Кольцо Караульного', ring2: 'Кольцо Меткой Тетивы' } });
  const deferred = equipStorageEntry({ storageItems: [incoming], player: occupiedPlayer, entryId: incoming.instanceId });
  expect(deferred).toMatchObject({ success: false, requiresSlotChoice: true, candidateSlots: ['ring1', 'ring2'], player: occupiedPlayer, storageItems: [incoming] });
});

test('failed Storage MagicOffHand equip against the authored two-handed staff is fully atomic', () => {
  const grimoire = instance('field-grimoire', 'Полевой гримуар Отступника');
  const staff = instance('stolen-spark-staff', 'Посох Украденной Искры');
  const sourcePlayer = player({ class: 'Elementalist', equipment: { mainHand: staff }, inventory: [], runInventory: Array(12).fill(null) });
  const storage = [grimoire];
  const result = equipStorageEntry({ storageItems: storage, player: sourcePlayer, entryId: grimoire.instanceId });
  expect(result).toMatchObject({ success: false, reason: 'incompatible', storageItems: storage, player: sourcePlayer });
  expect(result.storageItems[0]).toBe(grimoire);
  expect(result.player.equipment).toEqual({ mainHand: staff });
  expect(result.player.runInventory.every(item => item === null)).toBe(true);
  expect(result.player.inventory).toEqual([]);
});

test('inventory equip transfers an instance once and persistence/run start cannot resurrect its stale mirror', () => {
  const first = instance('same-name-a', 'Кольцо Туманного Мха');
  const second = instance('same-name-b', 'Кольцо Туманного Мха');
  const slots = [null, null, first, second, ...Array(8).fill(null)];
  const source = player({ runInventory: slots, inventory: [first, second] });
  const equipped = equipRunInventoryItem(source, 2);
  expect(equipped.success).toBe(true);
  expect(equipped.player.equipment.ring1).toMatchObject({ instanceId: first.instanceId });
  expect(equipped.player.runInventory.some(item => item?.instanceId === first.instanceId)).toBe(false);
  expect(equipped.player.inventory).toBeUndefined();
  expect(equipped.player.runInventory.some(item => item?.instanceId === second.instanceId)).toBe(true);

  // Exercise deterministic repair too: equipped ownership wins only for the same instanceId.
  const stale = { ...equipped.player, runInventory: [...equipped.player.runInventory, first], inventory: [first, second] };
  const hydrated = hydratePlayerSnapshot(JSON.parse(JSON.stringify(buildPlayerSnapshot(stale))));
  const started = prepareFreshDungeonRun(hydrated, 'Грибные пещеры');
  expect(started.runInventory.filter(item => item?.instanceId === first.instanceId)).toHaveLength(0);
  expect(started.inventory).toBeUndefined();
  expect(started.runInventory.filter(item => item?.instanceId === second.instanceId)).toHaveLength(1);
});
