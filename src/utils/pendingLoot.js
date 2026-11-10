import { getItemId, getItemSlotCategory, insertItems, simulateItemInsertion } from './expeditionInventory';
import { findItemData } from '../data/items';

export const ITEM_RARITY_ORDER = Object.freeze({
  Обычная: 0,
  Необычная: 1,
  Редкая: 2,
  Эпическая: 3,
  Легендарная: 4,
});
export const HIGH_VALUE_EQUIPMENT_RARITY = 'Редкая';

export const shouldOverrideLootWarningSuppression = item => {
  const definition = findItemData(getItemId(item));
  if (!definition) return false;
  if (definition.type === 'quest' || definition.type === 'key' || definition.type === 'keyItem') return true;
  if (definition.sourceTier === 'rareCatalyst') return true;
  if (definition.type !== 'equipment') return false;
  return (ITEM_RARITY_ORDER[definition.rarity] ?? -1) >= ITEM_RARITY_ORDER[HIGH_VALUE_EQUIPMENT_RARITY];
};

export const shouldWarnAboutAbandonedLoot = (items, suppressionActive = false) => {
  const abandoned = (items || []).filter(Boolean);
  if (!abandoned.length) return false;
  return !suppressionActive || abandoned.some(shouldOverrideLootWarningSuppression);
};

export const createPendingLoot = ({ id, source = 'unknown', loot = {}, continuation = null } = {}) => ({
  id: id || `${source}-${Date.now()}`,
  source,
  silver: Math.max(0, Number(loot?.silver) || 0),
  resonance: Math.max(0, Number(loot?.resonance) || 0),
  specialRewards: (loot?.specialRewards || []).map(reward => ({ ...reward })).filter(reward => reward.id && reward.name),
  expeditionKeyRoll: loot?.expeditionKeyRoll ? { ...loot.expeditionKeyRoll } : null,
  items: (loot?.items || []).map((item, index) => ({
    id: item.id || `${getItemId(item)}-${index}`,
    itemId: getItemId(item),
    quantity: Math.max(1, Number(item.quantity) || 1),
  })).filter(item => item.itemId),
  selectedIds: [],
  silverClaimed: false,
  continuation,
});

export const togglePendingLootSelection = (pending, id) => ({
  ...pending,
  selectedIds: pending.selectedIds.includes(id)
    ? pending.selectedIds.filter(value => value !== id)
    : [...pending.selectedIds, id],
});

// One-tap collection: reserve capacity for rare/quest loot, then pack materials
// and other drops into existing stacks and available slots. A partial stack is
// split into a selected portion and an unselected remainder so commitPendingLoot
// can keep its atomic all-or-nothing contract.
export const selectFittingPendingLoot = (pending, slots, layout) => {
  if (!pending?.items?.length) return pending;
  let availableSlots = slots;
  const accepted = new Map();
  const ordered = [...pending.items].sort((a, b) => {
    const priority = item => shouldOverrideLootWarningSuppression(item) ? 0 :
      getItemSlotCategory(item) === 'general' ? 1 :
        getItemSlotCategory(item) === 'resource' ? 2 : 3;
    return priority(a) - priority(b);
  });
  for (const item of ordered) {
    const insertion = insertItems(availableSlots, [item], { layout });
    const rejected = insertion.rejected.reduce((sum, entry) => sum + entry.quantity, 0);
    const taken = Math.max(0, item.quantity - rejected);
    if (taken > 0) {
      accepted.set(item.id, taken);
      availableSlots = insertion.slots;
    }
  }
  return {
    ...pending,
    items: pending.items.flatMap(item => {
      const taken = accepted.get(item.id) || 0;
      if (!taken || taken === item.quantity) return [item];
      return [
        { ...item, quantity: taken },
        { ...item, id: `${item.id}::remaining`, quantity: item.quantity - taken },
      ];
    }),
    selectedIds: pending.items.filter(item => accepted.has(item.id)).map(item => item.id),
  };
};

export const getSelectedPendingItems = pending => (pending?.items || []).filter(item => pending?.selectedIds?.includes(item.id));
export const previewPendingLoot = (pending, slots, layout) => simulateItemInsertion(slots, getSelectedPendingItems(pending), { layout });
export const commitPendingLoot = (pending, slots, layout) => {
  const selected = getSelectedPendingItems(pending);
  const insertion = insertItems(slots, selected, { layout });
  return insertion.fits ? { committed: true, slots: insertion.slots, abandoned: pending.items.filter(item => !pending.selectedIds.includes(item.id)) } : { committed: false, slots, rejected: insertion.rejected };
};

export const claimPendingSilver = (player, pending) => pending?.silverClaimed
  ? { player, pending }
  : { player: { ...player, runSilver: (player?.runSilver || 0) + (pending?.silver || 0) }, pending: { ...pending, silverClaimed: true } };

