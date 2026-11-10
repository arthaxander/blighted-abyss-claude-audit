import { equipmentByName } from '../data/equipment';
import { ensureRuneState, getRuneById, RUNE_LIBRARY } from '../data/runes';
import { depositIntoStorage, getStorageItemName, normalizeStorage } from './storageManagement';

const LEGACY_SLOT_MAP = Object.freeze({ weapon: 'mainHand', armor: 'armor', ring: 'amulet' });
export const getEquipmentInstanceItemId = item => typeof item === 'string' ? item : item?.itemId || item?.name || '';
export const getEquipmentInstance = item => item && typeof item === 'object' ? item : null;
export const normalizeSocketEquipmentInstance = (item, slotId = 'equipment') => {
  if (!item) return null;
  if (typeof item === 'object') return item.instanceId ? item : { ...item, instanceId: `equipped-${slotId}-${getEquipmentInstanceItemId(item)}` };
  return { instanceId: `equipped-${slotId}-${item}`, itemId: item, socketedRuneId: null };
};
export const equipmentSupportsRuneSocket = (item, slotId) => {
  const def = equipmentByName[getEquipmentInstanceItemId(item)];
  if (!def) return false;
  if (slotId === 'mainHand') return def.type === 'Weapon';
  if (slotId === 'armor') return def.type === 'Armor';
  if (slotId === 'amulet') return def.type === 'Amulet';
  return false;
};
export const canSocketRune = (runeId, equipmentItem, equipmentSlot) => {
  const rune = getRuneById(runeId);
  return Boolean(rune && !equipmentItem?.socketedRuneId && rune.allowedEquipmentSlots.includes(equipmentSlot) && equipmentSupportsRuneSocket(equipmentItem, equipmentSlot));
};

export const getActiveSocketedRunes = equipment => Object.entries(equipment || {}).reduce((active, [slot, item]) => {
  const runeId = item?.socketedRuneId;
  if (runeId && canSocketRune(runeId, { ...item, socketedRuneId: null }, slot)) active[slot] = runeId;
  return active;
}, {});

export const socketRuneIntoEquipment = ({ equipment, equipmentSlot, runeId, sourceEntries, inCombat = false, preserveSourceSlots = false }) => {
  if (inCombat) return { success: false, equipment, sourceEntries, reason: 'combat' };
  const target = normalizeSocketEquipmentInstance(equipment?.[equipmentSlot], equipmentSlot);
  if (!canSocketRune(runeId, target, equipmentSlot)) return { success: false, equipment, sourceEntries, reason: 'incompatible' };
  const sourceIndex = (sourceEntries || []).findIndex(entry => entry && (entry.itemId === runeId || getRuneById(runeId)?.name === getStorageItemName(entry)) && (entry.quantity || 1) > 0);
  if (sourceIndex < 0) return { success: false, equipment, sourceEntries, reason: 'missing-rune' };
  const nextSource = sourceEntries.map(entry => entry ? { ...entry } : null);
  nextSource[sourceIndex].quantity = (nextSource[sourceIndex].quantity || 1) - 1;
  if (!nextSource[sourceIndex].quantity) {
    if (preserveSourceSlots) nextSource[sourceIndex] = null;
    else nextSource.splice(sourceIndex, 1);
  }
  return { success: true, equipment: { ...equipment, [equipmentSlot]: { ...target, socketedRuneId: runeId } }, sourceEntries: nextSource };
};

/** Resolves an equipped target from its authoritative slot before mutating rune and equipment state together. */
export const socketRuneIntoEquippedItem = ({ equipment, equipmentSlot, expectedItemId, runeId, sourceEntries, inCombat = false, preserveSourceSlots = false }) => {
  const authoritativeTarget = equipment?.[equipmentSlot];
  if (!authoritativeTarget || getEquipmentInstanceItemId(authoritativeTarget) !== expectedItemId) {
    return { success: false, equipment, sourceEntries, reason: 'target-not-found' };
  }
  return socketRuneIntoEquipment({ equipment, equipmentSlot, runeId, sourceEntries, inCombat, preserveSourceSlots });
};

export const extractRuneToStorage = ({ equipment, equipmentSlot, storage, inGuild = false }) => {
  const target = equipment?.[equipmentSlot];
  if (!inGuild) return { success: false, equipment, storage, reason: 'guild-only' };
  if (!target?.socketedRuneId) return { success: false, equipment, storage, reason: 'empty' };
  const deposited = depositIntoStorage(storage, { itemId: target.socketedRuneId, quantity: 1 });
  if (!deposited.success) return { success: false, equipment, storage, reason: deposited.reason };
  return { success: true, equipment: { ...equipment, [equipmentSlot]: { ...target, socketedRuneId: null } }, storage: deposited.storage, silverCost: 0 };
};

/** Migrates abstract slots once; unattached runes are returned/pended without loss. */
export const migrateLegacyRunes = ({ equipment = {}, runes, storage = [] }) => {
  const legacy = ensureRuneState(runes);
  let nextEquipment = { ...equipment };
  let nextStorage = normalizeStorage(storage);
  const pendingRuneMigration = [];
  const ids = [...Object.entries(legacy.slots || {}).filter(([, id]) => id), ...(legacy.inventory || []).map(id => [null, id])];
  ids.forEach(([legacySlot, runeId]) => {
    const rune = getRuneById(runeId);
    if (!rune) return;
    const targetSlot = legacySlot ? (LEGACY_SLOT_MAP[legacySlot] || legacySlot) : null;
    if (targetSlot && canSocketRune(runeId, nextEquipment[targetSlot], targetSlot)) {
      const target = nextEquipment[targetSlot];
      nextEquipment = { ...nextEquipment, [targetSlot]: typeof target === 'string'
        ? { instanceId: `legacy-equipped-${targetSlot}`, itemId: target, socketedRuneId: runeId }
        : { ...target, socketedRuneId: runeId } };
      return;
    }
    const deposited = depositIntoStorage(nextStorage, { itemId: runeId, quantity: 1 });
    if (deposited.success) nextStorage = deposited.storage;
    else pendingRuneMigration.push(runeId);
  });
  return { equipment: nextEquipment, storage: nextStorage, runes: { slots: {}, inventory: [] }, pendingRuneMigration };
};

export const getCompatibleRuneEntries = (entries, equipmentItem, slot) => (entries || []).filter(entry => {
  const rune = getRuneById(entry.itemId) || RUNE_LIBRARY.find(candidate => candidate.name === getStorageItemName(entry));
  return rune && canSocketRune(rune.id, equipmentItem, slot);
});
