// Pure rules for the Withering Forest's Entanglement status.
// Registration and turn-lifecycle integration live in the canonical effects/combat modules.
export const ENTANGLEMENT_ID = 'entanglement';
export const ENTANGLEMENT_MAX_STACKS = 5;
export const ENTANGLEMENT_SPEED_PENALTY_PER_STACK = 0.06;

const stackSize = effect => Math.max(1, Math.floor(Number(effect?.stacks) || 1));

/** Accept both canonical independent effect instances and serialized stack counts. */
export function getEntanglementStacks(unit) {
  const count = (unit?.effects || [])
    .filter(effect => effect?.id === ENTANGLEMENT_ID)
    .reduce((sum, effect) => sum + stackSize(effect), 0);
  return Math.min(ENTANGLEMENT_MAX_STACKS, count);
}

/**
 * Apply Entanglement after the canonical Speed buffs/debuffs and location modifiers.
 * Compute from the current effective value each time, never from a previously
 * Entanglement-reduced value (otherwise repeated initiative ticks compound it).
 */
export function applyEntanglementSpeed(effectiveSpeed, unit) {
  const speed = Number(effectiveSpeed);
  if (!Number.isFinite(speed)) return 0;
  const multiplier = 1 - getEntanglementStacks(unit) * ENTANGLEMENT_SPEED_PENALTY_PER_STACK;
  return Math.max(0, Math.round(Math.max(0, speed) * multiplier));
}

/**
 * Low-level removal of exactly one charge. The combat lifecycle calls it through
 * advanceEntanglementDecayAtTurnEnd so normal decay happens only every second
 * completed/skipped own turn. Existing metadata is preserved when decrementing
 * a serialized multi-stack effect.
 */
export function consumeEntanglementAtTurnEnd(unit, protectedEpoch = null) {
  if (!Array.isArray(unit?.effects)) return 0;
  const index = unit.effects.findIndex(effect => effect?.id === ENTANGLEMENT_ID
    && (protectedEpoch == null || effect._appliedTurnEpoch !== protectedEpoch));
  if (index === -1) return getEntanglementStacks(unit);
  const effect = unit.effects[index];
  const stacks = stackSize(effect);
  if (stacks > 1) effect.stacks = stacks - 1;
  else unit.effects.splice(index, 1);
  return getEntanglementStacks(unit);
}


/**
 * Entanglement naturally loses one charge after every second completed own turn,
 * including turns skipped by control. Fresh stacks applied during the current
 * turn remain protected by the canonical effect-turn epoch.
 *
 * The cadence is stored on the unit so it survives combat snapshots. Starting a
 * new Entanglement chain resets the cadence in addEffect().
 */
export function advanceEntanglementDecayAtTurnEnd(unit, protectedEpoch = null) {
  if (!unit) return 0;
  const stacks = getEntanglementStacks(unit);
  if (stacks <= 0) {
    unit._entanglementDecayTurns = 0;
    return 0;
  }

  const eligible = (unit.effects || []).some(effect => effect?.id === ENTANGLEMENT_ID
    && (protectedEpoch == null || effect._appliedTurnEpoch !== protectedEpoch));
  if (!eligible) return stacks;

  unit._entanglementDecayTurns = Math.max(0, Number(unit._entanglementDecayTurns) || 0) + 1;
  if (unit._entanglementDecayTurns < 2) return stacks;

  unit._entanglementDecayTurns = 0;
  const remaining = consumeEntanglementAtTurnEnd(unit, protectedEpoch);
  if (remaining <= 0) unit._entanglementDecayTurns = 0;
  return remaining;
}
