import { depositIntoStorage, getStorageOccupancy, isItemSellable, normalizeStorage, presentStorage, RUN_INVENTORY_RUNE_STACK_LIMIT, sellStorageSelection, STORAGE_STACK_LIMIT } from './storageManagement';

test('storage occupancy counts physical stacks and normalizes 1007 units losslessly', () => {
  const storage = normalizeStorage([{ name: 'Простая ткань', quantity: 1007 }]);
  expect(storage.map(stack => stack.quantity)).toEqual([999, 8]);
  expect(getStorageOccupancy(storage)).toBe(2);
  expect(storage.reduce((sum, stack) => sum + stack.quantity, 0)).toBe(1007);
  expect(STORAGE_STACK_LIMIT).toBe(999);
  expect(RUN_INVENTORY_RUNE_STACK_LIMIT).toBe(5);
});

test('equipment copies have independent stable instance identities and sockets', () => {
  const storage = normalizeStorage(['Куртка Мародёра', 'Куртка Мародёра']);
  expect(storage).toHaveLength(2);
  expect(storage[0].instanceId).not.toBe(storage[1].instanceId);
  expect(storage.every(item => item.quantity === 1)).toBe(true);
});

test('over-capacity storage permits merge but rejects a new occupied slot', () => {
  const full = [{ entryId: 'cloth', itemId: 'Простая ткань', quantity: 990 }, ...Array.from({ length: 300 }, (_, i) => ({ instanceId: `sword-${i}`, itemId: 'Тесак Гоблинского Мясника', quantity: 1 }))];
  const merge = depositIntoStorage(full, { itemId: 'Простая ткань', quantity: 9 });
  expect(merge.success).toBe(true); expect(merge.storage[0].quantity).toBe(999);
  const rejected = depositIntoStorage(full, { itemId: 'Металлические обломки', quantity: 1 });
  expect(rejected).toMatchObject({ success: false, reason: 'capacity' });
  expect(rejected.storage).toBe(full);
});

test('presentation sorting is read-only and entry sales are transactional', () => {
  const storage = normalizeStorage([{ name: 'Простая ткань', quantity: 10 }, 'Куртка Мародёра']);
  const snapshot = JSON.stringify(storage);
  const rows = presentStorage(storage, 'all', 'name');
  expect(JSON.stringify(storage)).toBe(snapshot);
  const sale = sellStorageSelection(storage, [rows.find(row => row.name === 'Простая ткань').id], { quantities: { [rows.find(row => row.name === 'Простая ткань').id]: 3 } });
  expect(sale.success).toBe(true); expect(sale.storage.find(entry => entry.itemId === 'Простая ткань').quantity).toBe(7);
});

test('socketed equipment cannot be sold', () => {
  const [weapon] = normalizeStorage([{ name: 'Тесак Гоблинского Мясника', socketedRuneId: 'ember_heart' }]);
  expect(sellStorageSelection([weapon], [weapon.instanceId])).toMatchObject({ success: false, reason: 'socketed' });
});

test('canonical sellability supports ordinary mixed categories and rejects protected entries', () => {
  const rows = presentStorage(normalizeStorage(['Малое зелье здоровья', 'Простая ткань', 'Куртка Мародёра']));
  expect(isItemSellable(rows.find(row => row.name === 'Малое зелье здоровья'))).toBe(true);
  expect(isItemSellable(rows.find(row => row.name === 'Простая ткань'))).toBe(true);
  expect(isItemSellable(rows.find(row => row.name === 'Куртка Мародёра'))).toBe(true);
  expect(isItemSellable({ ...rows[0], locked: true })).toBe(false);
});

