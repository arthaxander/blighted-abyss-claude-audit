import { equipmentByName } from '../data/equipment';
import { GUILD_STASH_CAPACITY } from '../constants/gameplay';
import { applyEquipmentPatch, equipItemInSlots, getEquipmentSlotCandidates, validateClassEquipment } from './equipmentManager';
import { getRunInventoryLayout, insertItems, migrateRunInventory, slotsToLegacyInventory } from './expeditionInventory';
import { createStableEntryId, depositIntoStorage, getStorageEntryId, getStorageOccupancy, normalizeStorage } from './storageManagement';
import { getEquipmentInstanceItemId } from './runeSockets';

const withoutLegacyInventory = player => { const { inventory, safeSlots, ...canonical } = player || {}; return canonical; };

const clonePlayerInventory = player => migrateRunInventory(player?.runInventory || [], player?.equipment, player?.runInventoryLayoutVersion);

export const depositRunInventoryEntry = ({ storageItems, player, sourceIndex, itemId, quantity = 1 }) => {
  const slots = clonePlayerInventory(player);
  const index = Number.isInteger(sourceIndex)
    ? sourceIndex
    : slots.findIndex(entry => entry?.itemId === itemId);
  const source = slots[index];
  if (!source) return { success: false, storageItems, player, reason: 'source-missing' };
  const moved = source.instanceId ? 1 : Math.min(source.quantity, Math.max(1, Math.floor(quantity)));
  const incoming = source.instanceId ? { ...source, quantity: 1 } : { itemId: source.itemId, quantity: moved };
  const deposited = depositIntoStorage(normalizeStorage(storageItems), incoming);
  if (!deposited.success) return { success: false, storageItems, player, reason: deposited.reason };
  const nextSlots = slots.map(entry => entry ? { ...entry } : null);
  if (source.instanceId || source.quantity === moved) nextSlots[index] = null;
  else nextSlots[index] = { ...source, quantity: source.quantity - moved };
  const nextPlayer = { ...withoutLegacyInventory(player), runInventory: nextSlots };
  return { success: true, storageItems: deposited.storage, player: nextPlayer, moved };
};

const removeStorageQuantity = (storage, index, quantity) => {
  const next = storage.map(entry => ({ ...entry }));
  if (next[index].quantity > quantity) next[index].quantity -= quantity;
  else next.splice(index, 1);
  return next;
};

export const withdrawStorageEntry = ({ storageItems, player, entryId, quantity = 1 }) => {
  const storage = normalizeStorage(storageItems);
  const index = storage.findIndex(entry => getStorageEntryId(entry) === entryId);
  if (index < 0) return { success: false, storageItems, player, reason: 'source-missing' };
  const source = storage[index];
  const moved = source.instanceId ? 1 : Math.min(source.quantity, Math.max(1, Math.floor(quantity)));
  const beforeSlots = clonePlayerInventory(player);
  const insertion = insertItems(beforeSlots, [{ ...source, quantity: moved }], { layout: getRunInventoryLayout(player?.equipment) });
  if (!insertion.fits) return { success: false, storageItems, player, reason: 'inventory-full' };
  const nextStorage = removeStorageQuantity(storage, index, moved);
  const nextPlayer = { ...withoutLegacyInventory(player), runInventory: insertion.slots };
  return { success: true, storageItems: nextStorage, player: nextPlayer, moved };
};

const asEquipmentInstance = item => typeof item === 'object' && item?.instanceId
  ? { ...item, quantity: 1 }
  : { instanceId: createStableEntryId('equipment'), itemId: getEquipmentInstanceItemId(item), socketedRuneId: item?.socketedRuneId || null, quantity: 1 };

export const equipStorageEntry = ({ storageItems, player, entryId, preferredSlot = null }) => {
  const storage = normalizeStorage(storageItems);
  const sourceIndex = storage.findIndex(entry => getStorageEntryId(entry) === entryId);
  if (sourceIndex < 0) return { success: false, storageItems, player, reason: 'source-missing' };
  const source = storage[sourceIndex];
  const definition = equipmentByName[source.itemId];
  const validation = validateClassEquipment(player?.class, definition);
  if (!validation.canEquip) return { success: false, storageItems, player, reason: validation.message };
  const candidateSlots = getEquipmentSlotCandidates(definition);
  const emptySlot = candidateSlots.find(slot => !player?.equipment?.[slot]);
  if (!emptySlot && candidateSlots.length > 1 && !preferredSlot) {
    return { success: false, storageItems, player, requiresSlotChoice: true, candidateSlots };
  }
  const equipped = equipItemInSlots(player?.equipment, { ...definition, ...source, name: definition.name }, preferredSlot || emptySlot);
  if (!equipped) return { success: false, storageItems, player, reason: 'incompatible' };

  const withoutSource = storage.filter((_, index) => index !== sourceIndex);
  const returned = equipped.returnedItems.map(asEquipmentInstance);
  const finalStorage = [...withoutSource, ...returned];
  const initialOccupancy = getStorageOccupancy(storage);
  const allowedOccupancy = Math.max(GUILD_STASH_CAPACITY, initialOccupancy);
  if (getStorageOccupancy(finalStorage) > allowedOccupancy) {
    return { success: false, storageItems, player, reason: 'storage-full' };
  }
  const currentSlots = clonePlayerInventory(player);
  const patch = applyEquipmentPatch(player, equipped.equipment, slotsToLegacyInventory(currentSlots), player.runes);
  const equippedIds = new Set(Object.values(patch.equipment || {}).map(item => item?.instanceId).filter(Boolean));
  const nextSlots = currentSlots.map(item => item?.instanceId && equippedIds.has(item.instanceId) ? null : item);
  const { inventory: ignoredLegacyInventory, ...canonicalPatch } = patch;
  const nextPlayer = { ...withoutLegacyInventory(player), ...canonicalPatch, runInventory: nextSlots };
  return { success: true, storageItems: finalStorage, player: nextPlayer, displaced: returned };
};
