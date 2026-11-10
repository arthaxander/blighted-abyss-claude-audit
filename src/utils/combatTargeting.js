export const getActionTargetMode = action => (
  action?.targeting || action?.target || action?.targetType || "enemy"
);

const getCombatTargetRuntimeId = unit => unit?.id || unit?.runtimeId || unit?.combatId || null;

export const getCombatTargetId = (side, index, unit = null) => {
  const runtimeId = getCombatTargetRuntimeId(unit);
  return runtimeId ? `${side}:${runtimeId}` : `${side}:${index}`;
};

// Shared source of truth for UI, hero executor, enemy AI and friendly summons.
// Guard only applies to single-target hostile actions, never AoE.
export const getEligibleHostileUnits = (units = [], { area = false } = {}) => {
  const alive = units.filter(unit => unit && unit.hp > 0);
  if (area) return alive;
  const visible = alive.filter(unit => !unit.invisible);
  const eligible = visible.length > 0 ? visible : alive;
  const guards = eligible.filter(unit => (unit.effects || []).some(effect =>
    effect?.id === 'guard' && (effect.remainingTurns ?? effect.duration ?? 1) > 0
  ));
  return guards.length > 0 ? guards : eligible;
};

export const getValidCombatTargets = ({ action, players = [], enemies = [] }) => {
  const mode = getActionTargetMode(action);
  const livingPlayers = players
    .map((unit, index) => ({ id: getCombatTargetId("player", index, unit), side: "player", index, unit }))
    .filter(target => target.unit && target.unit.hp > 0);
  const livingEnemies = enemies
    .map((unit, index) => ({ id: getCombatTargetId("enemy", index, unit), side: "enemy", index, unit }))
    .filter(target => target.unit && target.unit.hp > 0);

  // Area abilities can hit all living enemies, regardless of visibility or Guard.
  const modeIsArea = mode === "allEnemies" || mode === "enemies";
  const eligibleUnits = getEligibleHostileUnits(livingEnemies.map(target => target.unit), { area: modeIsArea });
  const hostileEligible = livingEnemies.filter(target => eligibleUnits.includes(target.unit));

  if (mode === "self") return livingPlayers.filter(target => target.index === 0);
  if (mode === "ally" || mode === "allAllies" || mode === "friendly") return livingPlayers;
  if (modeIsArea) return livingEnemies;
  return hostileEligible;
};

export const findValidCombatTarget = (validTargets, targetId) => (
  (validTargets || []).find(target => target.id === targetId) || null
);

export const createExecutionGate = () => {
  let executed = false;
  return callback => {
    if (executed) return false;
    executed = true;
    callback();
    return true;
  };
};

export const executeValidCombatDrop = ({ validTargets, targetId, execute, gate }) => {
  const target = findValidCombatTarget(validTargets, targetId);
  if (!target || typeof execute !== "function") return false;
  const executeOnce = gate || createExecutionGate();
  return executeOnce(() => execute(target));
};