describe('storage discard', () => {
  test('removes only the selected ordinary starter equipment', () => {
    const { discardStorageEntry } = require('./storageManagement');
    const storage = normalizeStorage([{ instanceId: 'starter', itemId: 'Ржавый меч новобранца' }, { instanceId: 'keep', itemId: 'Куртка Мародёра' }]);
    const result = discardStorageEntry(storage, 'starter');
    expect(result.success).toBe(true);
    expect(result.storage.map(entry => entry.instanceId)).toEqual(['keep']);
  });
  test('refuses locked and socketed entries', () => {
    const { discardStorageEntry } = require('./storageManagement');
    const locked = [{ instanceId: 'locked', itemId: 'Куртка Мародёра', quantity: 1, locked: true }];
    expect(discardStorageEntry(locked, 'locked')).toMatchObject({ success: false, storage: locked });
    const socketed = [{ instanceId: 'socketed', itemId: 'Куртка Мародёра', quantity: 1, socketedRuneId: 'stone_vigil' }];
    expect(discardStorageEntry(socketed, 'socketed')).toMatchObject({ success: false, storage: socketed, reason: 'socketed' });
  });
});

describe('storage registry integrity and legacy migration', () => {
  test.each([
    ['Мицелий', 'Лазурный мицелий', 21],
    ['Споры', 'Блуждающие споры', 12],
    ['azure_mycelium', 'Лазурный мицелий', 7],
    ['wandering_spores', 'Блуждающие споры', 9],
  ])('migrates %s losslessly to %s', (legacyId, canonicalName, quantity) => {
    const [entry] = normalizeStorage([{ entryId: `legacy-${quantity}`, itemId: legacyId, quantity }]);
    expect(entry).toMatchObject({ entryId: `legacy-${quantity}`, itemId: canonicalName, quantity });
  });
});


describe('corrupted Cyrillic entries from historic storage saves', () => {
  test('restores unique item identities from known damaged names without deleting contents', () => {
    const original = [
      { entryId: 'old-shield', itemId: 'Щит Дозорного Гиль��ии', quantity: 1, locked: true },
      { entryId: 'old-cleaver', itemId: 'Тесак Гоблинского ��ясника', quantity: 1, socketedRuneId: 'ember_heart' },
      { entryId: 'old-metal', itemId: 'Металлические ��бломки', quantity: 2 },
    ];
    const snapshot = JSON.stringify(original);
    const storage = normalizeStorage(original);
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(storage).toHaveLength(3);
    expect(storage[0]).toMatchObject({ entryId: 'old-shield', itemId: 'Щит Дозорного Гильдии', quantity: 1, locked: true });
    expect(storage[1]).toMatchObject({ entryId: 'old-cleaver', itemId: 'Тесак Гоблинского Мясника', socketedRuneId: 'ember_heart' });
    expect(storage[2]).toMatchObject({ entryId: 'old-metal', itemId: 'Металлические обломки', quantity: 2 });
    for (const row of presentStorage(storage)) expect(row.meta?.name).toBe(row.name);
  });

  test('restores every sword when an old unknown stack had multiple physical equipment copies', () => {
    const source = [{ entryId: 'old-sword-stack', itemId: 'Тесак Гоблинского ��ясника', quantity: 2, locked: true }];
    const migrated = normalizeStorage(source);
    expect(migrated).toHaveLength(2);
    expect(migrated.map(item => item.itemId)).toEqual(['Тесак Гоблинского Мясника', 'Тесак Гоблинского Мясника']);
    expect(migrated.every(item => item.quantity === 1 && item.locked)).toBe(true);
    expect(new Set(migrated.map(item => item.instanceId)).size).toBe(2);
    expect(migrated[0].instanceId).toBe('old-sword-stack');
  });

  test('never guesses an unregistered damaged name or loosely matches intact unknown ids', () => {
    const input = [
      { entryId: 'strange', itemId: 'Чужой ��ртeфакт', quantity: 3 },
      { entryId: 'ambiguous', itemId: '��', quantity: 1 },
      { entryId: 'typo', itemId: 'Тесак Гоблинскова Мясника', quantity: 2 },
    ];
    const migrated = normalizeStorage(input);
    expect(migrated.map(item => item.itemId)).toEqual(input.map(item => item.itemId));
    expect(migrated.map(item => item.quantity)).toEqual([3, 1, 2]);
    expect(migrated.every(item => item.entryId)).toBe(true);
  });
});
