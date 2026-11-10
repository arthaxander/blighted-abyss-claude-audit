import { createCombatRecording, executeCombatCommand } from './combatExecution';
import { ELEMENTAL_CHARGE_IDS, getElementalChargeSchool } from '../data/elementalCharges';
import { getClassDamageMultiplier } from '../data/classCombatBalance';
import { isFieldControlImmune } from './fieldTraps';
import { getEffectDefinition } from './effects';
import { createAbilityByName } from '../data/abilityPresets';
import { createEnemyInstanceByName, enemies as canonicalEnemies } from '../data/enemies';
import { getPlayableClassDefinition, createClassBaseStats } from '../data/classTemplates';
import { AVAILABLE_LOCATIONS, LEVEL_TWO_LOCATIONS } from '../data/locations';
import { getItemDefinition } from '../data/items';
import { applyDeserterAlertModifier, createDeserterCampEncounter, createEncounterPair, createGoblinNestsEncounter, createMushroomCavesEncounter, createWitheringForestEncounter, createRestlessRuinsEncounter, createMinesOfDecayEncounter, DESERTER_LOCATION, FUNGAL_LOCATION, GOBLIN_LOCATION, WITHERING_FOREST_LOCATION, RESTLESS_RUINS_LOCATION, MINES_OF_DECAY_LOCATION, getDeserterAlertLevel, getTrashEnemyPool } from './enemyPools';
import { calculateVisibleDamage, checkBattleOutcome, getEffectiveSpeed, getVisibleHitChance, initCombatSession } from './combatUtils';
import { addEffect } from './effects';
import { createSeededSimulationRng as createSeededRng, deriveSimulationSeed as deriveRunSeed } from './simulationRng';
import { resolveSimulationPlayerProfile, snapshotSimulationPlayer } from './simulationPlayerProfiles';
import { BOSS_EVALUATOR_COVERAGE, getVisibleBossMechanic } from './simulationBossMechanics';
import { applySimulationBossVariant, applySimulationEncounterVariant, getSimulationOverride, resolveSimulationBalanceVariant } from './simulationBalanceVariants';

export const COMBAT_SIMULATOR_VERSION = 3;
export const DEFAULT_COMBAT_ACTION_GUARD = 500;
export const COMBAT_POLICY_IDS = Object.freeze(['random', 'naive', 'competent', 'strategic', 'boss_aware', 'ruins_priority']);
const resolveCombatLocation = input => {
  const aliases = { mushroom: 'fungal' };
  const id = aliases[String(input).toLowerCase()] || input;
  const location = [...AVAILABLE_LOCATIONS, ...LEVEL_TWO_LOCATIONS].find(entry => entry.id === id || entry.name === input);
  if (!location) throw new Error(`Unknown combat simulation location: ${input}`);
  return location;
};

const DEFAULT_LOADOUTS = Object.freeze({
  Defender: ['Стойкость', 'Кровавый таран', 'Устрашение', 'Удар щитом', 'Атака'],
  Archer: ['Зазубренная стрела', 'Змеиная ловушка', 'Перенаправление', 'Добивающий выстрел', 'Атака'],
  Mage: ['Огненный шар', 'Ледяное копьё', 'Цепная молния', 'Грозовой разряд', 'Стихийное эхо', 'Атака'],
});

const DEFAULT_PASSIVES = Object.freeze({
  Defender: [],
  Archer: ['finish_the_prey', 'hunting_rhythm'],
  Mage: ['lightning_speed', 'overheat', 'elemental_shell', 'elemental_resonance'],
});

export const createSimulationPlayer = ({ classId = 'Archer', abilityIds, passiveIds, hp, equipment = {}, items = [] } = {}) => {
  const definition = getPlayableClassDefinition(classId);
  if (!definition) throw new Error(`Unknown combat simulation class: ${classId}`);
  const baseStats = createClassBaseStats(definition);
  const selectedAbilities = abilityIds || DEFAULT_LOADOUTS[classId] || definition.abilityNames;
  return {
    name: definition.displayName, class: classId, ...baseStats, hp: hp ?? baseStats.maxHp,
    baseStats, baseAtk: baseStats.attack, equipment, items,
    abilityNames: selectedAbilities,
    abilities: selectedAbilities.map(id => createAbilityByName(id, baseStats.attack)),
    equippedClassPassiveIds: passiveIds || DEFAULT_PASSIVES[classId] || [],
  };
};

const estimateDamage = (ability, player, target, session) => {
  if (typeof ability?.damage === 'number') return Math.max(0, ability.damage) * getClassDamageMultiplier(player);
  if (typeof ability?.damage !== 'function') return 0;
  try {
    return Math.max(0, Number(ability.damage({ attacker: player, target: { ...target }, targets: [{ ...target }], session })) || 0) * getClassDamageMultiplier(player);
  } catch (_) {
    return 0;
  }
};

export const getLegalCombatActions = session => {
  const player = session.state.players[0];
  const livingEnemies = session.state.enemies.filter(enemy => enemy?.hp > 0);
  const abilityActions = (player.abilities || []).filter(ability => !ability.passive && (ability.currentCooldown || 0) <= 0).flatMap(ability => {
    const targetType = ability.targeting || ability.target || ability.targetType || 'enemy';
    const targets = ['self', 'ally', 'allAllies'].includes(targetType) ? [player] : livingEnemies;
    const primary = targets[0] || null;
    if (typeof ability.canUse === 'function' && !ability.canUse({ attacker: player, target: primary, targets, session })) return [];
    if (!targets.length) return [];
    return targets.map(target => ({ kind: 'ability', ability, target, targetIndex: Math.max(0, session.state.enemies.indexOf(target)), expectedDamage: estimateDamage(ability, player, target, session) }));
  });
  // A stunned actor cannot drink a potion. Submit a normal action so the
  // production executor resolves the skipped turn and advances initiative.
  if (session.state.turnState?.itemUsed || player.stunned || session.state.turnState?.stunned) return abilityActions;
  const seen = new Set();
  const itemActions = (player.items || []).flatMap(item => {
    const name = typeof item === 'string' ? item : item?.name;
    if (!name || seen.has(name)) return [];
    seen.add(name);
    const definition = getItemDefinition(name);
    if (!definition || !['heal', 'effects', 'cleanse', 'cleanseGuard', 'ability', 'tacticalScroll', 'preparedTrap', 'primeNextDirectAttack', 'entanglementScroll'].includes(definition.type)) return [];
    if (definition.type === 'preparedTrap' && player.preparedTrap) return [];
    const targets = definition.target === 'allEnemies' ? [livingEnemies[0]] : definition.target === 'enemy' ? livingEnemies : [player];
    const itemAbility = definition.type === 'ability' ? createAbilityByName(definition.ability, player.attack) : null;
    return targets.filter(Boolean).filter(target => {
      if (definition.type !== 'tacticalScroll') return true;
      if (definition.control && isFieldControlImmune(target)) return false;
      if (definition.kind === 'shieldTheft' && !livingEnemies.some(enemy => (enemy.shield || 0) > 0)) return false;
      if (definition.kind === 'dispelAll' && !(target.effects || []).some(effect => getEffectDefinition(effect.id)?.type === 'buff' && !effect.unremovable && !getEffectDefinition(effect.id)?.unremovable && effect.removable !== false && effect.extra?.removable !== false && getEffectDefinition(effect.id)?.removable !== false)) return false;
      if (definition.shieldRemoval && !(target.shield > 0)) return false;
      if (definition.dispelCount && !(target.effects || []).some(effect => getEffectDefinition(effect.id)?.type === 'buff' && !effect.unremovable && !getEffectDefinition(effect.id)?.unremovable && effect.removable !== false && effect.extra?.removable !== false && getEffectDefinition(effect.id)?.removable !== false)) return false;
      return true;
    }).map(target => ({ kind: 'item', itemName: name, itemDefinition: definition, target, targetIndex: Math.max(0, session.state.enemies.indexOf(target)), expectedDamage: itemAbility ? estimateDamage(itemAbility, player, target, session) : 0 }));
  });
  return [...abilityActions, ...itemActions];
};

const lowestHpTarget = actions => [...actions].sort((a, b) => (a.target?.hp || Infinity) - (b.target?.hp || Infinity))[0];
const highestDamage = actions => [...actions].sort((a, b) => b.expectedDamage - a.expectedDamage || (a.target?.hp || Infinity) - (b.target?.hp || Infinity))[0];
const actionWithArt = (actions, artId) => actions.find(action => action.ability?.artId === artId);

export const SIMULATOR_ABILITY_EVALUATION = Object.freeze({
  frost_shield: Object.freeze({ role: 'defense', preventionScale: 0.8 }),
  blizzard: Object.freeze({ role: 'aoe-control', controlValue: 12 }),
  storm_discharge: Object.freeze({ role: 'damage-control', controlValue: 7, repeatPenalty: 0.35 }),
  elemental_echo: Object.freeze({ role: 'setup', setupValuePerAdditionalTarget: 18 }),
  endurance: Object.freeze({ role: 'defense', preventionScale: 0.65 }),
  redirect: Object.freeze({ role: 'defense', preventionScale: 0.45 }),
});

const incomingPressure = (session, player) => session.state.enemies.filter(enemy => enemy?.hp > 0)
  .reduce((sum, enemy) => sum + Math.max(0, enemy.attack || 0, enemy.magAtk || 0), 0) / Math.max(1, player?.maxHp || 1);

export const scoreCombatAbilityAction = (action, player, session, policy = 'competent') => {
  if (action?.kind !== 'ability') return -Infinity;
  const authoredGain = typeof action.ability?.turnMeterGain === 'function'
    ? action.ability.turnMeterGain({ attacker: player, target: action.target, session })
    : Number(action.ability?.turnMeterGain) || 0;
  const availableMeter = Math.max(0, 1000 - (player?.turnMeter || 0));
  const effectiveMeter = Math.min(availableMeter, Math.max(0, Number(authoredGain) || 0));
  const tempoValue = (player?.attack || player?.magAtk || 10) * effectiveMeter / 1000 * (policy === 'strategic' ? 1.25 : 1);
  return action.expectedDamage + tempoValue;
};

const highestAbilityUtility = (actions, player, session, policy) => [...actions].sort((a, b) => (
  scoreCombatAbilityAction(b, player, session, policy) - scoreCombatAbilityAction(a, player, session, policy)
  || (a.target?.hp || Infinity) - (b.target?.hp || Infinity)
))[0];

