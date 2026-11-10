import { canCraftFromStorage, countStorageItems, craftFromStorage, consumeStorageRecipe, getMaxCraftableFromStorage } from './storageCrafting';

const potion = { name: 'Малое зелье здоровья', ingredients: [{ name: 'Простая склянка', quantity: 1 }, { name: 'Кровяной мох', quantity: 2 }] };

test('storage crafting checks, consumes, and deposits transactionally', () => {
  const storage = ['Простая склянка', { name: 'Кровяной мох', quantity: 2 }, 'Простая ткань'];
  expect(countStorageItems(storage)).toMatchObject({ 'Простая склянка': 1, 'Кровяной мох': 2 });
  expect(canCraftFromStorage(storage, potion)).toBe(true);
  const crafted = craftFromStorage(storage, potion);
  expect(crafted.success).toBe(true);
  expect(countStorageItems(crafted.storage)).toEqual({ 'Простая ткань': 1, 'Малое зелье здоровья': 1 });
  expect(canCraftFromStorage(['Простая склянка'], potion)).toBe(false);
});

test('bulk crafting computes the ingredient limit and commits atomically', () => {
  const storage = [{ itemId: 'Простая склянка', quantity: 3 }, { itemId: 'Кровяной мох', quantity: 7 }];
  expect(getMaxCraftableFromStorage(storage, potion)).toBe(3);
  const crafted = craftFromStorage(storage, potion, 3);
  expect(crafted).toMatchObject({ success: true, quantity: 3 });
  expect(countStorageItems(crafted.storage)).toEqual({ 'Кровяной мох': 1, 'Малое зелье здоровья': 3 });
  expect(craftFromStorage(storage, potion, 4)).toEqual(expect.objectContaining({ success: false, storage }));
});

test('rune recipe consumption does not create a fake storage item', () => {
  const recipe = { name: 'Руна', ingredients: [{ name: 'Эссенция Проклятий', quantity: 1 }] };
  expect(consumeStorageRecipe(['Эссенция Проклятий'], recipe).storage).toEqual([]);
});
