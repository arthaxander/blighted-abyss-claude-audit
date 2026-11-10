import { createEnemyInstanceByName, createEnemyInstanceFromBlueprint, getEnemyBlueprintByName } from '../data/enemies';

export const PRODUCTION_BALANCE_VARIANT = 'production_baseline';

const variant = (id, overrides = [], metadata = {}) => Object.freeze({ id, simulatorOnly: true, overrides: Object.freeze(overrides), ...metadata });
const promoted = id => variant(id, [], { status: 'promoted_to_production' });
const value = (path, productionValue, experimentalValue) => Object.freeze({ path, productionValue, experimentalValue });

export const SIMULATION_BALANCE_VARIANTS = Object.freeze({
  production_baseline: variant('production_baseline'),
  fungal_early_baseline: variant('fungal_early_baseline'),
  fungal_early_no_double_infected: variant('fungal_early_no_double_infected', [value('encounter.doubleInfected.beforeStrongUnlock', true, false)]),
  fungal_early_double_infected_lower_weight: variant('fungal_early_double_infected_lower_weight', [value('encounter.doubleInfected.relativeAcceptance', 1, 0.25)]),
  two_headed_baseline: variant('two_headed_baseline'),
  two_headed_solo: variant('two_headed_solo', [value('encounter.twoHeaded.companion', 'production-family-pair', null)]),
  two_headed_restricted_pairs: variant('two_headed_restricted_pairs', [value('encounter.twoHeaded.excludedCompanions', [], ['Троглодит-копейщик', 'Троглодит-заклинатель змей', 'Троглодит-шаман'])]),
  two_headed_lower_pair_weight: variant('two_headed_lower_pair_weight', [value('encounter.twoHeaded.pairAcceptance', 1, 0.25)]),
  fungal_early_all_hp_minus_10: variant('fungal_early_all_hp_minus_10', [value('enemy.fungal.early.normal.hpMultiplier', 1, 0.9)]),
  fungal_infected_hp_minus_15: promoted('fungal_infected_hp_minus_15'),
  global_poison_damage_minus_25: variant('global_poison_damage_minus_25', [value('status.poison.damageMultiplier', 1, 0.75)]),
  global_poison_damage_minus_40: variant('global_poison_damage_minus_40', [value('status.poison.damageMultiplier', 1, 0.6)]),
  fungal_poison_minus_25_and_infected_hp_minus_15: variant('fungal_poison_minus_25_and_infected_hp_minus_15', [value('status.poison.damageMultiplier', 1, 0.75)], { promotedOverrides: ['enemy.fungal.infected.hpMultiplier'] }),
  two_headed_single_poison: variant('two_headed_single_poison', [value('enemy.twoHeaded.doubleBite.poisonInstances', 2, 1)]),
  two_headed_multihit_poison_50: variant('two_headed_multihit_poison_50', [value('enemy.twoHeaded.doubleBite.hits', 1, 2), value('enemy.twoHeaded.doubleBite.poisonChancePerHit', 1, 0.5)]),
  ragshnar_hp_minus_100_resolved: variant('ragshnar_hp_minus_100_resolved', [value('boss.ragshnar.resolvedHpDelta', 0, -100)]),
  ragshnar_standard_inferno_buffs: promoted('ragshnar_standard_inferno_buffs'),
  ragshnar_hp_minus_100_and_standard_buffs: variant('ragshnar_hp_minus_100_and_standard_buffs', [value('boss.ragshnar.resolvedHpDelta', 0, -100)], { promotedOverrides: ['boss.ragshnar.inferno.attackEffect', 'boss.ragshnar.inferno.speedEffect'] }),
  blade_master_hp_plus_100_resolved: variant('blade_master_hp_plus_100_resolved', [value('boss.bladeMaster.resolvedHpDelta', 0, 100)]),
  blade_master_speed_plus_10_resolved: variant('blade_master_speed_plus_10_resolved', [value('boss.bladeMaster.resolvedSpeedDelta', 0, 10)]),
  blade_master_attack_plus_5_speed_plus_10_authored: variant('blade_master_attack_plus_5_speed_plus_10_authored', [value('boss.bladeMaster.authoredAttack', 24, 29), value('boss.bladeMaster.authoredSpeed', 100, 110)], { status: 'screened_rejected', authoredIntent: { maxHp: 285, attack: 29, speed: 110 }, expectedResolved: { maxHp: 499, attack: 39, speed: 121 } }),
  blade_master_shieldbreaker_physdef_18: variant('blade_master_shieldbreaker_physdef_18', [], { status: 'promoted_to_production', promotedOverrides: ['boss.bladeMaster.authoredPhysDef', 'boss.bladeMaster.preciseStrike.shieldDamageMultiplier'] }),
  blade_master_hp_plus_100_speed_plus_10: variant('blade_master_hp_plus_100_speed_plus_10', [value('boss.bladeMaster.resolvedHpDelta', 0, 100), value('boss.bladeMaster.resolvedSpeedDelta', 0, 10)]),
  mycelium_healing_reduced: variant('mycelium_healing_reduced', [value('boss.mycelium.poisonFedHealing.maxHpRatio', 0.08, 0.04)]),
  mycelium_healing_capped: variant('mycelium_healing_capped', [value('boss.mycelium.poisonFedHealing.triggerIntervalBossTurns', 1, 3)]),
  mycelium_phase_two_slower: variant('mycelium_phase_two_slower', [value('boss.mycelium.phaseTwo.speedBoostDuration', 3, 1)]),
  mycelium_combined_conservative: variant('mycelium_combined_conservative', [value('boss.mycelium.poisonFedHealing.maxHpRatio', 0.08, 0.04), value('boss.mycelium.phaseTwo.speedBoostDuration', 3, 1)]),
  blade_master_baseline: variant('blade_master_baseline'),
  blade_dance_defense_down: variant('blade_dance_defense_down', [value('boss.bladeDance.onUninterruptedResolve', null, { effectId: 'phys_def_penalty_minor', duration: 2 })]),
  blade_dance_partial_armor_pierce: variant('blade_dance_partial_armor_pierce', [value('boss.bladeDance.physicalDefenseIgnored', 0, 0.25)]),
  fungal_candidate_minimal: variant('fungal_candidate_minimal', [value('encounter.doubleInfected.relativeAcceptance', 1, 0.25), value('encounter.twoHeaded.pairAcceptance', 1, 0.25), value('boss.mycelium.poisonFedHealing.maxHpRatio', 0.08, 0.04)]),
  fungal_candidate_medium: variant('fungal_candidate_medium', [value('encounter.doubleInfected.beforeStrongUnlock', true, false), value('encounter.twoHeaded.excludedCompanions', [], ['Троглодит-копейщик', 'Троглодит-заклинатель змей', 'Троглодит-шаман']), value('boss.mycelium.poisonFedHealing.maxHpRatio', 0.08, 0.04), value('boss.mycelium.phaseTwo.speedBoostDuration', 3, 1)]),
  fungal_candidate_medium_blade: variant('fungal_candidate_medium_blade', [value('encounter.doubleInfected.beforeStrongUnlock', true, false), value('encounter.twoHeaded.excludedCompanions', [], ['Троглодит-копейщик', 'Троглодит-заклинатель змей', 'Троглодит-шаман']), value('boss.mycelium.poisonFedHealing.maxHpRatio', 0.08, 0.04), value('boss.mycelium.phaseTwo.speedBoostDuration', 3, 1), value('boss.bladeDance.physicalDefenseIgnored', 0, 0.25)]),
});