const hasNegativeEffect = player => (player.effects || []).some(effect => getEffectDefinition(effect?.id)?.type === 'debuff' || effect?.isDebuff);
const PERIODIC_IDS = new Set(['poison', 'bleed', 'burn', 'great_bonfire_flame', 'gloom', 'searing_mark', 'regeneration_damage']);
const SHIELD_PIERCING_DOT_IDS = new Set(['gloom', 'searing_mark']);
const effectDescriptors = effect => (Array.isArray(effect) ? effect : [effect]).filter(entry => entry && typeof entry !== 'function');
const visiblePoisonEvents = (effect, target, multiplier = 1) => {
  const attack = effect.sourceSnapshot?.attack || 0;
  const hp = target.maxHp || target.hp || 0;
  return [
    { raw: Math.max(1, Math.round(attack * 0.5 * multiplier)), type: 'physical' },
    { raw: Math.max(1, Math.round(hp * 0.02 * multiplier)), type: 'magical' },
  ];
};
// Forecast raw ticks so that Shield is spent before defense on each hit.
// Gloom and Searing Mark are the only DoTs that bypass Shield.
const visiblePeriodicEvents = (unit, multiplier = 1) => (unit.effects || []).flatMap(effect => {
  if (!PERIODIC_IDS.has(effect.id)) return [];
  if (effect.id === 'poison') return visiblePoisonEvents(effect, unit, multiplier);
  const hp = unit.maxHp || unit.hp || 0;
  const remaining = Math.max(1, effect.remainingTurns ?? effect.duration ?? 1);
  const attack = effect.sourceRef?.attack ?? effect.sourceSnapshot?.attack ?? 0;
  const magAtk = effect.sourceSnapshot?.magAtk ?? 0;
  let raw = effect.value ?? effect.damage;
  let type = effect.damageType === 'magical' ? 'magical' : 'physical';
  if (raw == null) {
    if (effect.id === 'bleed') raw = attack * (0.75 + 0.25 * remaining);
    else if (effect.id === 'burn') raw = (effect.sourceSnapshot?.scaling ?? magAtk) * 0.5 + hp * 0.03;
    else if (effect.id === 'great_bonfire_flame') raw = (effect.sourceRef?.magAtk ?? effect.extra?.lastKnownMagAtk ?? magAtk) * 0.5 * (1 + (effect.extra?.burnTicks || 0));
    else if (effect.id === 'gloom') raw = magAtk * (0.4 + 0.1 * (unit.effects || []).filter(entry => entry.id !== effect.id && getEffectDefinition(entry.id)?.type === 'debuff').length);
    else if (effect.id === 'searing_mark') raw = magAtk * (0.3 + 0.1 * (unit.effects || []).filter(entry => getEffectDefinition(entry.id)?.type === 'buff').length);
    else raw = attack || hp * 0.05;
  }
  if (['burn', 'great_bonfire_flame', 'gloom', 'searing_mark'].includes(effect.id)) type = 'magical';
  return [{ raw: Math.max(1, Math.round(raw * (effect.id === 'bleed' || effect.id === 'regeneration_damage' ? 1 : multiplier))), type, bypassShield: SHIELD_PIERCING_DOT_IDS.has(effect.id) }];
});
const directEvent = (raw, type, options = {}) => ({
  raw: Math.max(0, Number(raw) || 0),
  type: type || 'physical',
  ignoreDefenseFraction: Math.max(0, Number(options.ignoreDefenseFraction) || 0),
  shieldDamageMultiplier: Number.isFinite(Number(options.shieldDamageMultiplier))
    ? Math.max(0, Number(options.shieldDamageMultiplier))
    : 1,
});

const resolveVisibleDirectEvents = (events, target, startingShield = target?.shield || 0, weight = 1) => {
  let shield = Math.max(0, Number(startingShield) || 0);
  let hpDamage = 0;
  const safeWeight = Math.max(0, Math.min(1, Number(weight) || 0));

  (events || []).forEach(event => {
    const weightedRaw = Math.max(0, (Number(event?.raw) || 0) * safeWeight);
    if (weightedRaw <= 0) return;

    const type = event?.type || 'physical';
    const effectiveType = type === 'true' ? 'pure' : type;
    // Zeroing defense lets the existing visible-damage helper preserve current
    // non-defense incoming modifiers before Shield, matching applyDamage().
    const preDefenseTarget = {
      ...target,
      physDef: 0,
      magicDef: 0,
      immortal: false,
    };
    const incomingToShield = calculateVisibleDamage(weightedRaw, type, preDefenseTarget, {
      ignoreDefenseFraction: event?.ignoreDefenseFraction || 0,
    });
    const absorbed = Math.min(shield, incomingToShield);
    const multiplier = Number.isFinite(Number(event?.shieldDamageMultiplier))
      ? Math.max(0, Number(event.shieldDamageMultiplier))
      : 1;
    const requestedShieldDamage = multiplier >= 1
      ? Math.max(absorbed, Math.round(incomingToShield * multiplier))
      : Math.round(absorbed * multiplier);
    shield = Math.max(0, shield - Math.min(shield, Math.max(0, requestedShieldDamage)));

    const overflow = Math.max(0, incomingToShield - absorbed);
    if (overflow <= 0) return;
    let defense = effectiveType === 'magical'
      ? target?.magicDef || 0
      : effectiveType === 'pure'
      ? 0
      : target?.physDef || 0;
    const ignore = Math.max(0, Math.min(1, Number(event?.ignoreDefenseFraction) || 0));
    if (ignore > 0 && effectiveType !== 'pure') defense = Math.max(0, defense * (1 - ignore));
    const mitigation = effectiveType === 'pure' ? 0 : defense / (defense + 100);
    hpDamage += Math.max(0, Math.round(overflow * (1 - mitigation)));
  });

  if (target?.immortal) hpDamage = Math.min(hpDamage, Math.max(0, (target.hp || 0) - 1));
  return { hpDamage, shieldRemaining: shield };
};

const resolveVisibleThreat = ({ sources, target, mode = 'guaranteed', periodicDamage = 0, startingShield = target?.shield || 0 }) => {
  let shield = Math.max(0, Number(startingShield) || 0);
  let directHpDamage = 0;

  (sources || []).forEach(source => {
    if (source?.diesBeforeAction) return;
    const chance = mode === 'guaranteed'
      ? (source.hitChance === 1 ? 1 : 0)
      : mode === 'expected'
      ? source.hitChance
      : 1;
    const directResolved = resolveVisibleDirectEvents(source.directEvents || [], target, shield, chance);
    shield = directResolved.shieldRemaining;
    directHpDamage += directResolved.hpDamage;

    // Existing simulator semantics treat a telegraphed preparation that resolves
    // before the next player turn as guaranteed once it reaches this forecast.
    const preparationResolved = resolveVisibleDirectEvents(source.preparationEvents || [], target, shield, 1);
    shield = preparationResolved.shieldRemaining;
    directHpDamage += preparationResolved.hpDamage;
  });

  // Ordinary DoTs strike Shield at full incoming power, then defense mitigates
  // only any HP overflow. Gloom and Searing Mark use magical defense but skip Shield.
  let periodicHpDamage = typeof periodicDamage === 'number' ? Math.max(0, periodicDamage) : 0;
  for (const event of Array.isArray(periodicDamage) ? periodicDamage : []) {
    if (event.bypassShield) {
      periodicHpDamage += calculateVisibleDamage(event.raw, event.type, target);
    } else {
      const resolved = resolveVisibleDirectEvents([event], target, shield);
      shield = resolved.shieldRemaining;
      periodicHpDamage += resolved.hpDamage;
    }
  }
  return {
    totalHpDamage: directHpDamage + periodicHpDamage,
    directHpDamage,
    periodicHpDamage,
    shieldRemaining: shield,
  };
};

const forecastAbility = (ability, attacker, target, session) => {
  const hits = Math.max(1, ability?.hits || ability?.hitCount || 1);
  const raw = estimateDamage(ability, attacker, target, session);
  const primaryIgnore = ability?.ignoreDefenseFraction || ability?.physicalDefenseIgnored || 0;
  const directPerHit = calculateVisibleDamage(raw, ability?.type, target, { ignoreDefenseFraction: primaryIgnore });
  const secondary = ability?.secondary;
  const secondaryRaw = typeof secondary?.damage === 'function' ? Number(secondary.damage({ attacker, target, primary: target, targets: [target], session })) || 0 : Number(secondary?.damage) || 0;
  const secondaryIgnore = secondary?.ignoreDefenseFraction || 0;
  const secondaryDamage = calculateVisibleDamage(secondaryRaw, secondary?.type || ability?.type, target, { ignoreDefenseFraction: secondaryIgnore });
  const chance = raw > 0 ? getVisibleHitChance(attacker, target, ability) : 1;
  const directMaximum = directPerHit * hits + secondaryDamage;
  const guaranteedDirect = chance === 1 ? directMaximum : 0;
  const directEvents = [
    ...Array.from({ length: hits }, () => directEvent(raw, ability?.type, {
      ignoreDefenseFraction: primaryIgnore,
      shieldDamageMultiplier: ability?.shieldDamageMultiplier ?? 1,
    })),
    ...(secondaryRaw > 0 ? [directEvent(secondaryRaw, secondary?.type || ability?.type, {
      ignoreDefenseFraction: secondaryIgnore,
      shieldDamageMultiplier: secondary?.shieldDamageMultiplier ?? 1,
    })] : []),
  ];
  const guaranteedPoisons = effectDescriptors(ability?.effect).filter(effect => effect.id === 'poison' && (effect.chance == null || effect.chance >= 1)).length * hits;
  const possiblePoisons = effectDescriptors(ability?.effect).filter(effect => effect.id === 'poison').length * hits;
  return { ability, hitChance: chance, hits, directEvents, guaranteedDirect, expectedDirect: directMaximum * chance, maximumDirect: directMaximum, guaranteedPoisons, possiblePoisons };
};

const visibleTurnOrder = (session, player) => {
  const units = [player, ...(session?.state?.enemies || []).filter(enemy => enemy?.hp > 0 && !enemy.nonActingCombatObject)];
  const meters = new Map(units.map(unit => [unit, Number(unit.turnMeter) || 0]));
  const skips = new Map([[player, Math.max(0, Number(player.turnDelay) || 0) + (player.stunned || player.frozen || player.pendingShockSkip ? 1 : 0)]]);
  const actions = [];
  for (let guard = 0; guard < 10000; guard += 1) {
    let actor = units.find(unit => (meters.get(unit) || 0) >= 1000);
    if (!actor) {
      units.forEach(unit => meters.set(unit, (meters.get(unit) || 0) + Math.max(1, getEffectiveSpeed(unit, session))));
      actor = units.find(unit => (meters.get(unit) || 0) >= 1000);
      if (!actor) continue;
    }
    meters.set(actor, Math.max(0, (meters.get(actor) || 0) - 1000));
    if (actor === player) {
      if ((skips.get(player) || 0) > 0) { skips.set(player, skips.get(player) - 1); continue; }
      break;
    }
    actions.push(actor);
  }
  return actions;
};

