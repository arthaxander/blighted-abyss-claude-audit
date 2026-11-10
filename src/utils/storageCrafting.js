import { findItemData, normalizeItemName } from '../data/items';
import { depositIntoStorage, getStorageItemName, normalizeStorage } from './storageManagement';

const canonicalName = value => {
  const name = normalizeItemName(typeof value === 'string' ? value : value?.name || value?.itemId);
  return findItemData(name)?.name || name;
};

export const countStorageItems = (items = []) => items.reduce((counts, entry) => {
  const name = canonicalName(entry);
  const quantity = typeof entry === 'string' ? 1 : Math.max(1, Number(entry?.quantity) || 1);
  if (name) counts[name] = (counts[name] || 0) + quantity;
  return counts;
}, {});

export const getMaxCraftableFromStorage = (items, recipe) => {
  const counts = countStorageItems(items);
  const ingredients = recipe?.ingredients || recipe?.craft || [];
  if (!ingredients.length) return 0;
  return Math.max(0, Math.min(...ingredients.map(req => Math.floor((counts[canonicalName(req)] || 0) / (req.quantity || 1)))));
};

export const canCraftFromStorage = (items, recipe, quantity = 1) => getMaxCraftableFromStorage(items, recipe) >= quantity;

export const craftFromStorage = (items = [], recipe, quantity = 1) => {
  const amount = Math.floor(Number(quantity));
  if (!Number.isFinite(amount) || amount < 1 || !canCraftFromStorage(items, recipe, amount)) return { success: false, storage: items, reason: 'missing-ingredients' };
  const storage = normalizeStorage(items).map(entry => ({ ...entry }));
  (recipe.ingredients || recipe.craft || []).forEach(req => {
    let remaining = (req.quantity || 1) * amount;
    storage.forEach(entry => {
      if (remaining <= 0 || canonicalName(entry) !== canonicalName(req)) return;
      const removed = Math.min(remaining, entry.quantity || 1);
      entry.quantity -= removed; remaining -= removed;
    });
  });
  const resultName = canonicalName(recipe.result?.name || recipe.name);
  const resultQuantity = (recipe.result?.quantity || 1) * amount;
  const consumed = storage.filter(entry => entry.quantity > 0);
  const deposited = depositIntoStorage(consumed, { itemId: resultName, quantity: resultQuantity });
  return deposited.success ? { success: true, storage: deposited.storage, resultName, quantity: resultQuantity } : { success: false, storage: items, reason: deposited.reason };
};

export const consumeStorageRecipe = (items = [], recipe) => {
  if (!canCraftFromStorage(items, recipe)) return { success: false, storage: items, reason: 'missing-ingredients' };
  const result = craftFromStorage(items, { ...recipe, result: { name: recipe.name, quantity: 1 } });
  if (!result.success) return result;
  const created = result.storage.findIndex(entry => getStorageItemName(entry) === recipe.name);
  if (created >= 0) {
    const storage = result.storage.map(entry => ({ ...entry })); storage[created].quantity -= 1;
    return { ...result, storage: storage.filter(entry => entry.quantity > 0) };
  }
  return result;
};
