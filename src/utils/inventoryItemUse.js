import { findItemData } from '../data/items';
import { DEFAULT_RELIC_ID, ensureRelicState, getRelicBonuses } from '../data/relics';
import { discardInventoryStack, normalizeInventorySlots } from './expeditionInventory';

export const getInventoryItemUseCapability = (item, { inExpedition = false, inCombat = false, player } = {}) => {
  const def = findItemData(typeof item === 'string' ? item : item?.itemId);
  if (!def?.fieldUse) return { available: false, reason: null };
  if (!inExpedition || inCombat) return { available: false, reason: 'Можно использовать только вне боя во время экспедиции' };
  if (def.fieldUse.type === 'healAndNextCombatEffect' && (player?.hp ?? 0) >= (player?.maxHp ?? player?.hp ?? 0)) return { available: false, reason: 'Здоровье уже полностью восстановлено' };
  if (def.fieldUse.type === 'prepareTrap') return { available: false, reason: 'Ловушка устанавливается в бою за ход' };
  return { available: true, reason: null };
};

export const applyInventoryItemUse = (player, slotIndex, context = {}) => {
  const slots = normalizeInventorySlots(player?.runInventory, player?.runInventory?.length || 10);
  const stack = slots[slotIndex];
  const def = findItemData(stack?.itemId);
  const capability = getInventoryItemUseCapability(stack, { ...context, player });
  if (!stack || !def?.fieldUse || !capability.available) return { used: false, player, reason: capability.reason };
  const fieldUse = def.fieldUse;
  let next = { ...player };
  if (fieldUse.type === 'healAndNextCombatEffect') {
    const maxHp = Math.max(0, player.maxHp ?? player.hp ?? 0);
    next.hp = Math.min(maxHp, Math.max(0, player.hp ?? maxHp) + (fieldUse.healAmount || 0));
    const effects = Array.isArray(player.preCombatEffects) ? player.preCombatEffects : [];
    next.preCombatEffects = [...effects.filter(effect => !fieldUse.nextCombatEffects.some(nextEffect => nextEffect.id === effect?.id)), ...fieldUse.nextCombatEffects.map(effect => ({ ...effect }))];
  }
  const relics = ensureRelicState(player.relics); const level = relics.progress?.[DEFAULT_RELIC_ID]?.level || 0;
  const preserveChance = relics.activeRelicId === DEFAULT_RELIC_ID ? getRelicBonuses(DEFAULT_RELIC_ID, level).preserveConsumableChance : 0;
  const preserved = preserveChance > 0 && (context.rng || Math.random)() < preserveChance;
  if (!preserved) slots[slotIndex] = stack.quantity > 1 ? { ...stack, quantity: stack.quantity - 1 } : null;
  next.runInventory = slots;
  return { used: true, preserved, player: next };
};

export const discardInventoryItem = (player, slotIndex) => {
  const slots = discardInventoryStack(player.runInventory, slotIndex);
  return { ...player, runInventory: slots, preparedTrap: slots.some(stack => stack?.itemId === player.preparedTrap) ? player.preparedTrap : null };
};