// Pure visible-state forecast: no RNG, enemy AI, cooldown/effect mutation, or
// invented certainty. Unknown hit/effect outcomes remain a min/expected/max range.
export const estimateVisibleThreatBeforeNextTurn = (session, player = session?.state?.players?.[0]) => {
  const poisonMultiplier = Number(session?._simulationPoisonDamageMultiplier) || 1;
  const order = visibleTurnOrder(session, player);
  const occurrences = new Map();
  const sources = order.map(enemy => {
    const turn = (occurrences.get(enemy) || 0) + 1; occurrences.set(enemy, turn);
    const cooldownReady = ability => Math.max(0, (ability.currentCooldown || 0) - turn) <= 0;
    const abilities = (enemy.abilities || []).filter(ability => !ability.passive && cooldownReady(ability));
    const forecasts = abilities.map(ability => forecastAbility(ability, enemy, player, session));
    const chosen = forecasts.sort((a, b) => b.expectedDirect - a.expectedDirect)[0] || forecastAbility({ name: 'Атака', type: enemy.magAtk > enemy.attack ? 'magical' : 'physical', damage: Math.max(enemy.attack || 0, enemy.magAtk || 0), accuracy: 1 }, enemy, player, session);
    const preparation = turn === 1 ? enemy._preparation : null;
    const prepHits = Math.max(1, preparation?.hits || 1);
    const prepRaw = preparation ? (enemy.attack || 0) * (preparation.damageMultiplier || 0) : 0;
    const prepMaximum = preparation ? calculateVisibleDamage(prepRaw, preparation.type || 'physical', player) * prepHits : 0;
    const preparationEvents = preparation
      ? Array.from({ length: prepHits }, () => directEvent(prepRaw, preparation.type || 'physical'))
      : [];
    const enemyDot = resolveVisibleThreat({
      sources: [], target: enemy, periodicDamage: visiblePeriodicEvents(enemy, poisonMultiplier),
      startingShield: enemy.shield || 0,
    }).periodicHpDamage;
    const diesBeforeAction = enemyDot >= enemy.hp;
    return { enemy, occurrence: turn, ability: chosen.ability, hitChance: chosen.hitChance, hits: chosen.hits, directEvents: chosen.directEvents, preparationEvents, guaranteedDamage: diesBeforeAction ? 0 : chosen.guaranteedDirect + prepMaximum, expectedDamage: diesBeforeAction ? 0 : chosen.expectedDirect + prepMaximum, maximumDamage: diesBeforeAction ? 0 : chosen.maximumDirect + prepMaximum, guaranteedPoisons: diesBeforeAction ? 0 : chosen.guaranteedPoisons, possiblePoisons: diesBeforeAction ? 0 : chosen.possiblePoisons, preparation: preparation ? { kind: preparation.kind, name: preparation.resolveName || preparation.name, hits: prepHits, damage: prepMaximum } : null, telegraphed: Boolean(preparation), diesBeforeAction };
  });
  const existingPeriodic = visiblePeriodicEvents(player, poisonMultiplier);
  const newGuaranteedPoison = sources.flatMap(source => Array.from({ length: source.guaranteedPoisons },
    () => visiblePoisonEvents({ sourceSnapshot: { attack: source.enemy.attack || 0 } }, player, poisonMultiplier)).flat());
  const newMaximumPoison = sources.flatMap(source => Array.from({ length: source.possiblePoisons },
    () => visiblePoisonEvents({ sourceSnapshot: { attack: source.enemy.attack || 0 } }, player, poisonMultiplier)).flat());
  const guaranteedDirect = sources.reduce((sum, source) => sum + source.guaranteedDamage, 0);
  const shield = Math.max(0, player?.shield || 0);
  const guaranteedPeriodic = [...existingPeriodic, ...newGuaranteedPoison];
  const maximumPeriodic = [...existingPeriodic, ...newMaximumPoison];
  const guaranteedResolved = resolveVisibleThreat({ sources, target: player, mode: 'guaranteed', periodicDamage: guaranteedPeriodic, startingShield: shield });
  const expectedResolved = resolveVisibleThreat({ sources, target: player, mode: 'expected', periodicDamage: guaranteedPeriodic, startingShield: shield });
  const maximumResolved = resolveVisibleThreat({ sources, target: player, mode: 'maximum', periodicDamage: maximumPeriodic, startingShield: shield });
  const guaranteed = guaranteedResolved.totalHpDamage;
  const expected = expectedResolved.totalHpDamage;
  const maximum = maximumResolved.totalHpDamage;
  return { guaranteed, minimum: guaranteed, expected, maximum, total: guaranteed, direct: guaranteedDirect, periodic: guaranteedResolved.periodicHpDamage, periodicThreat: guaranteedPeriodic, shield, lethal: guaranteed >= (player?.hp || 0), credibleLethal: expected >= (player?.hp || 0), possibleLethal: maximum >= (player?.hp || 0), lethalProbability: guaranteed === maximum ? (guaranteed >= player.hp ? 1 : 0) : null, enemiesBeforeNextTurn: order.length, sources };
};

const chooseThreatResponse = (actions, player, session, policy) => {
  const threat = estimateVisibleThreatBeforeNextTurn(session, player);
  if (!threat.lethal) return null;
  const evaluate = action => {
    let hp = player.hp; let remaining = threat.guaranteed; let kind = 'risk-reduction'; let resourceCost = action.kind === 'item' ? 10 : 0;
    if (action.kind === 'item' && action.itemDefinition.type === 'heal') hp = Math.min(player.maxHp, hp + (action.itemDefinition.amount || Math.round(player.maxHp * (action.itemDefinition.percent || 0))));
    if (action.kind === 'item' && action.itemDefinition.type === 'cleanse') { remaining = Math.max(0, remaining - threat.periodic); kind = 'cleanse'; }
    const descriptors = action.kind === 'item' ? action.itemDefinition.effects || [] : effectDescriptors(action.ability?.effect);
    const shield = descriptors.filter(effect => effect.id === 'shield').reduce((sum, effect) => sum + Math.max(0, effect.value || Math.round(player.maxHp * (effect.percent || 0))), 0);
    if (shield > 0) {
      remaining = resolveVisibleThreat({
        sources: threat.sources,
        target: player,
        mode: 'guaranteed',
        periodicDamage: threat.periodicThreat,
        startingShield: Math.max(0, player.shield || 0) + shield,
      }).totalHpDamage;
    }
    const preparationSource = threat.sources.find(source => source.preparation && source.enemy === action.target);
    const hitChance = action.kind === 'ability' ? getVisibleHitChance(player, action.target, action.ability) : 1;
    const dealt = action.kind === 'ability' ? calculateVisibleDamage(action.expectedDamage, action.ability?.type, action.target, { ignoreDefenseFraction: action.ability?.ignoreDefenseFraction || 0 }) : 0;
    if (preparationSource && hitChance === 1 && dealt >= action.target._preparation.durability) { remaining = Math.max(0, remaining - preparationSource.preparation.damage); kind = 'interrupt'; }
    const source = threat.sources.find(entry => entry.enemy === action.target);
    if (source && hitChance === 1 && dealt >= action.target.hp + (action.target.shield || 0)) { remaining = Math.max(0, remaining - source.guaranteedDamage); kind = 'guaranteed-kill'; }
    if (descriptors.some(effect => ['phys_def_boost_minor', 'phys_def_boost_major', 'magic_def_boost_minor', 'magic_def_boost_major'].includes(effect.id))) {
      const copy = { ...player, physDef: player.physDef, magicDef: player.magicDef };
      descriptors.forEach(effect => { if (effect.id.includes('phys_def')) copy.physDef = Math.round(copy.physDef * (effect.id.includes('major') ? 1.5 : 1.25)); if (effect.id.includes('magic_def')) copy.magicDef = Math.round(copy.magicDef * (effect.id.includes('major') ? 1.5 : 1.25)); });
      const rescoredSources = threat.sources.map(entry => {
        const forecast = forecastAbility(entry.ability, entry.enemy, copy, session);
        return { ...entry, hitChance: forecast.hitChance, directEvents: forecast.directEvents };
      });
      const rescored = resolveVisibleThreat({
        sources: rescoredSources,
        target: copy,
        mode: 'guaranteed',
        periodicDamage: threat.periodicThreat,
        startingShield: player.shield || 0,
      }).totalHpDamage;
      remaining = Math.min(remaining, rescored); kind = 'defense';
    }
    return { action, predictedSurvival: hp > remaining, remaining, hp, kind, resourceCost };
  };
  const evaluated = actions.map(evaluate).filter(entry => entry.predictedSurvival).sort((a, b) => a.resourceCost - b.resourceCost || a.remaining - b.remaining || b.hp - a.hp);
  const best = evaluated[0];
  return best ? { ...best.action, reason: `${policy} threat-aware ${best.kind}; guaranteed ${threat.guaranteed}, residual ${best.remaining}`, threatResponse: { responseAvailable: true, forecastPredictedSurvival: true, kind: best.kind } } : null;
};
const chooseUsefulItem = (actions, player, policy, session) => {
  const items = actions.filter(action => action.kind === 'item');
  if (!items.length) return null;
  const hpRatio = player.maxHp ? player.hp / player.maxHp : 1;
  const missing = Math.max(0, (player.maxHp || 0) - player.hp);
  const cleanse = items.find(action => ['cleanse', 'cleanseGuard'].includes(action.itemDefinition.type));
  if (cleanse && hasNegativeEffect(player) && policy !== 'naive') return { ...cleanse, reason: 'removes a visible harmful status' };
  const heals = items.filter(action => action.itemDefinition.type === 'heal').map(action => ({ ...action, heal: action.itemDefinition.amount ?? Math.round(player.maxHp * (action.itemDefinition.percent || 0)) }));
  const threshold = policy === 'naive' ? 0.35 : policy === 'competent' ? 0.55 : 0.42;
  const useful = heals.filter(action => hpRatio <= threshold && missing >= Math.min(action.heal, player.maxHp * 0.2)).sort((a, b) => b.heal - a.heal)[0];
  if (useful) return { ...useful, reason: `${policy} survival threshold; ${missing} HP missing` };
  if (policy === 'naive') return null;
  const living = session.state.enemies.filter(enemy => enemy?.hp > 0);
  const incoming = living.reduce((sum, enemy) => sum + Math.max(enemy.attack || 0, enemy.magAtk || 0) * 0.55, 0);
  const score = action => {
    const def = action.itemDefinition;
    const effectIds = (def.effects || []).map(effect => effect.id);
    if (def.type === 'preparedTrap') {
      if (player.preparedTrap || !living.some(enemy => enemy.hp > 30)) return 0;
      const kind = def.kind;
      const stat = Math.max(0, player.attack || 0, player.magAtk || 0);
      if (kind === 'fire') return stat * (0.7 + 0.245 * Math.max(0, living.length - 1)) * 0.7 + 12;
      if (kind === 'burialSeal') return 30 + Math.max(0, ...living.map(enemy => Math.max(enemy.attack || 0, enemy.magAtk || 0))) * 0.55;
      if (kind === 'predatoryShoots') return stat * (0.5 + Math.min(1, Math.max(0, (def.turnMeterGain || 0) / 1000))) + 12 * living.length;
      if (kind === 'barbed' || kind === 'binding') return 30 + living.length * 12;
      return 22;
    }
    if (def.type === 'cleanseGuard') return hasNegativeEffect(player) ? 65 : 0;
    if (def.type === 'tacticalScroll') {
      const base = Math.max(0, Number(player.attack) || 0, Number(player.magAtk) || 0);
      if (def.kind === 'shieldTheft') return living.reduce((v, enemy) => v + Math.ceil((enemy.shield || 0) / 2), 0) * 1.5;
      if (def.kind === 'dispelAll') return 25 * (action.target.effects || []).filter(effect => getEffectDefinition(effect.id)?.type === 'buff').length;
      if (def.kind === 'vulnerabilityStrike') return base + 25;
      if (def.kind === 'fireball') return 1.2 * base * living.length;
      if (def.kind === 'poisonCloud') return living.reduce((v, enemy) => v + base * 0.5 + (enemy.maxHp || 0) * 0.05, 0);
      if (def.kind === 'iceCone') return base * (0.5 + 0.25 * Math.max(0, living.length - 1)) + living.reduce((v, enemy) => v + (enemy.turnMeter || 0) / 50, 0);
      if (def.kind === 'bloodTouch') return base * 1.5 + Math.max(0, (player.maxHp || 0) - (player.hp || 0)) * 0.25;
      if (def.kind === 'clingingRoots') return 18 * living.length;
      if (def.shieldRemoval) return Math.min(action.target.shield || 0, def.shieldRemoval) * 2;
      if (def.dispelCount) return 45;
      if (def.control) return action.target.turnMeter >= 500 ? 40 : 0;
      return 0;
    }
    if (def.type === 'entanglementScroll') return (action.target.turnMeter || 0) >= 500 ? 35 : 0;
    if (def.type === 'primeNextDirectAttack') return !player.effects.some(effect => effect.id === 'prepared_weapon') ? 30 : 0;
    if (def.type === 'ability' && def.ability === 'Ядовитое облако') return living.filter(enemy => !enemy.effects?.some(effect => effect.id === 'poison')).length >= 2 ? 40 : 0;
    if (def.type === 'ability' && def.ability === 'Кровавое касание') return !action.target.effects?.some(effect => effect.id === 'bleed') && action.target.hp > 25 ? 35 : 0;
    if (def.type === 'effects' && effectIds.every(id => player.effects.some(effect => effect.id === id))) return 0;
    if (def.type === 'ability') return action.expectedDamage >= (action.target?.hp || Infinity) ? 1000 : action.expectedDamage * (living.length > 1 ? 1.25 : 1);
    if (effectIds.includes('shield')) return incoming >= player.hp * 0.45 ? 90 : policy === 'competent' && living.length > 1 ? 30 : 0;
    if (effectIds.includes('regeneration')) return missing >= player.maxHp * 0.3 && incoming < player.hp * 0.55 ? 55 : 0;
    if (effectIds.includes('magic_attack_boost_minor')) return ['Mage', 'Elementalist'].includes(player.class) && living.length > 1 ? 35 : 0;
    if (effectIds.includes('attack_boost_minor')) return !['Mage', 'Elementalist'].includes(player.class) && living.length > 1 ? 35 : 0;
    if (effectIds.includes('speed_boost_minor')) return living.length > 1 ? 28 : 0;
    if (effectIds.includes('magic_def_boost_minor')) {
      const magicThreat = living.reduce((sum, enemy) => sum + (enemy.magAtk || 0), 0);
      const physicalThreat = living.reduce((sum, enemy) => sum + (enemy.attack || 0), 0);
      return magicThreat > physicalThreat ? 45 : 0;
    }
    if (effectIds.includes('phys_def_boost_minor')) return incoming >= player.hp * 0.35 ? 40 : 0;
    return 0;
  };
  const ranked = items.map(action => ({ action, score: score(action) })).sort((a, b) => b.score - a.score);
  return ranked[0]?.score > (policy === 'strategic' ? 25 : 15) ? { ...ranked[0].action, reason: `${policy} visible-state utility score ${ranked[0].score}` } : null;
};

