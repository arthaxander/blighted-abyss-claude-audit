import { sanitizeForCombatSnapshot } from './combatSnapshot';
import { createAbilityByName } from '../data/abilityPresets';
import { initCombatSession } from './combatUtils';
import { setEffectStackCount } from './effects';
import { createSeededSimulationRng } from './simulationRng';

export const reviveAbility = (ability, fallbackDamage = 10) => {
  if (!ability?.name) return ability;
  const template = createAbilityByName(ability.presetKey || ability.name, fallbackDamage);
  return {
    ...template,
    ...ability,
    damage: template.damage ?? ability.damage,
    effect: template.effect ?? ability.effect,
    effects: template.effects ?? ability.effects,
    selfEffects: template.selfEffects ?? ability.selfEffects,
    secondary: template.secondary ?? ability.secondary,
    onUse: template.onUse ?? ability.onUse,
    onBattleStart: template.onBattleStart ?? ability.onBattleStart,
    onTurnStart: template.onTurnStart ?? ability.onTurnStart,
    onOwnerDamaged: template.onOwnerDamaged ?? ability.onOwnerDamaged,
    onDamageDealt: template.onDamageDealt ?? ability.onDamageDealt,
    canUse: template.canUse ?? ability.canUse,
    aiScore: template.aiScore ?? ability.aiScore,
    targetScore: template.targetScore ?? ability.targetScore,
  };
};

// A combat snapshot cannot store object references, so `sourceRef` is dropped
// on save. Effects that read their owner directly (bleed, Great Bonfire Flame)
// would then lose the owner's current stats after a reload. Re-attach them to
// the live combatant that owns them, using the durable `sourceId` that is
// already stored on every debuff. Ambiguous identities are never guessed:
// a reused id or a shared display name leaves the effect unresolved, which
// matches how a vanished owner behaves in continuous combat.
const relinkEffectSources = (effects, combatants) => {
  if (!Array.isArray(effects) || effects.length === 0) return effects;
  const byKey = new Map();
  const byName = new Map();
  // A regular enemy stores the same value in `id` and `combatInstanceId`, so the
  // same combatant would otherwise be indexed twice and look ambiguous. Only a
  // genuinely different second combatant may make a key ambiguous.
  const add = (map, key, unit) => {
    if (key == null) return;
    const list = map.get(key);
    if (!list) { map.set(key, [unit]); return; }
    if (!list.includes(unit)) list.push(unit);
  };
  combatants.forEach(unit => {
    if (!unit) return;
    add(byKey, unit.id, unit);
    add(byKey, unit.combatInstanceId, unit);
    add(byKey, unit.runtimeId, unit);
    add(byName, unit.name, unit);
  });
  // Only an unambiguous match may be attached. Two different combatants that
  // share an id or a display name stay unresolved rather than being cross-linked.
  const resolveOne = (map, key) => {
    if (key == null) return null;
    const list = map.get(key);
    if (!list || list.length !== 1) return null;
    return list[0];
  };
  effects.forEach(effect => {
    if (!effect || typeof effect !== "object" || effect.sourceRef) return;
    const id = effect.sourceId ?? effect.sourceSnapshot?.id ?? null;
    if (id == null) return;
    const owner = resolveOne(byKey, id) || resolveOne(byName, id) || null;
    if (!owner) return;
    effect.sourceRef = owner;
    if (effect.sourceSnapshot) effect.sourceSnapshot.entity = owner;
  });
  return effects;
};

export const reviveUnit = (unit) => {
  if (!unit) return unit;
  const fallbackDamage = unit.attack ?? unit.baseAtk ?? 10;
  const revived = {
    ...unit,
    abilities: Array.isArray(unit.abilities)
      ? unit.abilities.map(ability => reviveAbility(ability, fallbackDamage))
      : unit.abilities,
    effects: Array.isArray(unit.effects)
      ? unit.effects.filter(effect => effect?.id !== 'withering_phase')
      : [],
    buffs: Array.isArray(unit.buffs) ? unit.buffs : [],
    debuffs: Array.isArray(unit.debuffs) ? unit.debuffs : [],
  };
  if (Number.isFinite(unit.medicalCharges) && unit.medicalCharges > 0 &&
      !revived.effects.some(effect => effect?.id === 'supplies') &&
      (unit.name?.includes('Аптекар') || revived.abilities?.some(ability => ability?.name === 'Полевой набор'))) {
    setEffectStackCount(revived, 'supplies', unit.medicalCharges);
  }
  return revived;
};

export const reviveCombatSession = (snapshot, fallbackPlayer, fallbackEnemies) => {
  if (!snapshot?.state) return null;
  snapshot = sanitizeForCombatSnapshot(snapshot);
  const savedPlayer = snapshot.state.players?.[0];
  const savedEnemies = Array.isArray(snapshot.state.enemies) ? snapshot.state.enemies : null;
  if (!savedPlayer || !savedEnemies) return null;
  const rng = Number.isInteger(snapshot.rngState) ? createSeededSimulationRng(1) : null;
  const baseSession = initCombatSession(
    { ...fallbackPlayer, ...savedPlayer, ignoreTarot: true, preCombatEffects: [] },
    Array.isArray(fallbackEnemies) && fallbackEnemies.length > 0 ? fallbackEnemies : savedEnemies,
    rng ? { rng } : {}
  );
  if (!baseSession?.state) return null;
  if (rng) rng.setState(snapshot.rngState);
  Object.assign(baseSession, {
    location: snapshot.location ?? baseSession.location,
    state: {
      ...baseSession.state,
      ...snapshot.state,
      // A saved battle may contain living or expired temporary allies. Restore
      // the full player-side roster, otherwise summoned units vanish on reload.
      players: [
        reviveUnit({ ...baseSession.state.players?.[0], ...savedPlayer }),
        ...(snapshot.state.players || []).slice(1).map(unit => reviveUnit(unit)),
      ],
      enemies: savedEnemies.map((enemy, index) => reviveUnit({ ...(baseSession.state.enemies?.[index] || {}), ...enemy })),
      log: Array.isArray(snapshot.state.log) ? snapshot.state.log : baseSession.state.log,
      turnState: snapshot.state.turnState || baseSession.state.turnState,
      initiative: snapshot.state.initiative || baseSession.state.initiative,
    },
  });
  // Re-attach effect owners only after both rosters are fully rebuilt, so a
  // summon or ally is resolvable by the same identity it had before the save.
  const restoredCombatants = [
    ...(baseSession.state.players || []),
    ...(baseSession.state.enemies || []),
  ];
  restoredCombatants.forEach(unit => relinkEffectSources(unit?.effects, restoredCombatants));
  for (const key of ['summonSequence', 'friendlySummonCopySequence', 'royalExecutionerSequence', 'burialSealSequence']) {
    baseSession[`_${key}`] = snapshot.runtime?.[key] || 0;
  }
  return baseSession;
};