export const resolveSimulationBalanceVariant = input => {
  const id = input || PRODUCTION_BALANCE_VARIANT;
  const resolved = SIMULATION_BALANCE_VARIANTS[id];
  if (!resolved) throw new Error(`Unknown simulator balance variant: ${id}`);
  return resolved;
};
export const getSimulationOverride = (input, path, fallback) => {
  const override = resolveSimulationBalanceVariant(input?.id || input).overrides.find(entry => entry.path === path);
  return override ? override.experimentalValue : fallback;
};

const names = encounter => encounter.map(enemy => enemy?.name);
const replaceOne = (encounter, from, to) => {
  let replaced = false;
  return encounter.map(enemy => {
    if (replaced || enemy?.name !== from) return enemy;
    replaced = true;
    return createEnemyInstanceByName(to);
  });
};

export const applySimulationEncounterVariant = ({ encounter = [], variant: input, completedCombatRooms = 0, rng = Math.random, rerollEncounter } = {}) => {
  const resolved = resolveSimulationBalanceVariant(input?.id || input);
  // Always clone runtime units and their abilities. Variants must never mutate the
  // exported production blueprints (or a caller-owned encounter used by a pair).
  let result = encounter.map(enemy => ({ ...enemy, abilities: (enemy?.abilities || []).map(ability => ({ ...ability })) }));
  const rerollUntil = predicate => {
    if (typeof rerollEncounter !== 'function') return null;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidate = (rerollEncounter() || []).filter(Boolean);
      if (!predicate(candidate)) return candidate;
    }
    return null;
  };
  const doubleInfected = names(result).filter(name => name === 'Троглодит-заражённый').length === 2;
  const isDoubleInfected = candidate => names(candidate).filter(name => name === 'Троглодит-заражённый').length === 2;
  if (completedCombatRooms < 7 && doubleInfected && getSimulationOverride(resolved, 'encounter.doubleInfected.beforeStrongUnlock', true) === false) result = rerollUntil(isDoubleInfected) || replaceOne(result, 'Троглодит-заражённый', 'Троглодит-споровик');
  const doubleAcceptance = getSimulationOverride(resolved, 'encounter.doubleInfected.relativeAcceptance', 1);
  if (completedCombatRooms < 7 && doubleInfected && doubleAcceptance < 1 && rng() >= doubleAcceptance) result = rerollUntil(isDoubleInfected) || replaceOne(result, 'Троглодит-заражённый', 'Троглодит-споровик');
  const twoHeaded = result.find(enemy => enemy?.name === 'Змеиный двоеглав');
  if (twoHeaded && getSimulationOverride(resolved, 'encounter.twoHeaded.companion', 'production-family-pair') === null) result = [twoHeaded];
  const pairAcceptance = getSimulationOverride(resolved, 'encounter.twoHeaded.pairAcceptance', 1);
  const isTwoHeadedPair = candidate => candidate.length > 1 && candidate.some(enemy => enemy?.name === 'Змеиный двоеглав');
  if (twoHeaded && pairAcceptance < 1 && result.length > 1 && rng() >= pairAcceptance) result = rerollUntil(isTwoHeadedPair) || [twoHeaded];
  const excluded = getSimulationOverride(resolved, 'encounter.twoHeaded.excludedCompanions', []);
  const isExcludedPair = candidate => candidate.some(enemy => enemy?.name === 'Змеиный двоеглав') && candidate.some(enemy => excluded.includes(enemy?.name));
  if (twoHeaded && result.some(enemy => excluded.includes(enemy?.name))) result = rerollUntil(isExcludedPair) || [twoHeaded, createEnemyInstanceByName('Костестраж')];
  result = result.map(enemy => {
    let clone = enemy;
    const isFungal = enemy?.location === 'Грибные Пещеры';
    const eligibleEarly = isFungal && enemy.encounterPhase !== 'late' && !enemy.summoned && !enemy.cursed && enemy.roomRole !== 'cursedEnemy' && !enemy.miniBoss && !enemy.boss;
    let hpMultiplier = 1;
    if (eligibleEarly) hpMultiplier = getSimulationOverride(resolved, 'enemy.fungal.early.normal.hpMultiplier', hpMultiplier);
    if (isFungal && ['Троглодит-заражённый', 'Троглодит-споровик'].includes(enemy.name)) hpMultiplier = getSimulationOverride(resolved, 'enemy.fungal.infected.hpMultiplier', hpMultiplier);
    if (hpMultiplier !== 1) clone = { ...clone, maxHp: Math.round(enemy.maxHp * hpMultiplier), hp: Math.round(enemy.hp * hpMultiplier) };
    if (enemy.name === 'Змеиный двоеглав') {
      clone = { ...clone, abilities: clone.abilities.map(ability => {
        if (ability.artId !== 'double_bite') return ability;
        const poisonInstances = getSimulationOverride(resolved, 'enemy.twoHeaded.doubleBite.poisonInstances', 2);
        const hits = getSimulationOverride(resolved, 'enemy.twoHeaded.doubleBite.hits', 1);
        if (hits === 2) return { ...ability, hits: 2, damage: ({ attacker, target }) => (attacker?.attack || 0) * ((target?.effects || []).some(effect => effect.id === 'poison') ? 1.3 : 1.05) / 2, effect: ({ session }) => (session?.rng || Math.random)() < 0.5 ? { id: 'poison', duration: 2 } : null };
        if (poisonInstances === 1) return { ...ability, effect: [{ id: 'poison', duration: 2 }] };
        return ability;
      }) };
    }
    clone._simulationPoisonDamageMultiplier = getSimulationOverride(resolved, 'status.poison.damageMultiplier', 1);
    clone._simulationBalanceVariant = resolved.id;
    return clone;
  });
  return { encounter: result.filter(Boolean), variant: resolved };
};