const scoreElementalistAction = (action, player, session, policy) => {
  if (action.kind !== 'ability') return -Infinity;
  const living = session.state.enemies.filter(enemy => enemy?.hp > 0);
  let score = action.expectedDamage;
  if (action.expectedDamage >= (action.target?.hp || Infinity)) score += 10000;
  if (action.ability.targeting === 'allEnemies') score += action.expectedDamage * Math.max(0, living.length - 1);
  // Secondary AoE (notably Chain Lightning) is authored separately from the
  // primary hit. Keep expectedDamage target-local for kill/interrupt checks.
  if (action.ability.secondary?.target === 'otherEnemies' && !action.ability.secondary.condition) {
    score += living.filter(enemy => enemy !== action.target).reduce((total, enemy) =>
      total + Math.min(enemy.hp, estimateDamage(action.ability.secondary, player, enemy, session)), 0);
  }
  const school = getElementalChargeSchool(action.ability, player);
  const statusBySchool = { fire: 'burn', ice: 'freeze', lightning: 'shock' };
  const chargeReady = player.effects?.some(effect => effect.id === ELEMENTAL_CHARGE_IDS[school]);
  if (chargeReady) {
    if (school === 'fire') score += living.reduce((sum, enemy) => sum + Math.min(enemy.hp, (player.magAtk || 0) * 0.75), 0);
    if (school === 'ice') score += Math.min(player.maxHp * 0.2, incomingPressure(session, player) * player.maxHp);
    if (school === 'lightning') score += action.expectedDamage * 0.3;
  }
  if (school === 'lightning' && !action.target?.effects?.some(effect => effect.id === 'shock')) score += policy === 'strategic' ? 8 : 3;
  const evaluation = SIMULATOR_ABILITY_EVALUATION[action.ability.artId] || {};
  if (policy === 'strategic' && evaluation.controlValue && school && action.target?.effects?.some(effect => effect.id === statusBySchool[school])) score -= evaluation.controlValue;
  if (policy === 'strategic' && evaluation.repeatPenalty && player._lastSimulationAbilityId === action.ability.artId) score -= Math.max(6, action.expectedDamage * evaluation.repeatPenalty);
  if (evaluation.preventionScale) {
    const pressureValue = incomingPressure(session, player) * (player.maxHp || 1) * evaluation.preventionScale;
    // A shield has utility for competent play too, but cannot prevent more
    // direct damage than its additional capacity. Retaliation is not guaranteed.
    const preventionValue = action.ability.artId === 'frost_shield'
      ? Math.min(pressureValue, Math.max(0, 25 + (player.magAtk ?? player.attack ?? 0) - (player.shield || 0)))
      : policy === 'strategic' ? pressureValue : 0;
    score += preventionValue;
  }
  if (policy === 'strategic' && evaluation.setupValuePerAdditionalTarget) score += evaluation.setupValuePerAdditionalTarget * Math.max(0, living.length - 1);
  if (action.ability.artId === 'elemental' && living.length > 1 && !session.state.players.some(unit => unit?.summoned)) score += policy === 'strategic' ? 120 : 100;
  return score;
};

const scoreDecisionAction = (action, player, session, policy) => {
  if (action.kind === 'item') {
    const missing = Math.max(0, player.maxHp - player.hp);
    if (action.itemDefinition.type === 'heal') return Math.min(missing, action.itemDefinition.amount || 0) * 2;
    return 0;
  }
  if (player.class === 'Mage') return scoreElementalistAction(action, player, session, policy);
  const evaluation = SIMULATOR_ABILITY_EVALUATION[action.ability?.artId] || {};
  return scoreCombatAbilityAction(action, player, session, policy) + (evaluation.preventionScale ? incomingPressure(session, player) * player.maxHp * evaluation.preventionScale : 0);
};

export const scoreBossAwareAction = (action, player, session) => {
  let score = scoreDecisionAction(action, player, session, 'strategic');
  if (action.kind !== 'ability') return score;
  const living = session.state.enemies.filter(enemy => enemy?.hp > 0);
  const boss = living.find(enemy => getVisibleBossMechanic(enemy));
  if (!boss) return score;
  const mechanic = getVisibleBossMechanic(boss);
  const effects = Array.isArray(action.ability?.effect) ? action.ability.effect : [action.ability?.effect].filter(Boolean);
  const isControl = effects.some(effect => ['freeze', 'shock', 'stun'].includes(effect?.id));
  if (action.target === boss && mechanic.controlImmune && isControl) score -= 80;
  if (boss._preparation?.durability > 0 && action.target === boss) {
    score += Math.min(action.expectedDamage, boss._preparation.durability) * 4;
    if (action.expectedDamage >= boss._preparation.durability) score += 500;
  }
  const add = living.find(enemy => enemy !== boss && !enemy.nonActingCombatObject);
  if (add && action.target === add) score += action.expectedDamage >= add.hp ? 250 : Math.max(add.attack || 0, add.magAtk || 0) * 2;
  if (boss.name === 'Троглодит-мицелий (босс)' && player.effects?.some(effect => effect.id === 'poison') && SIMULATOR_ABILITY_EVALUATION[action.ability?.artId]?.preventionScale) score += player.maxHp * 0.35;
  return score;
};

const snapshotDecision = (actions, decision, player, session, policy) => {
  const scored = actions.map(action => ({ action, score: scoreDecisionAction(action, player, session, policy) }));
  const chosenScore = scored.find(entry => entry.action === decision)?.score;
  const effects = unit => (unit?.effects || []).map(effect => ({ id: effect.id, duration: effect.duration, stacks: effect.stacks, value: effect.value }));
  return ({
  player: { hp: player.hp, maxHp: player.maxHp, shield: player.shield || 0, effects: effects(player) },
  enemies: session.state.enemies.filter(Boolean).map(enemy => ({ name: enemy.name, hp: enemy.hp, maxHp: enemy.maxHp, effects: effects(enemy) })),
  abilities: (player.abilities || []).map(ability => ({ id: ability.artId || ability.presetKey || ability.name, cooldown: ability.currentCooldown || 0 })),
  items: (player.items || []).map(item => item.name),
  legalActions: scored.map(({ action, score }) => ({ kind: action.kind, id: action.kind === 'item' ? action.itemName : action.ability?.artId || action.ability?.presetKey || action.ability?.name, target: action.target?.name || 'self', expectedDamage: action.expectedDamage || 0, score, selected: action === decision, rejectionReason: action === decision ? null : action.kind === 'item' && action.itemDefinition.type === 'heal' ? 'healing was legal but policy priority/threshold selected another action' : score < chosenScore ? `score ${score.toFixed(2)} below chosen ${chosenScore.toFixed(2)}` : 'policy-specific ordering or setup rule' })),
  chosen: decision?.kind === 'item' ? `item:${decision.itemName}` : decision?.ability?.artId || decision?.ability?.presetKey || decision?.ability?.name,
  });
};

// Experimental battle-lab-only policy; game player controls are unchanged.
const chooseRuinsPriorityAction = (actions, player, session) => {
  const weights = {
    'Заклинатель двух душ': 1.5, 'Всадник последнего похода': 1.4,
    'Глашатай мёртвого марша': 1.4, 'Сшиватель душ': 1.5,
    'Знаменосец павшей когорты': 1.45, 'Сдвоенный бастион': 1.2,
    'Двутелый дуэлянт': 1.3,
  };
  const scored = actions.filter(action => action.kind === 'ability' &&
    action.expectedDamage > 0 && action.target?.hp > 0 && !action.target?.ruinsBanner)
    .map(action => {
      const score = player.class === 'Mage'
        ? scoreElementalistAction(action, player, session, 'competent')
        : scoreCombatAbilityAction(action, player, session, 'competent');
      const unkillable = (action.target.effects || []).some(e=>e.id==='immortality'||e.id==='rebirth');
      const focus = (weights[action.target.name] || 1)*Math.min(120, action.expectedDamage)*0.65;
      const finishing = action.expectedDamage >= action.target.hp+(action.target.shield||0) && !unkillable ? 100:0;
      return { action, score: score+focus+finishing-(unkillable?45:0) };
    }).sort((a,b)=>b.score-a.score);
  return scored.length ? {...scored[0].action, reason:'experimental ruins support-priority'} : null;
};

