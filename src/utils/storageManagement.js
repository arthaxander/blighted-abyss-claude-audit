import { ITEM_DATA, LEGACY_ITEM_NAMES, findItemData, normalizeItemName } from '../data/items';
import { equipmentByName } from '../data/equipment';
import { getRuneById, RUNE_LIBRARY } from '../data/runes';
import { GUILD_STASH_CAPACITY } from '../constants/gameplay';

export const STORAGE_STACK_LIMIT = 999;
export const RUN_INVENTORY_RUNE_STACK_LIMIT = 5;

export const STORAGE_FILTERS = Object.freeze([
  { id: 'all', label: 'Все' }, { id: 'equipment', label: 'Экипировка' },
  { id: 'consumable', label: 'Расходники' }, { id: 'material', label: 'Материалы' }, { id: 'rune', label: 'Руны' },
]);
export const STORAGE_SORTS = Object.freeze([
  { id: 'type', label: 'По типу' }, { id: 'name', label: 'По названию' }, { id: 'price', label: 'По цене' },
]);

const runeByName = new Map(RUNE_LIBRARY.map(rune => [rune.name, rune]));
let generatedId = 0;
export const createStableEntryId = (prefix = 'entry') => `${prefix}-${Date.now().toString(36)}-${(++generatedId).toString(36)}`;
// Some historic saves contain Unicode replacement characters (U+FFFD)
// where the original Cyrillic letters have been irreversibly lost.
// Only a unique match from our registered catalog can be repaired.
const corruptedNameCache = new Map();
const KNOWN_STORAGE_NAMES = [...new Set([
  ...ITEM_DATA.map(item => item.name),
  ...Object.keys(equipmentByName),
  ...Object.keys(LEGACY_ITEM_NAMES),
  ...RUNE_LIBRARY.map(rune => rune.name),
])];
const restoreDamagedStorageName = raw => {
  if (typeof raw !== 'string' || !raw.includes('\uFFFD')) return null;
  if (corruptedNameCache.has(raw)) return corruptedNameCache.get(raw);
  const intactLength = raw.trim().replace(/\uFFFD/g, '').length;
  const chunks = raw.match(/\uFFFD+/g) || [];
  if (intactLength < 8 || chunks.length > 3 || chunks.some(chunk => chunk.length > 4)) {
    corruptedNameCache.set(raw, null);
    return null;
  }
  const escapeRegex = text => [...text].map(char =>
    '\\^$.*+?()[]{}|'.includes(char) ? '\\' + char : char
  ).join('');
  // 1-2 replacement glyphs generally indicate one damaged Cyrillic letter.
  const expression = '^' + raw.trim().split(/\uFFFD+/u).map(escapeRegex).join('[^\\s]{1,2}') + '$';
  const matcher = new RegExp(expression, 'iu');
  const matches = new Set(KNOWN_STORAGE_NAMES.filter(name => matcher.test(name)).map(normalizeItemName));
  const restored = matches.size === 1 ? [...matches][0] : null;
  corruptedNameCache.set(raw, restored);
  return restored;
};
const resolveKnownStorageName = value => {
  const normalized = normalizeItemName(value);
  if (!normalized) return null;
  if (findItemData(normalized) || equipmentByName[normalized] || runeByName.has(normalized) || getRuneById(normalized)) {
    return normalized;
  }
  return restoreDamagedStorageName(normalized);
};
export const getStorageItemName = entry => {
  const originalId = typeof entry === 'string' ? entry : entry?.itemId || entry?.name;
  const rune = getRuneById(entry?.itemId);
  if (rune) return rune.name;
  return resolveKnownStorageName(originalId)
    || resolveKnownStorageName(entry?.name)
    || normalizeItemName(originalId) || '';
};
export const getStorageEntryId = entry => entry?.instanceId || entry?.entryId || null;
export const isEquipmentItem = entry => Boolean(equipmentByName[getStorageItemName(entry)] || ['equipment', 'fishingRod'].includes(findItemData(getStorageItemName(entry))?.type));
export const isRuneItem = entry => Boolean(getRuneById(entry?.itemId) || runeByName.has(getStorageItemName(entry)));
export const isStackableStorageItem = entry => !isEquipmentItem(entry);

