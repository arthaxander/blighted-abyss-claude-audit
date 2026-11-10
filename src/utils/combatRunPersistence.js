import { getItemDefinition } from '../data/items';
import { getRunInventoryLayout, insertItems, migrateRunInventory } from './expeditionInventory';

export const resolveCombatPlayerFromBattleResult = (battleResult, activeCombat) => (
  battleResult?.playerState || activeCombat?.state?.players?.[0] || null
);

export const resolvePostCombatVitals = (persistentPlayer = {}, combatPlayer = null) => {
  const maxHp = Math.max(0, combatPlayer?.maxHp ?? persistentPlayer.maxHp ?? combatPlayer?.baseStats?.maxHp ?? persistentPlayer.hp ?? 0);
  const hp = Math.max(0, Math.min(maxHp, combatPlayer?.hp ?? persistentPlayer.hp ?? maxHp));
  return { hp, maxHp };
};

const isCombatConsumable = itemId => ['heal', 'effects', 'cleanse', 'ability', 'tacticalScroll', 'preparedTrap', 'primeNextDirectAttack', 'entanglementScroll'].includes(getItemDefinition(itemId)?.type);

/** Reconciles the combat copy back into the one authoritative expedition inventory. */
export const reconcileCombatConsumables = (persistentPlayer = {}, combatPlayer = null) => {
  const layout = getRunInventoryLayout(persistentPlayer?.equipment);
  const remaining = (combatPlayer?.items || []).reduce((counts, item) => {
    const itemId = typeof item === 'string' ? item : item?.name;
    if (itemId && isCombatConsumable(itemId)) counts[itemId] = (counts[itemId] || 0) + 1;
    return counts;
  }, {});
  const slots = migrateRunInventory(persistentPlayer?.runInventory, persistentPlayer?.equipment, persistentPlayer?.runInventoryLayoutVersion).map(stack => {
    if (!stack || !isCombatConsumable(stack.itemId)) return stack;
    const kept = Math.min(stack.quantity, remaining[stack.itemId] || 0);
    remaining[stack.itemId] = Math.max(0, (remaining[stack.itemId] || 0) - kept);
    return kept ? { ...stack, quantity: kept } : null;
  });
  const additions = Object.entries(remaining).filter(([, quantity]) => quantity > 0).map(([itemId, quantity]) => ({ itemId, quantity }));
  const reconciled = insertItems(slots, additions, { layout }).slots;
  return { ...persistentPlayer, runInventory: reconciled, preparedTrap: null };
};