const chooseCombatActionFromActions = ({ policy, session, rng, actions, threatChecked = false }) => {
  if (!actions.length) return null;
  if (policy === 'random') return actions[Math.min(actions.length - 1, Math.floor(rng() * actions.length))];
  const abilityActions = actions.filter(action => action.kind === 'ability');
  const damaging = abilityActions.filter(action => action.expectedDamage > 0);
  if (policy === 'naive') return highestDamage(damaging.length ? damaging : actions);

  const player = session.state.players[0];
  const threatResponse = threatChecked ? null : chooseThreatResponse(actions, player, session, policy);
  if (threatResponse) return threatResponse;
  if (policy === 'boss_aware' && !session.state.enemies.some(enemy => getVisibleBossMechanic(enemy))) return chooseCombatActionFromActions({ policy: 'strategic', session, rng, actions, threatChecked: true });
  if (policy === 'boss_aware' && session.state.enemies.some(enemy => getVisibleBossMechanic(enemy))) {
    const usefulItem = chooseUsefulItem(actions, player, 'strategic', session);
    const boss = session.state.enemies.find(enemy => getVisibleBossMechanic(enemy));
    if (usefulItem && (player.hp / player.maxHp <= 0.5 || incomingPressure(session, player) >= 0.5 || boss?._preparation)) return usefulItem;
    const hasAdds = session.state.enemies.some(enemy => enemy?.hp > 0 && enemy !== boss && !enemy.nonActingCombatObject);
    const canBreakPreparationNow = boss?._preparation?.durability > 0 && abilityActions.some(action => action.target === boss && action.expectedDamage >= boss._preparation.durability);
    if (canBreakPreparationNow || hasAdds) return [...abilityActions].sort((a, b) => scoreBossAwareAction(b, player, session) - scoreBossAwareAction(a, player, session))[0];
    return chooseCombatActionFromActions({ policy: 'strategic', session, rng, actions, threatChecked: true });
  }
  const snare = session.state.enemies.find(enemy => enemy?.nonActingCombatObject && enemy.hp > 0);
  if (snare) {
    const basic = abilityActions.find(action => action.ability?.basic && action.target === snare);
    if (basic) return { ...basic, reason: `${policy} safely disarms enemy combat object` };
  }
  const usefulItem = chooseUsefulItem(actions, player, policy, session);
  if (usefulItem) return usefulItem;
  const hpRatio = player.maxHp ? player.hp / player.maxHp : 0;
  if (policy === 'ruins_priority' && session.location === 'Руины Неупокоенных') {
    if (player.class === 'Archer' && hpRatio < 0.28) {
      const redirect = !player._redirectPrepared && actionWithArt(actions, 'redirect');
      if (redirect) return redirect;
    }
    const focus = chooseRuinsPriorityAction(abilityActions, player, session);
    if (focus) return focus;
  }
  if (player.class === 'Archer') {
    const trap = !player._armedTrap && actionWithArt(actions, 'snake_trap');
    if (trap) return trap;
    const redirect = !player._redirectPrepared && actionWithArt(actions, 'redirect');
    if (redirect && (policy === 'strategic' || hpRatio < 0.65)) return redirect;
  }
  if (player.class === 'Mage') {
    return [...abilityActions].sort((a, b) => scoreElementalistAction(b, player, session, policy) - scoreElementalistAction(a, player, session, policy))[0];
  }
  if (player.class === 'Defender' && hpRatio < (policy === 'strategic' ? 0.55 : 0.35)) {
    const defensive = abilityActions.find(action => action.ability.type === 'support' || action.ability.targeting === 'self');
    if (defensive) return defensive;
  }
  if (policy === 'strategic') {
    const lethal = damaging.filter(action => action.expectedDamage >= (action.target?.hp || Infinity));
    if (lethal.length) return lowestHpTarget(lethal);
    const aoe = damaging.filter(action => action.ability.targeting === 'allEnemies');
    if (session.state.enemies.filter(enemy => enemy?.hp > 0).length > 1 && aoe.length) return highestDamage(aoe);
  }
  return highestAbilityUtility(damaging.length ? damaging : abilityActions, player, session, policy) || highestDamage(actions);
};

// Boss-aware fallback reuses the same legal actions and threat forecast. It
// previously rebuilt both for every player turn, including ordinary fights.
export const chooseCombatAction = ({ policy = 'naive', session, rng }) =>
  chooseCombatActionFromActions({ policy, session, rng, actions: getLegalCombatActions(session) });

const countMatches = (lines, pattern) => lines.reduce((count, line) => count + (pattern.test(line) ? 1 : 0), 0);

