// The Forest shadow begins hidden, but attacking (even a miss) reveals it.
// Keep the bonus on the attack action, never on the unit, to avoid reapplying it
// on subsequent actions or multiplying multi-hit attacks several times.
export const SHADOW_BACKSTAB_RATIO = 0.35;
export const SHADOW_EXECUTE_THRESHOLD = 0.4;
export const SHADOW_EXECUTE_BONUS = 0.35;

export const shadowExecuteMultiplier = target => {
  const maxHp = Number(target?.maxHp) || 0;
  return maxHp > 0 && (Number(target?.hp) || 0) / maxHp <= SHADOW_EXECUTE_THRESHOLD
    ? 1 + SHADOW_EXECUTE_BONUS
    : 1;
};

export const beginInvisibleAttack = (attacker, ability, action, logFn = () => {}) => {
  if (!attacker || !action || !ability || ability.passive || ability.isSecondaryDamage) return false;
  const hidden = Boolean(attacker.invisible || (attacker.effects || []).some(effect => effect?.id === 'invisibility'));
  if (!hidden) return false;
  const shadowBackstab = attacker.name === 'Тень чащи'
    && !attacker.passivesDisabled
    && (attacker.abilities || []).some(passive => passive?.passive && passive.name === 'Удар в спину');
  attacker.effects = (attacker.effects || []).filter(effect => effect?.id !== 'invisibility');
  attacker.invisible = false;
  if (shadowBackstab) {
    action.shadowBackstabMultiplier = 1 + SHADOW_BACKSTAB_RATIO;
    logFn(`🗡️ ${attacker.name} раскрывает себя и усиливает первую атаку Ударом в спину.`);
  } else {
    logFn(`🎭 ${attacker.name || 'Боец'} теряет Невидимость при атаке.`);
  }
  return true;
};
