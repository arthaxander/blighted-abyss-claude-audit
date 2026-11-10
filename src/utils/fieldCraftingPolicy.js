import { craftSelectedFieldRecipe } from './fieldCrafting';
import { getSelectedFieldRecipes } from '../data/fieldCraftingLoadout';
import { applyInventoryItemUse } from './inventoryItemUse';

export const FIELD_CRAFT_POLICY_IDS = ['off', 'moderate', 'prepared'];
const count = (player, name) => (player.runInventory || []).reduce((n, stack) => n + (stack?.itemId === name ? stack.quantity : 0), 0);

// Uses only the currently visible encounter, never future route contents.
export const applyFieldCraftingPolicy = (player, policy = 'moderate', { enemies = [], rng = Math.random, disabledCategories = [] } = {}) => {
  if (!FIELD_CRAFT_POLICY_IDS.includes(policy)) throw new Error(`Unknown field crafting policy: ${policy}`);
  const metrics = { crafted: {}, used: {}, missingIngredients: 0, noSpace: 0, ingredientsConsumed: {}, hpRestored: 0 };
  if (policy === 'off') return { player, metrics };
  let next = player;
  const recipes = getSelectedFieldRecipes(player);
  const craft = name => {
    const recipe = recipes.find(entry => entry.name === name);
    if (!recipe || disabledCategories.includes(recipe.category === 'survival' ? 'medicine' : recipe.category)) return false;
    const result = craftSelectedFieldRecipe(next, recipe);
    if (!result.success) {
      if (result.reason === 'missing-ingredients') metrics.missingIngredients++;
      if (result.reason === 'insufficient-space') metrics.noSpace++;
      return false;
    }
    next = result.player;
    metrics.crafted[name] = (metrics.crafted[name] || 0) + 1;
    recipe.ingredients.forEach(i => { metrics.ingredientsConsumed[i.name] = (metrics.ingredientsConsumed[i.name] || 0) + i.quantity; });
    return true;
  };
  const medicine = Number(player.abyssLevel) >= 2 ? 'Кровяная повязка' : 'Кровяная припарка';
  const threshold = policy === 'prepared' ? 0.75 : 0.55;
  for (let n = 0; n < 3 && next.hp < next.maxHp * threshold; n++) {
    if (disabledCategories.includes('medicine') || (!count(next, medicine) && !craft(medicine))) break;
    const before = next.hp;
    const result = applyInventoryItemUse(next, next.runInventory.findIndex(stack => stack?.itemId === medicine), { inExpedition: true, rng });
    if (!result.used) break;
    next = result.player;
    metrics.used[medicine] = (metrics.used[medicine] || 0) + 1;
    metrics.hpRestored += next.hp - before;
  }
  const healing = Number(player.abyssLevel) >= 2 ? 'Зелье здоровья' : 'Малое зелье здоровья';
  if (!count(next, healing)) craft(healing);
  const dangerous = enemies.length >= 3 || enemies.some(enemy => enemy.boss || enemy.miniBoss || enemy.rewardRank === 'strong' || enemy.roomRole === 'cursedEnemy');
  if (!dangerous) return { player: next, metrics };
  const priorities = [];
  if (enemies.some(enemy => enemy.shield > 0 || /щит/i.test(JSON.stringify(enemy.abilities || [])))) priorities.push('Свиток надлома щита');
  if (enemies.some(enemy => /Натиск|Укрепление|мощь|Регенерация/.test(JSON.stringify(enemy.abilities || [])))) priorities.push('Свиток рассеивания');
  if (policy === 'prepared' && !next.preparedTrap) priorities.push(player.class === 'Archer' ? 'Колючая западня' : 'Липкая западня');
  if (enemies.length >= 3) priorities.push('Свиток Ядовитого облака', 'Свиток Огненного шара');
  if (Math.max(0, ...enemies.map(enemy => enemy.attack || 0)) >= 12) priorities.push('Свиток ослабления');
  if (!enemies.every(enemy => enemy.controlImmune || enemy.innateControlImmune)) priorities.push('Свиток промедления');
  if (policy === 'prepared') priorities.push(player.class === 'Mage' ? 'Малое зелье магической силы' : 'Малое зелье атаки', 'Малое зелье щита');
  let budget = policy === 'prepared' ? 3 : 1;
  for (const name of priorities) {
    if (count(next, name) || budget <= 0) continue;
    if (craft(name)) budget--;
  }
  return { player: next, metrics };
};