const canonicalItemId = entry => {
  if (getRuneById(entry?.itemId)) return entry.itemId;
  const name = getStorageItemName(entry);
  return runeByName.get(name)?.id || name;
};

const makeStack = (itemId, quantity, entryId) => ({ entryId: entryId || createStableEntryId('stack'), itemId, quantity });
const makeEquipment = (entry, name, duplicate = false) => ({
  ...(entry && typeof entry === 'object' ? entry : {}),
  instanceId: (!duplicate && (entry?.instanceId || entry?.entryId)) || createStableEntryId('equipment'),
  itemId: name,
  socketedRuneId: entry?.socketedRuneId || null,
  quantity: 1,
});

/** Lossless save migration: commodities are aggregated/split, equipment stays physical. */
export const normalizeStorage = (items = []) => {
  const input = Array.isArray(items) ? items : [];
  const alreadyNormalized = input.every(entry => entry && typeof entry === 'object'
    && getStorageEntryId(entry) && Number(entry.quantity) >= 1 && Number(entry.quantity) <= STORAGE_STACK_LIMIT);
  // A formerly unrecognized equipment stack may have quantity > 1. When we
  // restore its name, expand it instead of silently losing the extra copies.
  const needsEquipmentExpansion = input.some(entry => isEquipmentItem(entry) && Number(entry.quantity) > 1);
  if (alreadyNormalized && !needsEquipmentExpansion) return input.map(entry => ({
    ...entry,
    itemId: canonicalItemId(entry),
    quantity: isEquipmentItem(entry) ? 1 : Math.floor(Number(entry.quantity)),
  }));
  const equipment = [];
  const totals = new Map();
  input.forEach(entry => {
    const name = getStorageItemName(entry);
    if (!name) return;
    if (isEquipmentItem(entry)) {
      const quantity = typeof entry === 'string' ? 1 : Math.max(1, Math.floor(Number(entry.quantity) || 1));
      for (let i = 0; i < quantity; i += 1) equipment.push(makeEquipment(entry, name, i > 0));
      return;
    }
    const id = canonicalItemId(entry);
    const quantity = typeof entry === 'string' ? 1 : Math.max(1, Math.floor(Number(entry.quantity) || 1));
    totals.set(id, (totals.get(id) || 0) + quantity);
  });
  const stacks = [];
  totals.forEach((total, itemId) => {
    for (let remaining = total; remaining > 0; remaining -= STORAGE_STACK_LIMIT) {
      stacks.push(makeStack(itemId, Math.min(remaining, STORAGE_STACK_LIMIT)));
    }
  });
  return [...equipment, ...stacks];
};

export const getStorageOccupancy = items => (Array.isArray(items) ? items.filter(Boolean).length : 0);
export const getStorageCategory = entry => {
  if (isRuneItem(entry)) return 'rune';
  if (isEquipmentItem(entry)) return 'equipment';
  const type = findItemData(getStorageItemName(entry))?.type;
  if (type === 'material') return 'material';
  if (['consumable', 'potion', 'scroll', 'bait'].includes(type)) return 'consumable';
  return 'other';
};
export const getCanonicalSellPrice = entry => {
  const item = findItemData(getStorageItemName(entry));
  return Math.max(0, Number(item?.sellPrice) || (Number(item?.buyPrice) > 0 ? Math.floor(Number(item.buyPrice) / 2) : 0));
};
export const isItemSellable = entry => {
  const item = findItemData(getStorageItemName(entry));
  if (!item || item.sellable === false || item.nonSellable || entry?.locked || entry?.protected) return false;
  if (['quest', 'questItem', 'key', 'keyItem', 'system', 'currency'].includes(item.type)) return false;
  return getCanonicalSellPrice(entry) > 0 && !entry?.socketedRuneId;
};

