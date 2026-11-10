// Thorn reflection uses only HP actually lost by a direct attack. It is not a
// direct attack itself and must never use shields, mitigations, DoT ticks or
// another reflection as its source. The combat executor deals the resulting
// damage after a confirmed hit; this helper has no side effects.
export const THORN_REFLECTION_RATIO = 0.15;
export const THORN_REFLECTION_ID = 'thorn_reflection';
export const THORN_PASSIVE_NAME = 'Ответные шипы';

export function getThornReflectionDamage(target, {
  source = null, actualHpLost = 0, directAttack = false,
  isPeriodic = false, fromEffect = null, sourceEffectId = null,
} = {}) {
  if (!target || !source || source === target || source.hp <= 0) return 0;
  if (!directAttack || isPeriodic || fromEffect || sourceEffectId || target.passivesDisabled) return 0;
  if (!(target.abilities || []).some(ability => ability?.passive && ability.name === THORN_PASSIVE_NAME)) return 0;
  const lost = Math.max(0, Number(actualHpLost) || 0);
  return Math.max(0, Math.round(lost * THORN_REFLECTION_RATIO));
}