const simulateCombatCore = ({ player: playerInput, classId = 'Archer', profile = 'fresh', build = 'default', relicLevel, activeIds, passiveIds, consumables, enemies: enemyInput, enemyNames, location = 'fungal', seed = 1, policy = 'naive', balanceVariant = 'production_baseline', maxActions = DEFAULT_COMBAT_ACTION_GUARD, verbose = false, debugDecisions = false, captureRecording = false, simulationRng, startingEnemyEffects = [], startingPlayerEffects = [] } = {}) => {
  if (!COMBAT_POLICY_IDS.includes(policy)) throw new Error(`Unknown combat policy: ${policy}`);
  const rng = simulationRng || createSeededRng(seed);
  const resolvedProfile = playerInput ? { player: playerInput, snapshot: snapshotSimulationPlayer(playerInput, { profileId: 'explicit', buildId: build }) } : resolveSimulationPlayerProfile({ profile, classId, build, relicLevel, activeIds, passiveIds, consumables });
  const player = resolvedProfile.player;
  // Standalone floor-II batches have no expedition player snapshot. Set the
  // actual biome/floor so its location mechanics match the production engine.
  // Explicit replay/player states keep their own location and progression.
  if (!playerInput) {
    const floorTwo = LEVEL_TWO_LOCATIONS.find(entry => entry.id === location || entry.name === location);
    if (floorTwo) {
      player.currentLocation = floorTwo.name;
      player.abyssLevel = 2;
    }
  }
  const foes = enemyInput || (enemyNames || []).map((name, index) => createEnemyInstanceByName(name, { rng, idPrefix: `simulation-${index}` })).filter(Boolean);
  if (!foes.length) throw new Error('Combat simulation requires at least one enemy');
  const session = initCombatSession(player, foes, { rng });
  // Simulator-only fixtures. Production hydration intentionally starts enemies
  // without arbitrary runtime statuses, so tests add setup effects *after* it.
  startingEnemyEffects.forEach((effects, index) => {
    const enemy = session.state.enemies[index];
    if (!enemy || !Array.isArray(effects)) return;
    effects.forEach(effect => addEffect(enemy, { ...effect }, () => {}, enemy, { session }));
  });
  if (Array.isArray(startingPlayerEffects)) {
    startingPlayerEffects.forEach(effect => addEffect(
      session.state.players[0], { ...effect }, () => {},
      session.state.enemies[0] || session.state.players[0], { session },
    ));
  }
  if (captureRecording && (balanceVariant !== 'production_baseline' || foes.some(enemy => enemy?._simulationBalanceVariant && enemy._simulationBalanceVariant !== 'production_baseline'))) {
    throw new Error('Combat recording currently supports production_baseline only');
  }
  const recording = captureRecording ? createCombatRecording(session) : null;
  const startingEnemyHp = session.state.enemies.reduce((sum, enemy) => sum + Math.max(0, enemy.hp), 0);
  let actions = 0; let playerTurns = 0; let enemyTurns = 0; let abnormal = false;
  let damageReceived = 0; let healingReceived = 0; let shieldsGenerated = 0;
  let enemyHealing = 0; let phaseTwoStartedAtAction = null;
  const abilityUsage = {}; const consumableUsage = {}; const trace = []; const decisionIds = []; const decisionDiagnostics = [];
  let lastPlayerTurnHealing = { physicallyRemaining: false, available: false, chosen: false };
  let lastPlayerDecision = null; let lethalWindow = null;
  let maxBossDirectActionDamage = 0; let maxEnemySequenceDamage = 0;
  const policyDiagnostics = { quickIntercept: { legalOpportunities: 0, selected: 0, scoreTotal: 0, turnMeterUtilityTotal: 0, gain250Opportunities: 0, gain400Opportunities: 0, beatenBy: {}, finishingShotQualifyingUses: 0, finishingShotKills: 0, finishingShotOverkillTransfers: 0 } };
  const bossMechanicResponses = { visiblePreparationTurns: 0, attacksIntoPreparation: 0, thresholdBreakingAttacks: 0, controlIntoImmuneBoss: 0, addTargetsSelected: 0, bladeDancesSurvived: 0 };
  let itemHealing = 0; let itemOverheal = 0;

  while (actions < maxActions) {
    const outcome = checkBattleOutcome(session);
    if (outcome.victory || outcome.defeat) break;
    if (!session.state.initiative?.playerReady) {
      const hpBefore = session.state.players[0].hp; const shieldBefore = session.state.players[0].shield || 0;
      const sequenceLogStart = session.state.log.length;
      const enemyHpBefore = session.state.enemies.reduce((sum, enemy) => sum + Math.max(0, enemy?.hp || 0), 0);
      const activePreparation = session.state.enemies.find(enemy => enemy?._preparation);
      const preparingBladeDance = activePreparation?._preparation?.kind === 'blade_dance';
      const bladeVariant = session.state.enemies.find(enemy => enemy?._simulationBalanceVariant)?._simulationBalanceVariant || balanceVariant;
      const originalPhysDef = session.state.players[0].physDef;
      const armorPierce = getSimulationOverride(bladeVariant, 'boss.bladeDance.physicalDefenseIgnored', 0);
      if (preparingBladeDance && armorPierce > 0) session.state.players[0].physDef *= 1 - armorPierce;
      const result = executeCombatCommand(session, { kind: 'advance' }, recording);
      maxEnemySequenceDamage = Math.max(maxEnemySequenceDamage, Math.max(0, hpBefore - (session.state.players[0]?.hp || 0)));
      for (const report of result.turnReports || []) {
        maxBossDirectActionDamage = Math.max(maxBossDirectActionDamage, report.directDamage || 0);
      }
      const ragshnar = session.state.enemies.find(enemy => enemy?.name === 'Пепельный Колпак Рагшнар');
      if (ragshnar) {
        const metrics = (session.state.metrics ||= {});
        if ((ragshnar.effects || []).some(effect => effect.id === 'attack_boost_minor')) { metrics.infernoAttackUptimeTurns = (metrics.infernoAttackUptimeTurns || 0) + 1; metrics.infernoAttackActiveStatTotal = (metrics.infernoAttackActiveStatTotal || 0) + ragshnar.attack; }
        if ((ragshnar.effects || []).some(effect => effect.id === 'speed_boost_major')) { metrics.infernoSpeedUptimeTurns = (metrics.infernoSpeedUptimeTurns || 0) + 1; metrics.infernoSpeedActiveStatTotal = (metrics.infernoSpeedActiveStatTotal || 0) + ragshnar.speed; }
      }
      const enemyHpAfter = session.state.enemies.reduce((sum, enemy) => sum + Math.max(0, enemy?.hp || 0), 0);
      enemyHealing += Math.max(0, enemyHpAfter - enemyHpBefore);
      if (phaseTwoStartedAtAction == null && session.state.enemies.some(enemy => enemy?._myceliumPhaseTwoTriggered)) phaseTwoStartedAtAction = actions;
      if (preparingBladeDance && armorPierce > 0) session.state.players[0].physDef = originalPhysDef;
      const defenseDown = getSimulationOverride(bladeVariant, 'boss.bladeDance.onUninterruptedResolve', null);
      const bladeDanceResolved = preparingBladeDance && !session.state.enemies.some(enemy => enemy?._preparation?.kind === 'blade_dance');
      if (bladeDanceResolved && defenseDown && session.state.players[0].hp > 0) addEffect(session.state.players[0], { id: defenseDown.effectId, duration: defenseDown.duration }, undefined, session.state.enemies.find(enemy => enemy?._simulationBalanceVariant), { session });
      if (bladeDanceResolved && session.state.players[0].hp > 0) bossMechanicResponses.bladeDancesSurvived += 1;
      const hpAfter = session.state.players[0].hp; const shieldAfter = session.state.players[0].shield || 0;
      if (hpAfter < hpBefore) damageReceived += hpBefore - hpAfter; else healingReceived += hpAfter - hpBefore;
      if (shieldAfter > shieldBefore) shieldsGenerated += shieldAfter - shieldBefore;
      const resolved = result.turnReports?.length || 0;
      if (session.state.players[0].hp <= 0) {
        const startRatio = session.state.players[0].maxHp ? hpBefore / session.state.players[0].maxHp : 0;
        const lines = session.state.log.slice(sequenceLogStart);
        lethalWindow = {
          startingHp: hpBefore, startingHpRatio: startRatio, hpBucket: startRatio >= .85 ? '85–100%' : startRatio >= .70 ? '70–84%' : startRatio >= .55 ? '55–69%' : '<55%',
          atLeast55Percent: startRatio >= .55, enemiesActed: resolved, composition: session.state.enemies.map(enemy => enemy.name).join(' + '),
          source: result.turnReports?.at(-1)?.enemyName || result.turnReports?.at(-1)?.actorName || null,
          sourceId: result.turnReports?.at(-1)?.enemyId || result.turnReports?.at(-1)?.actorId || null,
          ability: result.turnReports?.at(-1)?.abilityName || null,
          abilityId: result.turnReports?.at(-1)?.abilityId || null,
          actions: result.turnReports?.length || 0,
          hits: result.turnReports?.reduce((sum, report) => sum + (report.directHits || 0), 0) || 0,
          directDamage: result.turnReports?.reduce((sum, report) => sum + (report.directDamage || 0), 0) || 0,
          periodicDamage: result.turnReports?.reduce((sum, report) => sum + (report.periodicDamage || 0), 0) || 0,
          damagePattern: lines.some(line => /яд|отрав|горен|кровотеч/i.test(line)) ? (lines.length > 1 ? 'sequence-with-DoT' : 'DoT') : resolved > 1 ? 'enemy-sequence' : lines.filter(line => /урон|атак/i.test(line)).length > 1 ? 'multihit' : 'direct',
          telegraphedPreparation: Boolean(result.turnReports?.some(report => report.preparationResolution)),
          previousDecision: lastPlayerDecision,
          responseAvailable: Boolean(lastPlayerDecision?.responseAvailable),
          forecastPredictedSurvival: Boolean(lastPlayerDecision?.forecastPredictedSurvival),
          responseChosen: lastPlayerDecision?.chosen || null,
          defensiveOptions: lastPlayerDecision?.defensiveOptions || [],
          threatForecast: lastPlayerDecision?.visibleThreat || null,
          actualOutcome: 'death',
          causallyVerifiedPreventable: null,
          diagnosticClassification: lastPlayerDecision?.forecastPredictedSurvival ? 'forecast-response-failed' : lastPlayerDecision?.responseAvailable ? 'response-available-not-proven' : 'no-surviving-response-forecast',
        };
      }
      enemyTurns += resolved; actions += resolved;
      continue;
    }
    const legalActions = getLegalCombatActions(session);
    const quickActions = legalActions.filter(action => action.ability?.artId === 'quick_intercept');
    const quickBest = quickActions.length ? highestAbilityUtility(quickActions, session.state.players[0], session, policy) : null;
    if (quickBest) {
      const authoredGain = quickBest.ability.turnMeterGain?.({ attacker: session.state.players[0], target: quickBest.target, session }) || 0;
      policyDiagnostics.quickIntercept.legalOpportunities += 1;
      policyDiagnostics.quickIntercept.scoreTotal += scoreCombatAbilityAction(quickBest, session.state.players[0], session, policy);
      policyDiagnostics.quickIntercept.turnMeterUtilityTotal += Math.min(1000 - (session.state.players[0].turnMeter || 0), authoredGain);
      if (authoredGain === 250) policyDiagnostics.quickIntercept.gain250Opportunities += 1;
      if (authoredGain === 400) policyDiagnostics.quickIntercept.gain400Opportunities += 1;
    }
    const decision = chooseCombatAction({ policy, session, rng });
    if (!decision) { abnormal = true; break; }
    const threatAtDecision = estimateVisibleThreatBeforeNextTurn(session, session.state.players[0]);
    lastPlayerDecision = {
      chosen: decision.kind === 'item' ? `item:${decision.itemName}` : decision.ability?.artId || decision.ability?.name,
      reason: decision.reason || null,
      visibleThreat: { total: threatAtDecision.total, periodic: threatAtDecision.periodic, enemiesBeforeNextTurn: threatAtDecision.enemiesBeforeNextTurn },
      responseAvailable: Boolean(decision.threatResponse?.responseAvailable),
      forecastPredictedSurvival: Boolean(decision.threatResponse?.forecastPredictedSurvival),
      defensiveOptions: legalActions.filter(action => action.kind === 'item' ? ['heal', 'cleanse'].includes(action.itemDefinition.type) || (action.itemDefinition.effects || []).some(effect => ['shield', 'defense_up', 'magic_defense_up'].includes(effect.id)) : SIMULATOR_ABILITY_EVALUATION[action.ability?.artId]?.role === 'defense' || action.expectedDamage >= (action.target?.hp || Infinity)).map(action => action.kind === 'item' ? action.itemName : action.ability?.artId || action.ability?.name),
    };
    const visibleBoss = session.state.enemies.find(enemy => enemy?.hp > 0 && getVisibleBossMechanic(enemy));
    if (visibleBoss?._preparation?.durability > 0) {
      bossMechanicResponses.visiblePreparationTurns += 1;
      if (decision.target === visibleBoss && decision.kind === 'ability') {
        bossMechanicResponses.attacksIntoPreparation += 1;
        if (decision.expectedDamage >= visibleBoss._preparation.durability) bossMechanicResponses.thresholdBreakingAttacks += 1;
      }
    }
    if (visibleBoss && decision.target !== visibleBoss && decision.target?.hp > 0 && !decision.target?.nonActingCombatObject) bossMechanicResponses.addTargetsSelected += 1;
    if (visibleBoss && decision.target === visibleBoss && decision.kind === 'ability') {
      const effects = Array.isArray(decision.ability?.effect) ? decision.ability.effect : [decision.ability?.effect].filter(Boolean);
      if (getVisibleBossMechanic(visibleBoss).controlImmune && effects.some(effect => ['freeze', 'shock', 'stun'].includes(effect?.id))) bossMechanicResponses.controlIntoImmuneBoss += 1;
    }
    const healingActions = legalActions.filter(action => action.kind === 'item' && action.itemDefinition.type === 'heal');
    lastPlayerTurnHealing = { physicallyRemaining: (session.state.players[0].items || []).some(item => getItemDefinition(item.name)?.type === 'heal'), available: healingActions.length > 0, chosen: decision.kind === 'item' && decision.itemDefinition.type === 'heal' };
    if (debugDecisions) decisionDiagnostics.push({ turn: playerTurns + 1, ...snapshotDecision(legalActions, decision, session.state.players[0], session, policy) });
    const decisionId = decision.ability?.artId || decision.ability?.presetKey || decision.ability?.name;
    if (quickBest) {
      if (decisionId === 'quick_intercept') policyDiagnostics.quickIntercept.selected += 1;
      else policyDiagnostics.quickIntercept.beatenBy[decisionId || `item:${decision.itemName}`] = (policyDiagnostics.quickIntercept.beatenBy[decisionId || `item:${decision.itemName}`] || 0) + 1;
    }
    decisionIds.push(decision.kind === 'item' ? `item:${decision.itemName}` : decision.ability?.artId || decision.ability?.presetKey || decision.ability?.name);
    const beforeLog = session.state.log.length;
    const targetHpBefore = decision.target?.hp;
    const finishingQualifies = decisionId === 'finishing_shot' && decision.target?.maxHp > 0 && targetHpBefore / decision.target.maxHp <= 0.5;
    const hpBefore = session.state.players[0].hp; const shieldBefore = session.state.players[0].shield || 0;
    const quantityBefore = decision.kind === 'item' ? session.state.players[0].items.filter(item => item.name === decision.itemName).length : null;
    const missingBefore = Math.max(0, session.state.players[0].maxHp - hpBefore);
    const result = executeCombatCommand(session, { kind: decision.kind, name: decision.kind === 'item' ? decision.itemName : decision.ability.name, targetIndex: decision.targetIndex }, recording);
    const hpAfter = session.state.players[0].hp; const shieldAfter = session.state.players[0].shield || 0;
    if (hpAfter < hpBefore) damageReceived += hpBefore - hpAfter; else healingReceived += hpAfter - hpBefore;
    if (shieldAfter > shieldBefore) shieldsGenerated += shieldAfter - shieldBefore;
    if (decision.kind === 'item') {
      if (!result.itemUsed) {
        if (result.turnConsumed) { actions += 1; playerTurns += 1; continue; }
        abnormal = true; break;
      }
      if (result.turnConsumed) { actions += 1; playerTurns += 1; }
      // Deployment is an action; actual trap consumption is counted by fieldTrapUsage.
      if (decision.itemDefinition.type !== 'preparedTrap') consumableUsage[decision.itemName] = (consumableUsage[decision.itemName] || 0) + 1;
      const restored = Math.max(0, hpAfter - hpBefore); itemHealing += restored;
      itemOverheal += Math.max(0, (decision.itemDefinition.amount || 0) - Math.min(missingBefore, decision.itemDefinition.amount || 0));
      if (verbose) trace.push({ turn: playerTurns + 1, kind: 'item', itemId: decision.itemName, reason: decision.reason, quantityBefore, quantityAfter: session.state.players[0].items.filter(item => item.name === decision.itemName).length, resolvedHp: restored, lines: session.state.log.slice(beforeLog) });
      continue;
    }
    if (!result.turnConsumed) { abnormal = true; break; }
    session.state.players[0]._lastSimulationAbilityId = decisionId;
    if (finishingQualifies) {
      policyDiagnostics.quickIntercept.finishingShotQualifyingUses += 1;
      if (targetHpBefore > 0 && decision.target?.hp <= 0) policyDiagnostics.quickIntercept.finishingShotKills += 1;
      if (session.state.log.slice(beforeLog).some(line => /Сквозные раны.*избыточного|избыточного.*Сквозные раны/i.test(line))) policyDiagnostics.quickIntercept.finishingShotOverkillTransfers += 1;
    }
    actions += 1; playerTurns += 1;
    abilityUsage[decision.ability.artId || decision.ability.presetKey || decision.ability.name] = (abilityUsage[decision.ability.artId || decision.ability.presetKey || decision.ability.name] || 0) + 1;
    if (verbose) trace.push({ turn: playerTurns, kind: 'ability', abilityId: decision.ability.artId || decision.ability.presetKey, target: decision.target?.name, hp: session.state.players[0].hp, lines: session.state.log.slice(beforeLog) });
  }
  if (actions >= maxActions && !checkBattleOutcome(session).victory && !checkBattleOutcome(session).defeat) abnormal = true;
  const outcome = checkBattleOutcome(session);
  const endingPlayer = session.state.players[0];
  const endingEnemyHp = session.state.enemies.reduce((sum, enemy) => sum + Math.max(0, enemy.hp), 0);
  const logLines = session.state.log || [];
  return {
    ...(recording ? { recording } : {}),
    seed, policy, location, outcome: abnormal ? 'abnormal' : outcome.defeat ? 'defeat' : 'victory', abnormal,
    actions, playerTurns, enemyTurns, endingPlayerHp: Math.max(0, endingPlayer.hp),
    endingPlayerHpPercentage: endingPlayer.maxHp ? Math.max(0, endingPlayer.hp) / endingPlayer.maxHp * 100 : 0,
    playerDamageDealt: startingEnemyHp - endingEnemyHp,
    damageReceived, healingReceived, shieldsGenerated, shieldsAbsorbed: countMatches(logLines, /щит поглотил/i),
    maxBossDirectActionDamage, maxEnemySequenceDamage,
    fieldTrapUsage: { ...session.state.fieldTrapUsage },
    abilityUsage, consumableUsage, consumableUses: Object.values(consumableUsage).reduce((sum, count) => sum + count, 0), itemHealing, itemOverheal, bossMechanicResponses,
    bossPhaseMetrics: { enemyHealing, poisonFedHealingTriggers: countMatches(logLines, /Мицелиевое питание восстанавливает/i), phaseOneActions: phaseTwoStartedAtAction ?? actions, phaseTwoActions: phaseTwoStartedAtAction == null ? 0 : Math.max(0, actions - phaseTwoStartedAtAction) },
    itemsRemaining: (endingPlayer.items || []).reduce((out, item) => { out[item.name] = (out[item.name] || 0) + 1; return out; }, {}),
    basicAttackCount: abilityUsage.attack || abilityUsage['Атака'] || 0,
    statusApplications: countMatches(logLines, /накладывает|получает.*(?:Шок|Горение|Замороз)/i),
    summonCount: session.state.players.filter(unit => unit?.summoned).length,
    enemyDeaths: session.state.enemies.filter(enemy => enemy?.hp <= 0).length,
    playerDeath: endingPlayer.hp <= 0,
    classMetrics: {
      reactions: countMatches(logLines, /реакц/i), resonanceLevel: endingPlayer._elementalResonance?.level || 0,
      elementalChargeTriggers: { ...(endingPlayer._elementalChargeTriggers || { fire: 0, ice: 0, lightning: 0 }) },
      resonanceSplashEvents: countMatches(logLines, /Стихийный резонанс наносит/i), overheatProcs: countMatches(logLines, /Перегрев/i),
      shockSkips: countMatches(logLines, /парализован шоком/i), lightningSpeedTriggers: countMatches(logLines, /Скорость молнии/i),
      overkillTransfers: countMatches(logLines, /избыточн|Сквозные раны/i), trapTriggers: countMatches(logLines, /ловушк/i), redirectUses: abilityUsage.redirect || 0,
    },
    deserterMetrics: { ...(session.state.metrics || {}) },
    poisonMetrics: Object.fromEntries(Object.entries(session.state.metrics || {}).filter(([key]) => /poison|directDamage|periodicDamage/i.test(key))),
    composition: session.state.enemies.map(enemy => enemy.name).sort((a, b) => a.localeCompare(b, 'ru')).join(' + '),
    player: endingPlayer, profile: resolvedProfile.snapshot, decisionIds, policyDiagnostics, recruitSealMetrics: { ...(endingPlayer._recruitSealMetrics || {}) },
    healingAtDeath: endingPlayer.hp <= 0 ? { physicallyRemaining: (endingPlayer.items || []).some(item => getItemDefinition(item.name)?.type === 'heal'), availableOnLastPlayerTurn: lastPlayerTurnHealing.available, availableButNotChosen: lastPlayerTurnHealing.available && !lastPlayerTurnHealing.chosen, diedBeforeNextAction: true, unavailableReason: lastPlayerTurnHealing.available ? null : lastPlayerTurnHealing.physicallyRemaining ? 'not-legal-on-last-player-turn' : 'none-remaining' } : null,
    lethalWindow,
    decisionDiagnostics: debugDecisions ? decisionDiagnostics : undefined,
    trace: verbose ? trace : undefined,
  };
};

