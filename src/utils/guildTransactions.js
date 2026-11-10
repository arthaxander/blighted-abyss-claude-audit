import { getQuestById, resolveQuestReward } from '../data/quests';
import { depositIntoStorage } from './storageManagement';
import { getGuildSilver, withGuildSilver } from './guildCurrency';
import { getVendorPurchaseStatus } from '../data/vendors';

export const claimGuildQuestReward = ({ player, storageItems, questId }) => {
  const quest = getQuestById(questId);
  const entry = player?.questLog?.[questId];
  if (!quest || !entry?.completed || entry.claimed) return { success: false, player, storageItems, reason: 'unavailable' };
  let storage = storageItems;
  for (const reward of quest.rewards?.items || []) {
    const deposit = depositIntoStorage(storage, { itemId: reward.name, quantity: reward.quantity || 1 });
    if (!deposit.success) return { success: false, player, storageItems, reason: 'storage-full' };
    storage = deposit.storage;
  }
  return {
    success: true,
    player: resolveQuestReward(player, questId),
    storageItems: storage,
    relicXp: quest.rewards?.relicXp || 0,
  };
};

export const purchaseGuildVendorItem = ({ player, storageItems, item, vendorPurchaseState, nowMs = Date.now() }) => {
  if (!item || getGuildSilver(player) < item.price) return { success: false, player, storageItems, vendorPurchaseState, reason: 'silver' };
  const purchaseStatus = getVendorPurchaseStatus(item, vendorPurchaseState, nowMs);
  if (purchaseStatus.limited && purchaseStatus.remaining <= 0) {
    return { success: false, player, storageItems, vendorPurchaseState: purchaseStatus.state, reason: 'daily-limit' };
  }
  const deposit = depositIntoStorage(storageItems, { itemId: item.name, quantity: 1 });
  if (!deposit.success) return { success: false, player, storageItems, vendorPurchaseState, reason: 'storage-full' };
  const nextVendorPurchaseState = purchaseStatus.limited
    ? {
      periodId: purchaseStatus.periodId,
      counts: {
        ...purchaseStatus.state.counts,
        [item.name]: purchaseStatus.purchased + 1,
      },
    }
    : vendorPurchaseState;
  return {
    success: true,
    storageItems: deposit.storage,
    player: withGuildSilver(player, getGuildSilver(player) - item.price),
    vendorPurchaseState: nextVendorPurchaseState,
  };
};
