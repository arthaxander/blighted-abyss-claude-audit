import { cleanseEffects } from './effects';

// Capture the debuff before an action starts. A debuff gained during the action
// cannot retrospectively modify that action's cooldown.
export const captureOvergrowth = unit => (unit?.effects || []).find(effect => effect?.id === 'overgrowth') || null;

// Call only after a non-basic active action actually executes and its final
// cooldown has been assigned, including other cooldown modifiers.
export function consumeOvergrowthAfterAction(unit, ability, capturedEffect, logFn = () => {}) {
  if (!unit || !ability || !capturedEffect || ability.basic || ability.passive) return false;
  if (!(unit.effects || []).includes(capturedEffect)) return false;
  if (!Number.isFinite(ability.currentCooldown)) return false;
  ability.currentCooldown = Math.max(0, ability.currentCooldown) + 1;
  cleanseEffects(unit, effect => effect === capturedEffect, logFn);
  if (typeof logFn === 'function') logFn(`🌿 Зарастание продлевает восстановление «${ability.name}» на 1 ход.`);
  return true;
}
