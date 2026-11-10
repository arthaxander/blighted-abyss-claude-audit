import { addGuildSilver } from './guildCurrency';
import { bankRunSilver } from './expeditionInventory';
import { claimGuildQuestReward, purchaseGuildVendorItem } from './guildTransactions';

const persistent = (extra = {}) => ({ silver: 1000, guildSilver: 1000, runSilver: 0, runInventory: [], ...extra });

test('vendor purchase debits persistent Guild silver and zero-earnings return cannot refund it', () => {
  const bought = purchaseGuildVendorItem({ player: persistent(), storageItems: [], item: { name: 'Капюшон Искателя Знаков', price: 100 } });
  expect(bought.success).toBe(true);
  expect(bought.player).toMatchObject({ silver: 900, guildSilver: 900, runSilver: 0 });
  expect(bankRunSilver(bought.player)).toMatchObject({ silver: 900, guildSilver: 900, runSilver: 0 });
  expect(bought.storageItems.filter(item => item.itemId === 'Капюшон Искателя Знаков')).toHaveLength(1);
});

test('Guild quest silver reward survives a zero-earnings expedition return', () => {
  const player = persistent({ relics: {}, questLog: { 'quest-goblin-clearing': { progress: 3, completed: true, claimed: false } } });
  const claimed = claimGuildQuestReward({ player, storageItems: [], questId: 'quest-goblin-clearing' });
  expect(claimed.player).toMatchObject({ silver: 1200, guildSilver: 1200 });
  expect(bankRunSilver(claimed.player)).toMatchObject({ silver: 1200, guildSilver: 1200, runSilver: 0 });
});

test('Storage sale proceeds update both aliases and survive banking', () => {
  const sold = addGuildSilver(persistent(), 150);
  expect(sold).toMatchObject({ silver: 1150, guildSilver: 1150 });
  expect(bankRunSilver(sold)).toMatchObject({ silver: 1150, guildSilver: 1150, runSilver: 0 });
});

test('expedition earnings remain additive to canonical persistent Guild silver', () => {
  expect(bankRunSilver(persistent({ runSilver: 250 }))).toMatchObject({ silver: 1250, guildSilver: 1250, runSilver: 0 });
});