// All combat randomness is scoped to the session; policy draws use that same
// stream and recording captures its state immediately before each command.
export const simulateCombat = (options = {}) => simulateCombatCore({
  ...options, simulationRng: createSeededRng(options.seed ?? 1),
});

const percentile = (values, fraction) => values.length ? [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)] : 0;
const snapshotEncounterConfiguration = encounter => encounter.map(enemy => ({
  name: enemy.name, boss: Boolean(enemy.boss), encounterPhase: enemy.encounterPhase || 'early', maxHp: enemy.maxHp,
  attack: enemy.attack, magAtk: enemy.magAtk, physDef: enemy.physDef, magicDef: enemy.magicDef, speed: enemy.speed,
  abilities: (enemy.abilities || []).map(ability => ({ id: ability.artId || ability.name, name: ability.name, cooldown: ability.cooldown || 0 })),
  simulationAuthoredIntent: enemy._simulationAuthoredIntent,
  simulationResolvedStats: enemy._simulationResolvedStats,
}));
export const simulateCombatBatch = ({ runs = 1000, seed = 1, classId = 'Archer', policy = 'naive', bossPolicy, balanceVariant = 'production_baseline', location = 'fungal', enemyNames, verbose = false, profile = 'fresh', build = 'default', relicLevel, activeIds, passiveIds, consumables, completedCombats = 0, boss = false, playerState } = {}) => {
  const locationDef = resolveCombatLocation(location);
  const resolvedBalanceVariant = resolveSimulationBalanceVariant(balanceVariant);
  const locationEnemies = canonicalEnemies.filter(enemy => enemy.location === locationDef.name && !enemy.boss);
  const authoredBoss = canonicalEnemies.find(enemy => enemy.location === locationDef.name && enemy.boss);
  if (boss && !authoredBoss) throw new Error(`No authored boss for combat simulation location: ${locationDef.name}`);
  const pool = getTrashEnemyPool({ nonBossEnemies: locationEnemies, selectedLocation: locationDef.name, completedCombatRooms: completedCombats });
  const results = [];
  for (let index = 0; index < runs; index += 1) {
    const childSeed = deriveRunSeed(seed, index);
    const encounterRng = createSeededRng(childSeed);
    // Use the exact authored three-enemy compositions on floor II, never the
    // generic two-enemy fallback used by earlier floor-I locations.
    const rollEncounter = () => {
      const options = { completedCombatRooms: completedCombats };
      if (locationDef.name === FUNGAL_LOCATION) return createMushroomCavesEncounter(pool, encounterRng, options)?.enemies || [];
      if (locationDef.name === GOBLIN_LOCATION) return createGoblinNestsEncounter(pool, encounterRng, options)?.enemies || [];
      if (locationDef.name === DESERTER_LOCATION) return createDeserterCampEncounter(pool, encounterRng, options)?.enemies || [];
      if (locationDef.name === WITHERING_FOREST_LOCATION) return createWitheringForestEncounter(pool, encounterRng, options)?.enemies || [];
      if (locationDef.name === RESTLESS_RUINS_LOCATION) return createRestlessRuinsEncounter(pool, encounterRng, options)?.enemies || [];
      if (locationDef.name === MINES_OF_DECAY_LOCATION) return createMinesOfDecayEncounter(pool, encounterRng, options)?.enemies || [];
      return createEncounterPair(pool, encounterRng, { location: locationDef.name });
    };
    let encounter = boss
      ? [applySimulationBossVariant(createEnemyInstanceByName(authoredBoss.name), resolvedBalanceVariant)]
      : enemyNames?.length
        ? enemyNames.map(name => createEnemyInstanceByName(name)).filter(Boolean)
        : rollEncounter();
    if (!encounter.length) throw new Error(`No authored encounter for ${locationDef.name}`);
    if (!enemyNames?.length && locationDef.name === DESERTER_LOCATION) encounter = applyDeserterAlertModifier({ enemies: encounter, completedCombatRooms: completedCombats, pool, rng: encounterRng }).enemies;
    if (!boss) encounter = applySimulationEncounterVariant({
      encounter, variant: resolvedBalanceVariant, completedCombatRooms: completedCombats,
      rng: encounterRng, rerollEncounter: rollEncounter,
    }).encounter;
    const resolvedEncounterConfiguration = snapshotEncounterConfiguration(encounter);
    const replayPlayer = playerState ? { ...playerState, abilities: (playerState.abilities || []).map(ability => ({ ...createAbilityByName(ability.name), ...ability })), items: (playerState.items || []).map(item => typeof item === 'string' ? { name: item } : { ...item }) } : undefined;
    const result = simulateCombat({ player: replayPlayer, classId, profile, build, relicLevel, activeIds, passiveIds, consumables, enemies: encounter, seed: childSeed, policy: boss ? (bossPolicy || policy) : policy, balanceVariant: resolvedBalanceVariant.id, location: locationDef.id, verbose: verbose && runs === 1, debugDecisions: verbose && runs === 1 });
    result.hasStrongEnemy = encounter.some(enemy => enemy.encounterPhase === 'late');
    result.resolvedEncounterConfiguration = resolvedEncounterConfiguration;
    results.push(result);
  }
  const wins = results.filter(result => result.outcome === 'victory');
  const usage = {}; const itemUsage = {};
  const bossMechanicResponses = {}; const recruitSealMetrics = { startTriggers: 0, consumableTriggers: 0, firstConsumableTriggers: 0, preservedConsumables: 0 };
  const bossPhaseMetrics = { enemyHealing: 0, poisonFedHealingTriggers: 0, phaseOneActions: 0, phaseTwoActions: 0 };
  const classMetrics = {}; const deserterMetrics = {}; const poisonMetrics = {}; const compositions = {};
  results.forEach(result => Object.entries(result.abilityUsage).forEach(([id, count]) => { usage[id] = (usage[id] || 0) + count; }));
  results.forEach(result => Object.entries(result.consumableUsage).forEach(([id, count]) => { itemUsage[id] = (itemUsage[id] || 0) + count; }));
  results.forEach(result => Object.entries(result.bossMechanicResponses || {}).forEach(([id, count]) => { bossMechanicResponses[id] = (bossMechanicResponses[id] || 0) + count; }));
  results.forEach(result => Object.entries(result.recruitSealMetrics || {}).forEach(([id, count]) => { recruitSealMetrics[id] = (recruitSealMetrics[id] || 0) + count; }));
  results.forEach(result => Object.entries(result.bossPhaseMetrics || {}).forEach(([id, count]) => { bossPhaseMetrics[id] += count || 0; }));
  results.forEach(result => {
    Object.entries(result.classMetrics).forEach(([key, value]) => { classMetrics[key] = (classMetrics[key] || 0) + value; });
    Object.entries(result.deserterMetrics || {}).forEach(([key, value]) => { deserterMetrics[key] = (deserterMetrics[key] || 0) + value; });
    Object.entries(result.poisonMetrics || {}).forEach(([key, value]) => { poisonMetrics[key] = (poisonMetrics[key] || 0) + value; });
    const composition = (compositions[result.composition] ||= { fights: 0, victories: 0 });
    composition.fights += 1; composition.victories += result.outcome === 'victory' ? 1 : 0;
  });
  const summarizeClass = classResults => {
    const victories = classResults.filter(result => result.outcome === 'victory');
    return { fights: classResults.length, victories: victories.length, defeats: classResults.filter(result => result.outcome === 'defeat').length, winRate: classResults.length ? victories.length / classResults.length * 100 : 0, averageHpLost: classResults.length ? classResults.reduce((sum, result) => sum + result.damageReceived, 0) / classResults.length : 0, winningHp: { mean: victories.length ? victories.reduce((sum, result) => sum + result.endingPlayerHpPercentage, 0) / victories.length : 0, median: percentile(victories.map(result => result.endingPlayerHpPercentage), 0.5) }, consumablesPerFight: classResults.length ? classResults.reduce((sum, result) => sum + result.consumableUses, 0) / classResults.length : 0 };
  };
  return {
    metadata: { simulator: 'Ashen Abyss Combat Simulator', version: COMBAT_SIMULATOR_VERSION, label: 'simulator-policy results' },
    config: { runs, seed, classId, policy, bossPolicy: boss ? (bossPolicy || policy) : null, canonicalCleanBoss: Boolean(boss && (bossPolicy || policy) === 'boss_aware' && !playerState), balanceVariant: resolvedBalanceVariant.id, balanceVariantStatus: resolvedBalanceVariant.status || 'active', balanceVariantMetadata: { authoredIntent: resolvedBalanceVariant.authoredIntent, expectedResolved: resolvedBalanceVariant.expectedResolved }, promotedOverrides: resolvedBalanceVariant.promotedOverrides || [], balanceOverrides: resolvedBalanceVariant.overrides, resolvedEncounter: results[0]?.composition, resolvedEncounterConfiguration: results[0]?.resolvedEncounterConfiguration, resolvedPlayerSnapshot: boss ? results[0]?.profile : undefined, location: locationDef.id, profile, build, relicLevel: results[0]?.profile?.relic?.level, completedCombats, strongPoolAvailable: completedCombats >= 7, alertLevel: getDeserterAlertLevel(completedCombats), encounterType: boss ? 'authored-boss' : 'ordinary', replayedPlayerState: Boolean(playerState) },
    profile: results[0]?.profile,
    outcomes: { victories: wins.length, defeats: results.filter(result => result.outcome === 'defeat').length, abnormal: results.filter(result => result.abnormal).length, winRate: wins.length / runs * 100 },
    matchedFightOutcomes: results.map((result, index) => ({ index, seed: result.seed, outcome: result.outcome, endingPlayerHp: result.endingPlayerHp, actions: result.actions, consumableUses: result.consumableUses, consumableUsage: result.consumableUsage, maxBossDirectActionDamage: result.maxBossDirectActionDamage, maxEnemySequenceDamage: result.maxEnemySequenceDamage, lethalWindow: result.lethalWindow, bossMechanicResponses: result.bossMechanicResponses, classMetrics: result.classMetrics, deserterMetrics: result.deserterMetrics, poisonMetrics: result.poisonMetrics })),
    defeatDiagnostics: { deathsBeforeNextPlayerAction: results.filter(result => result.playerDeath && result.healingAtDeath?.diedBeforeNextAction).length, percentageOfFights: results.filter(result => result.playerDeath && result.healingAtDeath?.diedBeforeNextAction).length / runs * 100, deathsFrom55PlusHp: results.filter(result => result.lethalWindow?.atLeast55Percent).length, hpBuckets: results.filter(result => result.lethalWindow?.atLeast55Percent).reduce((out, result) => { const key = result.lethalWindow.hpBucket; out[key] = (out[key] || 0) + 1; return out; }, {}), responsesAvailable: results.filter(result => result.lethalWindow?.responseAvailable).length, forecastResponsesFailed: results.filter(result => result.lethalWindow?.diagnosticClassification === 'forecast-response-failed').length, causallyVerifiedPreventable: 0, representativeTraces: results.filter(result => result.lethalWindow?.atLeast55Percent).slice(0, 5).map(result => ({ seed: result.seed, ...result.lethalWindow })) },
    actions: { mean: results.reduce((sum, result) => sum + result.actions, 0) / runs, median: percentile(results.map(result => result.actions), 0.5) },
    winningHp: { mean: wins.length ? wins.reduce((sum, result) => sum + result.endingPlayerHpPercentage, 0) / wins.length : 0, p10: percentile(wins.map(result => result.endingPlayerHpPercentage), 0.1), median: percentile(wins.map(result => result.endingPlayerHpPercentage), 0.5), p90: percentile(wins.map(result => result.endingPlayerHpPercentage), 0.9) },
    averages: { hpLost: results.reduce((sum, result) => sum + result.damageReceived, 0) / runs, damageDealt: results.reduce((sum, result) => sum + result.playerDamageDealt, 0) / runs },
    abilityUsage: usage, consumableUsage: itemUsage, recruitSealMetrics, bossEvaluatorCoverage: boss ? BOSS_EVALUATOR_COVERAGE : null, bossMechanicResponses: boss ? bossMechanicResponses : null, bossPhaseMetrics: boss ? Object.fromEntries(Object.entries(bossPhaseMetrics).map(([id, total]) => [id, { total, perFight: total / runs }])) : null,
    consumables: { perFight: results.reduce((sum, result) => sum + result.consumableUses, 0) / runs, healingPerFight: results.reduce((sum, result) => sum + result.itemHealing, 0) / runs, deathsWithHealingRemaining: results.filter(result => result.playerDeath && Object.keys(result.itemsRemaining).some(name => getItemDefinition(name)?.type === 'heal')).length },
    classMetrics,
    deserterMetrics,
    poisonMetrics: { ...poisonMetrics, poisonDamagePerFight: ((poisonMetrics.poisonDamagePlayerToEnemies || 0) + (poisonMetrics.poisonDamageEnemiesToPlayer || 0)) / runs, averagePoisonTicks: (poisonMetrics.poisonTicks || 0) / runs, playerPoisonShare: (poisonMetrics.poisonDamagePlayerToEnemies || 0) / Math.max(1, (poisonMetrics.poisonDamagePlayerToEnemies || 0) + (poisonMetrics.directDamagePlayerToEnemies || 0)), enemyPoisonShare: (poisonMetrics.poisonDamageEnemiesToPlayer || 0) / Math.max(1, (poisonMetrics.poisonDamageEnemiesToPlayer || 0) + (poisonMetrics.directDamageEnemiesToPlayer || 0)) },
    diagnostics: {
      firstDecisionIds: results.map(result => result.decisionIds[0] || null),
      quickIntercept: results.reduce((out, result) => {
        const diagnostic = result.policyDiagnostics?.quickIntercept || {};
        out.legalOpportunities += diagnostic.legalOpportunities || 0;
        out.selected += diagnostic.selected || 0;
        out.scoreTotal += diagnostic.scoreTotal || 0;
        out.turnMeterUtilityTotal += diagnostic.turnMeterUtilityTotal || 0;
        out.gain250Opportunities += diagnostic.gain250Opportunities || 0;
        out.gain350Opportunities += diagnostic.gain350Opportunities || 0;
        out.finishingShotQualifyingUses += diagnostic.finishingShotQualifyingUses || 0;
        out.finishingShotKills += diagnostic.finishingShotKills || 0;
        out.finishingShotOverkillTransfers += diagnostic.finishingShotOverkillTransfers || 0;
        Object.entries(diagnostic.beatenBy || {}).forEach(([id, count]) => { out.beatenBy[id] = (out.beatenBy[id] || 0) + count; });
        return out;
      }, { legalOpportunities: 0, selected: 0, scoreTotal: 0, turnMeterUtilityTotal: 0, gain250Opportunities: 0, gain350Opportunities: 0, finishingShotQualifyingUses: 0, finishingShotKills: 0, finishingShotOverkillTransfers: 0, beatenBy: {} }),
    },
    compositions: Object.fromEntries(Object.entries(compositions).map(([name, value]) => [name, { ...value, winRate: value.victories / value.fights * 100 }])),
    encounterClasses: { ordinary: summarizeClass(results.filter(result => !result.hasStrongEnemy)), strong: summarizeClass(results.filter(result => result.hasStrongEnemy)) },
    dangerousCompositions: Object.entries(compositions).map(([composition, value]) => ({ composition, ...value, defeats: value.fights - value.victories, winRate: value.victories / value.fights * 100 })).sort((a, b) => a.winRate - b.winRate || b.fights - a.fights).slice(0, 20),
    results: verbose || runs <= 10 ? results.map(({ player, ...result }) => ({ ...result, player: { hp: player.hp, maxHp: player.maxHp, items: (player.items || []).map(item => ({ name: item.name })) } })) : undefined,
  };
};