export const applySimulationBossVariant = (enemy, input) => {
  const resolved = resolveSimulationBalanceVariant(input?.id || input);
  if (!enemy?.boss) return enemy;
  let clone = { ...enemy, abilities: (enemy.abilities || []).map(ability => ({ ...ability })) };
  if (clone.name === 'Мастер клинков' && resolved.id === 'blade_master_attack_plus_5_speed_plus_10_authored') {
    const productionBlueprint = getEnemyBlueprintByName(clone.name);
    const authoredClone = { ...productionBlueprint, attack: 29, speed: 110 };
    clone = createEnemyInstanceFromBlueprint(authoredClone, { overrideId: clone.id, portraitKey: clone.portraitKey });
    clone._simulationAuthoredIntent = { maxHp: authoredClone.maxHp, attack: authoredClone.attack, speed: authoredClone.speed };
    clone._simulationResolvedStats = { maxHp: clone.maxHp, attack: clone.attack, speed: clone.speed };
  }
  if (clone.name === 'Пепельный Колпак Рагшнар') {
    const hpDelta = getSimulationOverride(resolved, 'boss.ragshnar.resolvedHpDelta', 0);
    clone.maxHp += hpDelta; clone.hp += hpDelta;
  }
  clone._simulationPoisonDamageMultiplier = getSimulationOverride(resolved, 'status.poison.damageMultiplier', 1);
  if (clone.name === 'Мастер клинков') {
    const hpDelta = getSimulationOverride(resolved, 'boss.bladeMaster.resolvedHpDelta', 0);
    clone.maxHp += hpDelta; clone.hp += hpDelta;
    clone.speed += getSimulationOverride(resolved, 'boss.bladeMaster.resolvedSpeedDelta', 0);
  }
  if (clone.name === 'Троглодит-мицелий (босс)') {
    clone.abilities = clone.abilities.map(ability => {
      const healingRatio = getSimulationOverride(resolved, 'boss.mycelium.poisonFedHealing.maxHpRatio', 0.08);
      const triggerInterval = getSimulationOverride(resolved, 'boss.mycelium.poisonFedHealing.triggerIntervalBossTurns', 1);
      if (ability.artId === 'mycelium_feeding' && (healingRatio !== 0.08 || triggerInterval !== 1)) {
        const original = ability.onTurnStart;
        return { ...ability, onTurnStart: context => {
          const owner = context.owner; owner._simulationFeedingTurns = (owner._simulationFeedingTurns || 0) + 1;
          if (owner._simulationLastFeedingTurn && owner._simulationFeedingTurns - owner._simulationLastFeedingTurn < triggerInterval) return;
          const before = owner.hp; const buffered = [];
          original?.({ ...context, log: message => buffered.push(message) });
          if (owner.hp > before) {
            owner._simulationLastFeedingTurn = owner._simulationFeedingTurns;
            if (healingRatio !== 0.08) owner.hp = before + Math.round((owner.hp - before) * healingRatio / 0.08);
            context.log?.(`🍄 Мицелиевое питание восстанавливает ${owner.hp - before} здоровья.`);
          } else buffered.forEach(message => context.log?.(message));
        } };
      }
      const speedDuration = getSimulationOverride(resolved, 'boss.mycelium.phaseTwo.speedBoostDuration', 3);
      if (ability.artId === 'mycelium_constriction' && speedDuration !== 3) {
        const original = ability.onTurnStart;
        return { ...ability, onTurnStart: context => { const wasPhaseTwo = context.owner._myceliumPhaseTwoTriggered; original?.(context); if (!wasPhaseTwo && context.owner._myceliumPhaseTwoTriggered) (context.owner.effects || []).filter(effect => effect.id === 'speed_boost_minor').forEach(effect => { effect.duration = speedDuration; effect.remainingTurns = speedDuration; }); } };
      }
      return ability;
    });
  }
  clone._simulationBalanceVariant = resolved.id;
  return clone;
};
