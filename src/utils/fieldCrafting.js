import { FIELD_CRAFTING_RECIPES } from '../data/recipes';
import { getSelectedFieldRecipes } from '../data/fieldCraftingLoadout';
import { craftRunInventoryRecipe } from './expeditionInventory';

// Game/UI/simulator boundary: never trust ingredients or output sent by a caller.
export const craftSelectedFieldRecipe = (player, requested) => {
  const canonical = FIELD_CRAFTING_RECIPES.find(recipe => recipe.id === requested?.id);
  if (!canonical) return { success: false, player, reason: 'invalid-recipe' };
  if (player?.activeCombat) return { success: false, player, reason: 'in-combat' };
  if (!getSelectedFieldRecipes(player).some(recipe => recipe.id === canonical.id)) return { success: false, player, reason: 'recipe-not-equipped' };
  return craftRunInventoryRecipe(player, canonical);
};