export const formatCombatSimulationReport = report => [
  'ASHEN ABYSS COMBAT SIMULATOR', '',
  'These are simulator-policy results, not measured human win rates.',
  `Class: ${report.config.classId} | Location: ${report.config.location} | Policy: ${report.config.policy}`,
  `Profile: ${report.config.profile} | Build: ${report.config.build} | Relic: ${report.profile?.relic?.id}@${report.profile?.relic?.level}`,
  `Stats: ${Object.entries(report.profile?.derivedStats || {}).map(([id, value]) => `${id}=${value}`).join(', ')}`,
  `Equipment: ${Object.entries(report.profile?.equipment || {}).filter(([, value]) => value).map(([slot, value]) => `${slot}=${typeof value === 'string' ? value : value.itemId || value.name}`).join(', ') || 'none'}`,
  `Actives: ${(report.profile?.activeAbilityIds || []).join(', ')} | Passives: ${(report.profile?.passiveIds || []).join(', ') || 'none'}`,
  `Starting consumables: ${(report.profile?.consumables || []).map(item => `${item.id}x${item.quantity}`).join(', ') || 'none'}`,
  `Runs: ${report.config.runs} | Seed: ${report.config.seed}`,
  `Completed combats: ${report.config.completedCombats} | strong pool: ${report.config.strongPoolAvailable ? 'available' : 'locked'} | alert: ${report.config.alertLevel}`,
  `Victory/defeat/abnormal: ${report.outcomes.victories}/${report.outcomes.defeats}/${report.outcomes.abnormal} (${report.outcomes.winRate.toFixed(2)}% victory)`,
  `Median actions: ${report.actions.median}`,
  `Winning HP p10/p50/p90: ${report.winningHp.p10.toFixed(1)} / ${report.winningHp.median.toFixed(1)} / ${report.winningHp.p90.toFixed(1)}`,
  `Average HP lost: ${report.averages.hpLost.toFixed(2)} | damage dealt: ${report.averages.damageDealt.toFixed(2)}`,
  `Ability usage: ${Object.entries(report.abilityUsage).map(([id, count]) => `${id}=${count}`).join(', ')}`,
  `Quick Intercept diagnostics: legal=${report.diagnostics.quickIntercept.legalOpportunities}, selected=${report.diagnostics.quickIntercept.selected}, gain250=${report.diagnostics.quickIntercept.gain250Opportunities}, gain350=${report.diagnostics.quickIntercept.gain350Opportunities}, avgScore=${report.diagnostics.quickIntercept.legalOpportunities ? (report.diagnostics.quickIntercept.scoreTotal / report.diagnostics.quickIntercept.legalOpportunities).toFixed(2) : '0.00'}, avgTM=${report.diagnostics.quickIntercept.legalOpportunities ? (report.diagnostics.quickIntercept.turnMeterUtilityTotal / report.diagnostics.quickIntercept.legalOpportunities).toFixed(1) : '0.0'}, beatenBy=${Object.entries(report.diagnostics.quickIntercept.beatenBy).sort((a, b) => b[1] - a[1]).map(([id, count]) => `${id}:${count}`).join(', ') || 'none'}`,
  `Finishing Shot diagnostics: qualifying=${report.diagnostics.quickIntercept.finishingShotQualifyingUses}, kills=${report.diagnostics.quickIntercept.finishingShotKills}, overkillTransfers=${report.diagnostics.quickIntercept.finishingShotOverkillTransfers}`,
  `Consumables: ${Object.entries(report.consumableUsage).map(([id, count]) => `${id}=${count}`).join(', ') || 'none'} (${report.consumables.perFight.toFixed(3)}/fight)`,
  `Class metrics: ${Object.entries(report.classMetrics).map(([id, count]) => `${id}=${count}`).join(', ')}`,
].join('\n');

