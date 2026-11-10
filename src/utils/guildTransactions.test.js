import { claimGuildQuestReward, purchaseGuildVendorItem } from './guildTransactions';
import { GUILD_STASH_CAPACITY } from '../constants/gameplay';

const fullStorage = () => Array.from({ length: GUILD_STASH_CAPACITY }, (_, index) => ({ instanceId: `full-${index}`, itemId: 'Капюшон Искателя Знаков', quantity: 1 }));
const questPlayer = () => ({ silver: 10, relics: {}, questLog: { 'quest-goblin-clearing': { progress: 3, completed: true, claimed: false } }, runInventory: [] });

test('Guild quest reward deposits all stacks atomically and claims exactly once', () => {
  const result = claimGuildQuestReward({ player: questPlayer(), storageItems: [], questId: 'quest-goblin-clearing' });
  expect(result.success).toBe(true);
  expect(result.storageItems.find(entry => entry.itemId === 'Малое зелье здоровья').quantity).toBe(2);
  expect(result.storageItems.find(entry => entry.itemId === 'Простая ткань').quantity).toBe(3);
  expect(result.player).toMatchObject({ silver: 210, questLog: { 'quest-goblin-clearing': { claimed: true } } });
  expect(result.relicXp).toBe(50);
  expect(result.player.relics).toEqual({}); // XP is returned for the App-level meta transaction, not granted here.
  expect(result.player.inventory).toBeUndefined();
});

test('full Storage leaves a Guild quest wholly unclaimed and retry succeeds without duplicates', () => {
  const player = questPlayer(); const storage = fullStorage();
  const failed = claimGuildQuestReward({ player, storageItems: storage, questId: 'quest-goblin-clearing' });
  expect(failed).toMatchObject({ success: false, reason: 'storage-full', player, storageItems: storage });
  const retried = claimGuildQuestReward({ player: failed.player, storageItems: [], questId: 'quest-goblin-clearing' });
  expect(retried.success).toBe(true);
  expect(retried.storageItems.reduce((sum, entry) => sum + entry.quantity, 0)).toBe(5);
});

test('vendor purchase puts a unique equipment instance only in Storage', () => {
  const player = { silver: 1000, guildSilver: 1000, runInventory: [] };
  const result = purchaseGuildVendorItem({ player, storageItems: [], item: { name: 'Капюшон Искателя Знаков', price: 100 } });
  expect(result.success).toBe(true); expect(result.player).toMatchObject({ silver: 900, guildSilver: 900 });
  expect(result.storageItems[0].instanceId).toBeTruthy();
  expect(result.player.runInventory).toEqual([]); expect(result.player.inventory).toBeUndefined();
});

test('failed vendor purchase neither charges silver nor creates an item', () => {
  const player = { silver: 1000, guildSilver: 1000, runInventory: [] }; const storage = fullStorage();
  const result = purchaseGuildVendorItem({ player, storageItems: storage, item: { name: 'Капюшон Искателя Знаков', price: 100 } });
  expect(result).toMatchObject({ success: false, reason: 'storage-full', player, storageItems: storage });
});


test('limited vendor materials reset by server-supplied UTC purchase period', () => {
  const item = { name: 'Простая ткань', price: 10, dailyLimit: 2 };
  const player = { silver: 1000, guildSilver: 1000, runInventory: [] };
  const dayOne = Date.parse('2026-10-02T12:00:00.000Z');
  const first = purchaseGuildVendorItem({ player, storageItems: [], item, vendorPurchaseState: null, nowMs: dayOne });
  const second = purchaseGuildVendorItem({ player: first.player, storageItems: first.storageItems, item, vendorPurchaseState: first.vendorPurchaseState, nowMs: dayOne });
  const blocked = purchaseGuildVendorItem({ player: second.player, storageItems: second.storageItems, item, vendorPurchaseState: second.vendorPurchaseState, nowMs: dayOne });
  expect(blocked).toMatchObject({ success: false, reason: 'daily-limit' });
  expect(blocked.player.guildSilver).toBe(980);

  const nextDay = purchaseGuildVendorItem({
    player: blocked.player,
    storageItems: blocked.storageItems,
    item,
    vendorPurchaseState: blocked.vendorPurchaseState,
    nowMs: Date.parse('2026-10-03T00:00:00.000Z'),
  });
  expect(nextDay.success).toBe(true);
  expect(nextDay.vendorPurchaseState).toEqual({ periodId: '2026-10-03', counts: { 'Простая ткань': 1 } });
});
