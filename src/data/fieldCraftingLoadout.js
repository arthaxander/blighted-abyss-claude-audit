import { FIELD_CRAFTING_RECIPES, getFieldCraftingRecipes } from './recipes';

export const FIELD_RECIPE_SLOTS = [
  { category: 'medicine', label: 'Зелье 1' }, { category: 'medicine', label: 'Зелье 2' },
  { category: 'scroll', label: 'Свиток 1' }, { category: 'scroll', label: 'Свиток 2' },
  { category: 'trap', label: 'Ловушка' }, { category: 'any', label: 'Универсальный рецепт' },
];
export const FIELD_PRESET_COUNT = 3;
const byId = id => FIELD_CRAFTING_RECIPES.find(recipe => recipe.id === id);
const defaults = ['Малое зелье здоровья', 'Малое зелье регенерации', 'Свиток уязвимости', 'Свиток Конус льда', 'Колючая западня', 'Свиток Огненного шара']
  .map(name => FIELD_CRAFTING_RECIPES.find(recipe => recipe.name === name)?.id || null);
export const normalizeFieldLoadout = input => {
  const source = Array.isArray(input) ? input : defaults;
  const seen = new Set();
  return FIELD_RECIPE_SLOTS.map((slot, index) => {
    const recipe = byId(source[index]);
    if (!recipe || recipe.category === 'survival' || seen.has(recipe.id) || (slot.category !== 'any' && slot.category !== recipe.category)) return null;
    seen.add(recipe.id);
    return recipe.id;
  });
};
export const isFieldLoadoutLocked = player => Boolean(player?.currentLocation || player?.activeCombat || player?.expeditionPhase);
export const getActiveFieldLoadout = player => normalizeFieldLoadout(
  isFieldLoadoutLocked(player) ? player?.fieldCraftingRunLoadout ?? player?.fieldCraftingLoadout : player?.fieldCraftingLoadout
);
export const getSelectedFieldRecipes = player => {
  const selected = new Set(getActiveFieldLoadout(player));
  return getFieldCraftingRecipes({ abyssLevel: player?.abyssLevel || 1 }).filter(recipe => recipe.category === 'survival' || selected.has(recipe.id));
};
export const setFieldLoadout = (player, value) => isFieldLoadoutLocked(player) ? player : { ...player, fieldCraftingLoadout: normalizeFieldLoadout(value) };
export const getFieldPresets = player => Array.from({ length: FIELD_PRESET_COUNT }, (_, index) => {
  const preset = player?.fieldCraftingPresets?.[index];
  return preset && Array.isArray(preset.recipes) ? { name: String(preset.name || `Набор ${index + 1}`).slice(0, 32), recipes: normalizeFieldLoadout(preset.recipes) } : null;
});
export const saveFieldPreset = (player, index, name) => {
  if (isFieldLoadoutLocked(player) || !Number.isInteger(index) || index < 0 || index >= FIELD_PRESET_COUNT) return player;
  const presets = getFieldPresets(player);
  presets[index] = { name: String(name || `Набор ${index + 1}`).trim().slice(0, 32) || `Набор ${index + 1}`, recipes: normalizeFieldLoadout(player.fieldCraftingLoadout) };
  return { ...player, fieldCraftingPresets: presets };
};
export const applyFieldPreset = (player, index) => {
  const preset = getFieldPresets(player)[index];
  return preset ? setFieldLoadout(player, preset.recipes) : player;
};