export const isItemDiscardable = entry => {
  const item = findItemData(getStorageItemName(entry));
  if (!item || item.discardable === false || item.nonDiscardable || entry?.locked || entry?.protected) return false;
  if (['quest', 'questItem', 'key', 'keyItem', 'system', 'currency'].includes(item.type)) return false;
  return !entry?.socketedRuneId;
};

export const discardStorageEntry = (items, entryId) => {
  const entry = (items || []).find(candidate => getStorageEntryId(candidate) === entryId);
  if (!entry || !isItemDiscardable(entry)) return { success: false, storage: items, reason: entry?.socketedRuneId ? 'socketed' : 'protected' };
  return { success: true, storage: (items || []).filter(candidate => getStorageEntryId(candidate) !== entryId) };
};

export const summarizeStorage = items => normalizeStorage(items).filter(Boolean).map(entry => {
  const name = getStorageItemName(entry);
  return { ...entry, id: getStorageEntryId(entry), name, quantity: Math.max(1, entry.quantity || 1), meta: findItemData(name), category: getStorageCategory(entry), sellPrice: getCanonicalSellPrice(entry), socketedRuneId: entry.socketedRuneId || null };
});
export const presentStorage = (items, filter = 'all', sort = 'type') => {
  const rows = summarizeStorage(items).filter(row => filter === 'all' || row.category === filter);
  return [...rows].sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'ru') : sort === 'price' ? b.sellPrice - a.sellPrice || a.name.localeCompare(b.name, 'ru') : a.category.localeCompare(b.category) || a.name.localeCompare(b.name, 'ru'));
};

/** Atomic deposit. At/over capacity, filling an existing stack is still permitted. */
export const depositIntoStorage = (items, incoming, { capacity = GUILD_STASH_CAPACITY } = {}) => {
  const storage = (items || []).map(entry => ({ ...entry }));
  const name = getStorageItemName(incoming);
  if (!name) return { success: false, storage: items, reason: 'invalid-item' };
  if (isEquipmentItem(incoming)) {
    if (getStorageOccupancy(storage) >= capacity) return { success: false, storage: items, reason: 'capacity' };
    return { success: true, storage: [...storage, makeEquipment(incoming, name)] };
  }
  let remaining = Math.max(1, Math.floor(Number(incoming?.quantity) || 1));
  const itemId = canonicalItemId(incoming);
  storage.forEach(stack => {
    if (remaining <= 0 || canonicalItemId(stack) !== itemId || !isStackableStorageItem(stack)) return;
    const room = STORAGE_STACK_LIMIT - stack.quantity;
    const moved = Math.min(room, remaining);
    stack.quantity += moved; remaining -= moved;
  });
  const required = Math.ceil(remaining / STORAGE_STACK_LIMIT);
  if (required > 0 && getStorageOccupancy(storage) + required > capacity) return { success: false, storage: items, reason: 'capacity' };
  while (remaining > 0) { const amount = Math.min(remaining, STORAGE_STACK_LIMIT); storage.push(makeStack(itemId, amount)); remaining -= amount; }
  return { success: true, storage };
};

export const sellStorageSelection = (items, selectedIds, { quantities = {} } = {}) => {
  const selected = new Set(selectedIds || []);
  const chosen = summarizeStorage(items).filter(row => selected.has(row.id));
  if (!chosen.length || chosen.some(row => !isItemSellable(row))) return { success: false, storage: items, silver: 0, reason: chosen.some(row => row.socketedRuneId) ? 'socketed' : 'invalid-selection' };
  const remove = new Map(chosen.map(row => [row.id, Math.min(row.quantity, Math.max(1, quantities[row.id] || row.quantity))]));
  const storage = [];
  (items || []).forEach(entry => {
    const count = remove.get(getStorageEntryId(entry)) || 0;
    if (!count) { storage.push(entry); return; }
    const kept = Math.max(0, (entry.quantity || 1) - count);
    if (kept) storage.push({ ...entry, quantity: kept });
  });
  const silver = chosen.reduce((sum, row) => sum + row.sellPrice * (remove.get(row.id) || 0), 0);
  return { success: true, storage, silver, soldCount: [...remove.values()].reduce((a, b) => a + b, 0) };
};
