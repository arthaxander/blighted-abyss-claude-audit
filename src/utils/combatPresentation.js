import { getEffectDefinition, isEffectUnremovable } from './effects';

const finitePresentedDuration = (effect, definition) => {
  if (definition?.durationPresentation === 'permanent' || definition?.persistent || definition?.permanent ||
      effect?.durationPresentation === 'permanent' || effect?.persistent || effect?.permanent) return null;
  const value = Number(effect?.remainingTurns ?? effect?.duration);
  return Number.isFinite(value) && value > 0 && value < 999 ? value : null;
};

/** Converts mechanical effect instances to immutable battlefield status entries. */
export const presentCombatStatuses = (effects = []) => {
  const presented = [];
  const grouped = new Map();
  (Array.isArray(effects) ? effects : []).filter(Boolean).forEach((effect, index) => {
    const definition = getEffectDefinition(effect.id || effect.name) || {};
    const remainingTurns = finitePresentedDuration(effect, definition);
    const entry = {
      ...definition,
      ...effect,
      type: effect.type || effect.kind || definition.type,
      remainingTurns,
      ...(definition.id === 'bleed' && remainingTurns ? { stacks: remainingTurns } : {}),
      unremovable: isEffectUnremovable(effect),
      presentationKey: `${effect.id || effect.name || 'effect'}-${index}`,
    };
    const aggregate = definition.stacking === 'stack' && definition.independentInstances !== true;
    if (!aggregate) {
      presented.push({ ...entry, stacks: Math.max(1, Number(effect.stacks) || 1) });
      return;
    }
    const key = definition.id || effect.id || effect.name;
    const current = grouped.get(key);
    const instanceStacks = Math.max(1, Number(effect.stacks) || 1);
    if (!current) {
      const next = { ...entry, stacks: instanceStacks };
      grouped.set(key, next);
      presented.push(next);
    } else {
      current.stacks += instanceStacks;
      current.remainingTurns = Math.max(current.remainingTurns || 0, entry.remainingTurns || 0) || null;
      current.unremovable = current.unremovable || entry.unremovable;
    }
  });
  return presented;
};

export const getVisibleStatuses = (statuses = [], capacity = 10) => {
  const safeStatuses = Array.isArray(statuses) ? statuses.filter(Boolean) : [];
  const safeCapacity = Math.max(0, Math.floor(capacity));

  if (safeStatuses.length <= safeCapacity) {
    return { visible: safeStatuses, hiddenCount: 0 };
  }
  if (safeCapacity === 0) {
    return { visible: [], hiddenCount: safeStatuses.length };
  }

  return {
    visible: safeStatuses.slice(0, safeCapacity - 1),
    hiddenCount: safeStatuses.length - (safeCapacity - 1),
  };
};

export const formatHealthWithShield = (currentHp, shield, maxHp) => {
  const current = Number.isFinite(Number(currentHp)) ? Number(currentHp) : 0;
  const barrier = Math.max(0, Number.isFinite(Number(shield)) ? Number(shield) : 0);
  const maximum = Math.max(0, Number.isFinite(Number(maxHp)) ? Number(maxHp) : 0);
  return barrier > 0 ? `${current}/${maximum} +${barrier}` : `${current}/${maximum}`;
};

export const getHealthShieldSegments = (currentHp, shield, maxHp) => {
  const maximum = Math.max(0, Number(maxHp) || 0);
  const current = Math.max(0, Math.min(Number(currentHp) || 0, maximum));
  const barrier = Math.max(0, Number(shield) || 0);
  const missing = Math.max(0, maximum - current);
  const visualTotal = Math.max(1, maximum + barrier);

  return {
    hpPercent: (current / visualTotal) * 100,
    shieldPercent: (barrier / visualTotal) * 100,
    missingPercent: (missing / visualTotal) * 100,
  };
};

export const getCombatActionGridAbilities = (abilities = []) => {
  const activeAbilities = (Array.isArray(abilities) ? abilities : []).filter(ability => ability && !ability.passive);
  const basicAttack = activeAbilities.find(ability => ability.basic || ability.artId === "attack");
  const classAbilities = activeAbilities.filter(ability => ability !== basicAttack);

  return [
    ...classAbilities.slice(0, 2),
    ...(basicAttack ? [basicAttack] : []),
    ...classAbilities.slice(2),
  ];
};

export const getCooldownPresentationFraction = (ability = {}) => {
  const remaining = Math.max(0, Number(ability.currentCooldown) || 0);
  const total = Number(ability.cooldown) || 0;
  if (remaining <= 0 || total <= 0) return 0;
  return Math.min(1, remaining / total);
};
