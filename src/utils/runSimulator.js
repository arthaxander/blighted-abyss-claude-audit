import { AVAILABLE_LOCATIONS } from '../data/locations';
import { enemies } from '../data/enemies';
import { findItemData, getItemDefinition, rollTreasureLoot } from '../data/items';
import { CURSE_POOL } from '../data/curses';
import { BOSS_MATERIAL_BY_LOCATION, CURSED_ONLY_MATERIALS } from '../data/levelOneLootOwnership';
import {
  createEncounterPair,
  createDeserterCampEncounter,
  createGoblinNestsEncounter,
  createMushroomCavesEncounter,
  applyDeserterAlertModifier,
  DESERTER_LOCATION,
  FUNGAL_LOCATION,
  GOBLIN_LOCATION,
  getEncounterProgressionPhase,
  getCursedEnemyPool,
  getTrashEnemyPool,
} from './enemyPools';
import {
  generateRoomChoices,
  normalizeRoomGenerationLocationState,
  ROOM_TYPES,
  SECRET_TYPES,
} from './roomGeneration';
import {
  createEncounterRewardRoster,
  resolveEncounterRewards,
} from './encounterRewards';
import { createSeededSimulationRng, deriveSimulationSeed } from './simulationRng';
import { simulateCombat } from './combatSimulator';
import { resolveSimulationPlayerProfile } from './simulationPlayerProfiles';
import { applySimulationBossVariant, applySimulationEncounterVariant, resolveSimulationBalanceVariant } from './simulationBalanceVariants';
import { createExpeditionDeathResult, extractRunInventory, getRunInventoryLayout, insertItems, migrateRunInventory, slotsToLegacyInventory } from './expeditionInventory';
import { applyPoulticeCraftPolicy, applySimulationGearPolicy, decideVoluntaryExtraction, scoreVisibleEncounterThreat } from './simulationExpeditionPolicies';
import { isStrongEnemy, isStrongPoolAvailable, resolveSimulationTuning } from './levelOneProgression';
import { rollRecruitSealExtraLoot } from './recruitSealRewards';

export const RUN_SIMULATOR_VERSION = 1;
export const DEFAULT_MAX_WINDOWS = 200;
export const LOOT_POLICY_IDS = Object.freeze(['take_all_legal', 'balanced', 'conservative']);
export const DWOEGLAV_NAME = 'Змеиный двоеглав';

export const LOCATION_ALIASES = Object.freeze({
  goblin: 'goblin',
  fungal: 'fungal',
  mushroom: 'fungal',
  deserter: 'deserter',
});

const toUint32 = value => Number(value) >>> 0;

export const deriveRunSeed = deriveSimulationSeed;

export const createSeededRng = createSeededSimulationRng;

const chooseLowestVisibleThreat = (choices, rng, context = {}) => {
  const scored = choices.map(choice => ({ choice, threat: scoreVisibleEncounterThreat(choice, context.player || context) }));
  const lowest = Math.min(...scored.map(entry => entry.threat));
  const matches = scored.filter(entry => Math.abs(entry.threat - lowest) < 0.000001).map(entry => entry.choice);
  return matches[Math.min(matches.length - 1, Math.floor(rng() * matches.length))];
};

export const resolveSimulationLocation = (locationInput = 'goblin') => {
  const normalized = String(locationInput || '').trim().toLowerCase();
  const id = LOCATION_ALIASES[normalized] || normalized;
  const location = AVAILABLE_LOCATIONS.find(entry => entry.id === id || entry.name === locationInput);
  if (!location) throw new Error(`Unknown simulation location: ${locationInput}`);
  return location;
};

export const RUN_CHOICE_POLICIES = Object.freeze({
  random: (choices, rng) => choices[Math.min(choices.length - 1, Math.floor(rng() * choices.length))],
  combat_priority: (choices, rng) => {
    // A Boss room is the run's terminal combat and takes precedence once authored rules offer it.
    const preferred = choices.filter(choice => choice.roomType === ROOM_TYPES.BOSS);
    const combats = preferred.length ? preferred : choices.filter(choice => choice.roomType === ROOM_TYPES.COMBAT);
    const pool = combats.length ? combats : choices;
    return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
  },
  cautious: (choices, rng, context = {}) => {
    const hpRatio = context.maxHp ? context.hp / context.maxHp : 1;
    const safeTypes = [ROOM_TYPES.RESOURCE, ROOM_TYPES.FISHING, ROOM_TYPES.ALTAR, ROOM_TYPES.TREASURE];
    const safe = choices.filter(choice => safeTypes.includes(choice.roomType));
    if (hpRatio < 0.5 && safe.length) return safe[Math.min(safe.length - 1, Math.floor(rng() * safe.length))];
    const nonRisky = choices.filter(choice => ![ROOM_TYPES.CURSED_ENEMY, ROOM_TYPES.COMBAT].includes(choice.roomType));
    const pool = hpRatio < 0.3 && nonRisky.length ? nonRisky : choices;
    if (pool.length > 1 && pool.every(choice => [ROOM_TYPES.COMBAT, ROOM_TYPES.CURSED_ENEMY, ROOM_TYPES.BOSS].includes(choice.roomType))) {
      return chooseLowestVisibleThreat(pool, rng, context);
    }
    return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
  },
  greedy: (choices, rng) => {
    const preferred = [ROOM_TYPES.TREASURE, ROOM_TYPES.SECRET, ROOM_TYPES.CURSED_ENEMY];
    for (const type of preferred) {
      const matches = choices.filter(choice => choice.roomType === type);
      if (matches.length) return matches[Math.min(matches.length - 1, Math.floor(rng() * matches.length))];
    }
    return choices[Math.min(choices.length - 1, Math.floor(rng() * choices.length))];
  },
  balanced: (choices, rng, context = {}) => {
    const boss = choices.find(choice => choice.roomType === ROOM_TYPES.BOSS);
    if (boss) return boss;
    const hpRatio = context.maxHp ? context.hp / context.maxHp : 1;
    const needsPoulticeMaterials = hpRatio < 0.75 && !(context.hasBloodMoss && context.hasSimpleCloth);
    const needsCombatProgress = (context.completedCombatRooms || 0) < 2;
    const priorities = needsPoulticeMaterials
      ? [ROOM_TYPES.RESOURCE, ROOM_TYPES.TREASURE, ROOM_TYPES.FISHING, ROOM_TYPES.ALTAR, ROOM_TYPES.COMBAT, ROOM_TYPES.SECRET]
      : needsCombatProgress
        ? [ROOM_TYPES.TREASURE, ROOM_TYPES.RESOURCE, ROOM_TYPES.COMBAT, ROOM_TYPES.FISHING, ROOM_TYPES.ALTAR, ROOM_TYPES.SECRET]
        : [ROOM_TYPES.TREASURE, ROOM_TYPES.RESOURCE, ROOM_TYPES.FISHING, ROOM_TYPES.ALTAR, ROOM_TYPES.COMBAT, ROOM_TYPES.SECRET];
    for (const type of priorities) {
      const matches = choices.filter(choice => choice.roomType === type);
      if (matches.length) return [ROOM_TYPES.COMBAT, ROOM_TYPES.CURSED_ENEMY, ROOM_TYPES.BOSS].includes(type)
        ? chooseLowestVisibleThreat(matches, rng, context)
        : matches[Math.min(matches.length - 1, Math.floor(rng() * matches.length))];
    }
    return choices[Math.min(choices.length - 1, Math.floor(rng() * choices.length))];
  },
});

const addCount = (record, key, amount = 1) => {
  if (!key) return;
  record[key] = (record[key] || 0) + amount;
};

const percentileFromSorted = (sorted, fraction) => {
  if (!sorted.length) return 0;
  const index = Math.max(0, Math.ceil(fraction * sorted.length) - 1);
  return sorted[index];
};

const summarizeValues = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
    min: sorted[0] || 0,
    p10: percentileFromSorted(sorted, 0.1),
    p25: percentileFromSorted(sorted, 0.25),
    median: percentileFromSorted(sorted, 0.5),
    p75: percentileFromSorted(sorted, 0.75),
    p90: percentileFromSorted(sorted, 0.9),
    max: sorted[sorted.length - 1] || 0,
  };
};

const sortedRecord = record => Object.fromEntries(
  Object.entries(record).sort(([left], [right]) => left.localeCompare(right, 'ru'))
);

const rankedRecord = (record, limit = 20) => Object.entries(record)
  .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'ru'))
  .slice(0, limit)
  .map(([name, count]) => ({ name, count }));

const itemCategory = name => findItemData(name)?.type || 'unknown';
const addItemsByCategory = (record, items = []) => items.forEach(item => addCount(record, itemCategory(item.name || item.itemId), Number(item.quantity) || 0));
const inventoryContents = player => (player?.runInventory || []).filter(Boolean).map((stack, index) => ({ index, itemId: stack.itemId, quantity: stack.quantity }));
const inventorySnapshot = (player, checkpoint, context = {}) => {
  const layout = getRunInventoryLayout(player?.equipment);
  const slots = migrateRunInventory(player?.runInventory, player?.equipment, player?.runInventoryLayoutVersion);
  const sections = Object.fromEntries(layout.sections.map(section => {
    const occupied = section.indices.filter(index => Boolean(slots[index])).length;
    return [section.type, { capacity: section.capacity, occupied, free: section.capacity - occupied }];
  }));
  return { checkpoint, ...context, capacity: layout.totalCapacity, occupied: slots.filter(Boolean).length, free: layout.totalCapacity - slots.filter(Boolean).length, sections, contents: inventoryContents({ runInventory: slots }) };
};
const replayableCombatPlayerState = player => ({
  ...['class', 'hp', 'maxHp', 'attack', 'baseAtk', 'magAtk', 'physDef', 'magicDef', 'speed', 'critChance', 'critDamage', 'dodge', 'shield', 'turnMeter'].reduce((out, key) => ({ ...out, [key]: player?.[key] }), {}),
  baseStats: { ...(player?.baseStats || {}) }, equipment: { ...(player?.equipment || {}) }, relics: player?.relics,
  equippedClassPassiveIds: [...(player?.equippedClassPassiveIds || [])],
  abilities: (player?.abilities || []).map(ability => ({ name: ability.presetKey || ability.name, currentCooldown: ability.currentCooldown || 0 })),
  items: (player?.items || []).map(item => ({ name: typeof item === 'string' ? item : item.name })), effects: [...(player?.effects || [])],
});

const revealChosenRoom = (choice) => {
  if (choice?.roomType !== ROOM_TYPES.SECRET) return choice;
  const roomTypeBySecret = {
    [SECRET_TYPES.TREASURE]: ROOM_TYPES.TREASURE,
    [SECRET_TYPES.COMBAT]: ROOM_TYPES.COMBAT,
    [SECRET_TYPES.CURSED_ENEMY]: ROOM_TYPES.CURSED_ENEMY,
    [SECRET_TYPES.RESOURCE]: ROOM_TYPES.RESOURCE,
    [SECRET_TYPES.CURSE_ALTAR]: ROOM_TYPES.CURSE_ALTAR,
    [SECRET_TYPES.FISHING]: ROOM_TYPES.FISHING,
  };
  return {
    ...(choice.hiddenPayload || {}),
    roomType: roomTypeBySecret[choice.hiddenRoomType] || choice.hiddenRoomType,
    fromSecret: true,
  };
};

const normalizeComposition = encounter => encounter.map(enemy => enemy.name).sort((a, b) => a.localeCompare(b, 'ru')).join(' + ');

const createPhaseMetrics = () => ({
  encounters: 0,
  enemyCount: 0,
  enemyCountDistribution: {},
  families: {},
  enemyAppearances: {},
  enemyEncounterAppearances: {},
  compositions: {},
  pairings: {},
  duplicateEncounters: 0,
});

const createEmptyRun = (runIndex, seed) => ({
  runIndex,
  seed,
  completed: false,
  abnormalReason: null,
  windows: 0,
  combatCountBeforeBoss: 0,
  bossWindow: 0,
  bossCount: 0,
  silver: 0,
  silverGenerated: 0,
  roomOffered: {},
  roomOfferedWindows: {},
  roomChosen: {},
  hiddenChosen: {},
  encounters: 0,
  enemyCount: 0,
  enemyCountDistribution: {},
  families: {},
  enemyAppearances: {},
  enemyEncounterAppearances: {},
  compositions: {},
  pairings: {},
  phases: { early: createPhaseMetrics(), mid: createPhaseMetrics(), late: createPhaseMetrics() },
  duplicateEncounters: 0,
  cursedEncounterCount: 0,
  dwoeglavAppearances: 0,
  dwoeglavEncounters: 0,
  dwoeglavSolo: 0,
  dwoeglavCompanions: {},
  itemQuantities: {},
  itemCategories: {},
  itemsSeen: new Set(),
  equipmentSeen: new Set(),
  dead: false,
  deathCombatIndex: 0,
  combatResults: [],
  combatEnteringHp: [],
  combatEndingHp: [],
  carriedSilverLost: 0,
  persistentSilver: 0,
  securedSilver: 0,
  consumablesGenerated: {}, consumablesAcquired: {}, consumablesLeftBehind: {}, consumableCapacityFailures: 0,
  consumablesRemaining: {},
  itemFlow: { generated: {}, acquired: {}, leftBehind: {}, secured: {}, lost: {}, safePreserved: {} },
  capacityFailure: false, inventorySnapshots: [], combatAnalytics: [],
  encounterTimeline: [],
  bossEntryState: null,
  alertModifiers: {}, alertLevels: {},
  extracted: false, extractionReason: null, extractionHp: 0, gearDecisions: [], poulticesCrafted: 0, poulticesUsed: 0, poulticesPreserved: 0, poulticeHpRestored: 0, fieldConsumableUsage: {},
  recruitSealExtraLoot: {},
  extractionCombatIndex: 0,
  suspiciousExtraction: false,
});

const isCombatConsumable = name => ['heal', 'effects', 'cleanse', 'ability', 'tacticalScroll', 'preparedTrap', 'primeNextDirectAttack', 'entanglementScroll'].includes(getItemDefinition(name)?.type);
export const syncCombatItemsToRunInventory = (player, combatItems = []) => {
  const counts = combatItems.reduce((out, item) => { const name = typeof item === 'string' ? item : item?.name; if (name) out[name] = (out[name] || 0) + 1; return out; }, {});
  const layout = getRunInventoryLayout(player?.equipment);
  const slots = migrateRunInventory(player?.runInventory, player?.equipment, player?.runInventoryLayoutVersion).map(stack => {
    if (!stack || !isCombatConsumable(stack.itemId)) return stack;
    const remaining = counts[stack.itemId] || 0;
    if (!remaining) return null;
    const kept = Math.min(stack.quantity, remaining); counts[stack.itemId] -= kept;
    return { ...stack, quantity: kept };
  });
  const extras = Object.entries(counts).filter(([, quantity]) => quantity > 0).map(([itemId, quantity]) => ({ itemId, quantity }));
  return insertItems(slots, extras, { layout }).slots;
};

export const acquireRunLoot = (player, loot = [], policy = 'balanced') => {
  if (!LOOT_POLICY_IDS.includes(policy)) throw new Error(`Unknown loot policy: ${policy}`);
  const generated = (loot || []).filter(entry => entry?.name && entry.name !== 'Серебро' && Number(entry.quantity) > 0);
  const ranked = policy === 'take_all_legal' ? generated : [...generated].sort((a, b) => {
    const priority = entry => isCombatConsumable(entry.name) ? 0 : findItemData(entry.name)?.type === 'material' ? 1 : policy === 'conservative' ? 3 : 2;
    return priority(a) - priority(b);
  });
  const layout = getRunInventoryLayout(player?.equipment);
  let slots = migrateRunInventory(player?.runInventory, player?.equipment, player?.runInventoryLayoutVersion);
  const acquired = []; const leftBehind = [];
  ranked.forEach(entry => {
    if (policy === 'conservative' && findItemData(entry.name)?.type === 'equipment') { leftBehind.push(entry); return; }
    const insertion = insertItems(slots, [{ itemId: entry.name, quantity: entry.quantity }], { layout });
    slots = insertion.slots;
    const rejected = insertion.rejected.reduce((sum, item) => sum + item.quantity, 0);
    const accepted = entry.quantity - rejected;
    if (accepted > 0) acquired.push({ name: entry.name, quantity: accepted });
    if (rejected > 0) leftBehind.push({ name: entry.name, quantity: rejected, reason: 'capacity' });
  });
  return { player: { ...player, runInventory: slots, items: slotsToLegacyInventory(slots).filter(isCombatConsumable) }, acquired, leftBehind };
};

const recordLoot = (run, loot = []) => {
  loot.forEach(entry => {
    const name = entry?.name;
    const quantity = Math.max(0, Number(entry?.quantity) || 0);
    if (!name || quantity <= 0) return;
    if (name === 'Серебро') {
      run.silver += quantity;
      run.silverGenerated += quantity;
      return;
    }
    const item = findItemData(name);
    const category = Object.values(BOSS_MATERIAL_BY_LOCATION).includes(name)
      ? 'bossMaterial'
      : CURSED_ONLY_MATERIALS.includes(name)
        ? 'cursedMaterial'
        : item?.type || 'unknown';
    addCount(run.itemQuantities, name, quantity);
    addCount(run.itemCategories, category, quantity);
    run.itemsSeen.add(name);
    if (category === 'equipment') run.equipmentSeen.add(name);
  });
};

const recordEncounterMetrics = (metrics, encounter, { cursed = false, boss = false } = {}) => {
  metrics.encounters += 1;
  metrics.enemyCount += encounter.length;
  addCount(metrics.enemyCountDistribution, encounter.length);
  const families = [...new Set(encounter.map(enemy => enemy.encounterFamily).filter(Boolean))];
  const family = families.length === 1 ? families[0] : boss ? 'boss' : cursed ? 'cursed' : families.length > 1 ? 'mixed' : 'unclassified';
  addCount(metrics.families, family);
  const uniqueNames = new Set();
  encounter.forEach(enemy => {
    addCount(metrics.enemyAppearances, enemy.name);
    uniqueNames.add(enemy.name);
  });
  uniqueNames.forEach(name => addCount(metrics.enemyEncounterAppearances, name));
  addCount(metrics.compositions, normalizeComposition(encounter));
  if (uniqueNames.size < encounter.length) metrics.duplicateEncounters += 1;
  for (let left = 0; left < encounter.length; left += 1) {
    for (let right = left + 1; right < encounter.length; right += 1) {
      addCount(metrics.pairings, [encounter[left].name, encounter[right].name].sort((a, b) => a.localeCompare(b, 'ru')).join(' + '));
    }
  }
};

const recordEncounter = (run, encounter, { cursed = false, boss = false, phase = 'early' } = {}) => {
  if (!encounter.length) return;
  recordEncounterMetrics(run, encounter, { cursed, boss });
  recordEncounterMetrics(run.phases[phase] || run.phases.early, encounter, { cursed, boss });
  if (cursed) run.cursedEncounterCount += 1;
  if (boss) run.bossCount += 1;
  const dwoeglavCount = encounter.filter(enemy => enemy.name === DWOEGLAV_NAME).length;
  if (dwoeglavCount) {
    run.dwoeglavAppearances += dwoeglavCount;
    run.dwoeglavEncounters += 1;
    if (encounter.length === 1) run.dwoeglavSolo += 1;
    encounter.filter(enemy => enemy.name !== DWOEGLAV_NAME).forEach(enemy => addCount(run.dwoeglavCompanions, enemy.name));
  }
};

export const simulateRun = ({ location: locationInput = 'goblin', policy = 'random', seed = 1, runIndex = 0, maxWindows = DEFAULT_MAX_WINDOWS, verbose = false, combatMode = 'abstract', combatPolicy = 'competent', bossPolicy, balanceVariant = 'production_baseline', lootPolicy = 'balanced', gearPolicy = 'off', craftPolicy = 'off', extractionPolicy = 'off', classId = 'Archer', persistentSilver = 0, profile = 'fresh', build = 'default', relicLevel, activeIds, passiveIds, consumables, equipment, progression, tuning: tuningId = 'production_7_14', captureRouteStates = false } = {}) => {
  const location = resolveSimulationLocation(locationInput);
  const choose = RUN_CHOICE_POLICIES[policy];
  if (!choose) throw new Error(`Unknown simulation policy: ${policy}`);
  const rng = createSeededRng(seed);
  const tuning = resolveSimulationTuning(tuningId);
  const resolvedBalanceVariant = resolveSimulationBalanceVariant(balanceVariant);
  const run = createEmptyRun(runIndex, seed);
  run.persistentSilver = Math.max(0, Number(persistentSilver) || 0);
  const resolvedSimulationProfile = combatMode === 'simulated' ? resolveSimulationPlayerProfile({ profile, classId, build, relicLevel, activeIds, passiveIds, consumables, equipment, progression }) : null;
  let simulatedPlayer = resolvedSimulationProfile?.player || null;
  const locationEnemies = enemies.filter(enemy => enemy.location === location.name);
  const nonBossEnemies = locationEnemies.filter(enemy => !enemy.boss);
  const bossEnemy = locationEnemies.find(enemy => enemy.boss) || null;
  const cursedPool = getCursedEnemyPool(nonBossEnemies);
  let state = normalizeRoomGenerationLocationState();
  const takeSnapshot = (checkpoint, context = {}) => {
    if (simulatedPlayer) run.inventorySnapshots.push(inventorySnapshot(simulatedPlayer, checkpoint, { window: run.windows, completedCombats: state.completedCombatRooms, ...context }));
  };
  const recordPickup = (loot, pickup) => {
    addItemsByCategory(run.itemFlow.generated, loot);
    addItemsByCategory(run.itemFlow.acquired, pickup.acquired);
    addItemsByCategory(run.itemFlow.leftBehind, pickup.leftBehind);
    if (pickup.leftBehind.some(entry => entry.reason === 'capacity')) run.capacityFailure = true;
  };

  while (run.windows < maxWindows && !run.completed && !run.dead) {
    const trashPool = getTrashEnemyPool({
      nonBossEnemies,
      selectedLocation: location.name,
      completedCombatRooms: state.completedCombatRooms,
      tuning,
    });
    const buildFightEncounter = (kind = 'combat') => {
      if (kind === 'cursed') {
        const cursed = cursedPool[Math.min(cursedPool.length - 1, Math.floor(rng() * cursedPool.length))];
        return cursed ? { enemies: [cursed], cursedEnemy: true, miniBoss: Boolean(cursed.miniBoss) } : { enemies: [] };
      }
      const authoredEncounter = location.name === FUNGAL_LOCATION
        ? createMushroomCavesEncounter(trashPool, rng, { completedCombatRooms: state.completedCombatRooms, tuning })
        : location.name === GOBLIN_LOCATION
          ? createGoblinNestsEncounter(trashPool, rng, { completedCombatRooms: state.completedCombatRooms, tuning })
          : location.name === DESERTER_LOCATION
            ? createDeserterCampEncounter(trashPool, rng, { completedCombatRooms: state.completedCombatRooms, tuning })
            : null;
      const encounter = authoredEncounter || { enemies: createEncounterPair(trashPool, rng, { location: location.name }), miniBoss: false };
      return location.name === DESERTER_LOCATION
        ? applyDeserterAlertModifier({ ...encounter, completedCombatRooms: state.completedCombatRooms, pool: trashPool, rng })
        : encounter;
    };
    const generated = generateRoomChoices({
      locationName: location.name,
      state: { ...state, progressionTuning: tuning },
      rng,
      bossEnemy,
      hasBossEnemy: Boolean(bossEnemy),
      hasCursedEnemyPool: cursedPool.length > 0,
      buildFightEncounter,
      rollChestLoot: primordialSource => rollTreasureLoot(location.name, 2, 3, { primordialSource, rng }),
      cursePool: CURSE_POOL,
    });
    state = generated.state;
    run.windows += 1;
    const offeredThisWindow = new Set();
    generated.choices.forEach(choice => {
      addCount(run.roomOffered, choice.roomType);
      offeredThisWindow.add(choice.roomType);
    });
    offeredThisWindow.forEach(type => addCount(run.roomOfferedWindows, type));
    if (combatMode === 'simulated') {
      const recovery = applyPoulticeCraftPolicy(simulatedPlayer, craftPolicy, rng);
      simulatedPlayer = recovery.player;
      run.poulticesCrafted += recovery.metrics.crafted;
      run.poulticesUsed += recovery.metrics.used;
      run.poulticesPreserved += recovery.metrics.preserved;
      Object.entries(recovery.metrics.usedByItemId).forEach(([id, count]) => addCount(run.fieldConsumableUsage, id, count));
      run.poulticeHpRestored += recovery.metrics.hpRestored;
      const extraction = decideVoluntaryExtraction({ player: simulatedPlayer, choices: generated.choices, policy: extractionPolicy, completedCombats: run.combatResults.length });
      if (extraction.extract) {
        takeSnapshot('extraction');
        const extractionInventory = inventorySnapshot(simulatedPlayer, 'extraction-decision');
        run.suspiciousExtraction = simulatedPlayer.hp / simulatedPlayer.maxHp >= 0.9 && extractionInventory.occupied <= 2;
        addItemsByCategory(run.itemFlow.secured, inventoryContents(simulatedPlayer).map(entry => ({ name: entry.itemId, quantity: entry.quantity })));
        run.securedSilver = run.silver;
        const extracted = extractRunInventory({ ...simulatedPlayer, guildSilver: run.persistentSilver, runSilver: run.silver });
        simulatedPlayer = extracted.player;
        run.persistentSilver = simulatedPlayer.guildSilver;
        run.extracted = true; run.extractionReason = extraction.reason; run.extractionHp = simulatedPlayer.hp;
        run.extractionCombatIndex = state.completedCombatRooms;
        break;
      }
    }
    const carriedIds = new Set((simulatedPlayer?.runInventory || []).filter(Boolean).map(stack => stack.itemId));
    const selected = choose(generated.choices, rng, { hp: simulatedPlayer?.hp, maxHp: simulatedPlayer?.maxHp, runSilver: run.silver, completedCombatRooms: state.completedCombatRooms, hasBloodMoss: carriedIds.has('Кровяной мох'), hasSimpleCloth: carriedIds.has('Простая ткань') });
    addCount(run.roomChosen, selected.roomType);
    if (selected.roomType === ROOM_TYPES.SECRET) addCount(run.hiddenChosen, selected.hiddenRoomType);
    const resolved = revealChosenRoom(selected);
    const isBoss = resolved.roomType === ROOM_TYPES.BOSS;
    const isCombat = [ROOM_TYPES.COMBAT, ROOM_TYPES.CURSED_ENEMY, ROOM_TYPES.BOSS].includes(resolved.roomType);

    if (isCombat) {
      let encounter = Array.isArray(resolved.enemies) ? resolved.enemies.filter(Boolean) : [];
      const rerollPool = getTrashEnemyPool({ nonBossEnemies, selectedLocation: location.name, completedCombatRooms: state.completedCombatRooms, tuning });
      encounter = isBoss
        ? encounter.map(enemy => applySimulationBossVariant(enemy, resolvedBalanceVariant))
        : applySimulationEncounterVariant({ encounter, variant: resolvedBalanceVariant, completedCombatRooms: state.completedCombatRooms, rng, rerollEncounter: () => (
          location.name === FUNGAL_LOCATION
            ? createMushroomCavesEncounter(rerollPool, rng, { completedCombatRooms: state.completedCombatRooms, tuning })?.enemies || []
            : location.name === GOBLIN_LOCATION
              ? createGoblinNestsEncounter(rerollPool, rng, { completedCombatRooms: state.completedCombatRooms, tuning })?.enemies || []
              : location.name === DESERTER_LOCATION
                ? createDeserterCampEncounter(rerollPool, rng, { completedCombatRooms: state.completedCombatRooms, tuning })?.enemies || []
                : createEncounterPair(rerollPool, rng, { location: location.name })
        ) }).encounter;
      const strongNames = encounter.filter(isStrongEnemy).map(enemy => enemy.name);
      run.encounterTimeline.push({
        combatIndex: run.encounterTimeline.length + 1,
        composition: normalizeComposition(encounter),
        compositionSize: encounter.length,
        strongPoolAvailable: isStrongPoolAvailable(state.completedCombatRooms, tuning),
        hasStrongEnemy: strongNames.length > 0,
        strongEnemyCount: strongNames.length,
        strongEnemyNames: strongNames,
        combatType: isBoss ? 'boss' : resolved.roomType === ROOM_TYPES.CURSED_ENEMY ? (resolved.fromSecret ? 'secret_cursed' : 'cursed') : resolved.fromSecret ? 'secret_combat' : 'ordinary',
      });
      if (isBoss) { run.bossWindow = run.windows; takeSnapshot('beforeBoss', { contentsBeforeBoss: inventoryContents(simulatedPlayer) }); if (simulatedPlayer) run.bossEntryState = replayableCombatPlayerState(simulatedPlayer); }
      addCount(run.alertLevels, String(resolved.alertLevel ?? encounter[0]?.encounterAlertLevel ?? 0));
      if (resolved.alertModifier?.type) addCount(run.alertModifiers, resolved.alertModifier.type);
      recordEncounter(run, encounter, {
        cursed: resolved.roomType === ROOM_TYPES.CURSED_ENEMY,
        boss: isBoss,
        phase: getEncounterProgressionPhase(state.completedCombatRooms),
      });
      if (combatMode === 'simulated') {
        run.combatEnteringHp.push(simulatedPlayer.hp);
        const combatSeed = deriveRunSeed(seed, run.combatResults.length);
        if (captureRouteStates && !isBoss && state.completedCombatRooms >= 7 && state.completedCombatRooms <= 13 && encounter.some(enemy => enemy.name === DWOEGLAV_NAME)) {
          run.routeStateSnapshots ||= [];
          run.routeStateSnapshots.push({ runIndex, routeSeed: seed, combatSeed, combatIndex: run.combatResults.length + 1, classId, profile, policy: combatPolicy, playerState: replayableCombatPlayerState(simulatedPlayer), encounterNames: encounter.map(enemy => enemy.name), companion: encounter.find(enemy => enemy.name !== DWOEGLAV_NAME)?.name || null });
        }
        const combatResult = simulateCombat({ player: simulatedPlayer, enemies: encounter, seed: combatSeed, policy: isBoss ? (bossPolicy || combatPolicy) : combatPolicy, balanceVariant: resolvedBalanceVariant.id, location: location.id, verbose });
        combatResult.profile = resolvedSimulationProfile.snapshot;
        combatResult.startingPlayerHp = run.combatEnteringHp[run.combatEnteringHp.length - 1];
        combatResult.combatIndex = run.combatResults.length + 1;
        combatResult.composition = normalizeComposition(encounter);
        combatResult.boss = isBoss;
        combatResult.compositionSize = encounter.length;
        combatResult.strongPoolAvailable = isStrongPoolAvailable(state.completedCombatRooms, tuning);
        combatResult.hasStrongEnemy = strongNames.length > 0;
        combatResult.strongEnemyCount = strongNames.length;
        combatResult.strongEnemyNames = strongNames;
        combatResult.healingConsumablesUsed = Object.entries(combatResult.consumableUsage || {}).reduce((sum, [name, count]) => sum + (getItemDefinition(name)?.type === 'heal' ? count : 0), 0);
        combatResult.deathWithHealingRemaining = Boolean(combatResult.playerDeath && Object.keys(combatResult.itemsRemaining || {}).some(name => getItemDefinition(name)?.type === 'heal'));
        combatResult.poulticesCraftedBeforeFight = run.poulticesCrafted;
        combatResult.poulticesUsedBeforeFight = run.poulticesUsed;
        combatResult.equipmentFoundBeforeFight = run.itemFlow.generated.equipment || 0;
        combatResult.equipmentUpgradesEquippedBeforeFight = run.gearDecisions.filter(decision => decision.equip).length;
        run.combatResults.push(combatResult);
        const syncedSlots = syncCombatItemsToRunInventory(simulatedPlayer, combatResult.player.items);
        simulatedPlayer = { ...simulatedPlayer, hp: combatResult.endingPlayerHp, items: combatResult.player.items, runInventory: syncedSlots };
        run.combatEndingHp.push(simulatedPlayer.hp);
        if (combatResult.outcome !== 'victory') {
          run.dead = combatResult.outcome === 'defeat';
          if (run.dead) {
            run.deathCombatIndex = run.combatResults.length; run.carriedSilverLost = run.silver; run.silver = 0;
            takeSnapshot('death');
            const death = createExpeditionDeathResult(simulatedPlayer, { rng });
            addItemsByCategory(run.itemFlow.safePreserved, death.preservedStacks.map(stack => ({ name: stack.itemId, quantity: stack.quantity })));
            const safeCapacity = getRunInventoryLayout(simulatedPlayer.equipment).capacities.safe;
            addItemsByCategory(run.itemFlow.lost, inventoryContents(simulatedPlayer).filter(entry => entry.index >= safeCapacity).map(entry => ({ name: entry.itemId, quantity: entry.quantity })));
          }
          else run.abnormalReason = 'combat-guard';
          takeSnapshot('afterRoom', { roomType: resolved.roomType });
          continue;
        }
      }
      const reward = resolveEncounterRewards({ roster: createEncounterRewardRoster(encounter), location: location.name }, rng);
      const sealLoot = combatMode === 'simulated' ? rollRecruitSealExtraLoot({ player: simulatedPlayer, location: location.name, source: isBoss ? 'boss' : 'ordinary', rng }) : { item: null };
      if (sealLoot.item) { reward.items.push(sealLoot.item); addCount(run.recruitSealExtraLoot, sealLoot.item.name, sealLoot.item.quantity); }
      run.silver += Math.max(0, reward.silver || 0);
      run.silverGenerated += Math.max(0, reward.silver || 0);
      recordLoot(run, reward.items);
      if (combatMode === 'simulated') {
        reward.items.filter(entry => isCombatConsumable(entry.name)).forEach(entry => addCount(run.consumablesGenerated, entry.name, entry.quantity));
        const pickup = acquireRunLoot(simulatedPlayer, reward.items, lootPolicy); simulatedPlayer = pickup.player;
        recordPickup(reward.items, pickup);
        const geared = applySimulationGearPolicy(simulatedPlayer, pickup.acquired, gearPolicy); simulatedPlayer = geared.player; run.gearDecisions.push(...geared.decisions);
        pickup.acquired.filter(entry => isCombatConsumable(entry.name)).forEach(entry => addCount(run.consumablesAcquired, entry.name, entry.quantity));
        pickup.leftBehind.filter(entry => isCombatConsumable(entry.name)).forEach(entry => { addCount(run.consumablesLeftBehind, entry.name, entry.quantity); if (entry.reason === 'capacity') run.consumableCapacityFailures += entry.quantity; });
      }
      if (isBoss) {
        run.completed = true;
        run.bossWindow = run.windows;
      } else {
        run.combatCountBeforeBoss += 1;
        state = { ...state, completedCombatRooms: state.completedCombatRooms + 1 };
        if (state.completedCombatRooms === 7) takeSnapshot('afterCombat7');
        if (state.completedCombatRooms === 14) takeSnapshot('afterCombat14');
      }
    } else if ([ROOM_TYPES.TREASURE, ROOM_TYPES.RESOURCE].includes(resolved.roomType)) {
      if (combatMode === 'simulated') {
        const sealLoot = rollRecruitSealExtraLoot({ player: simulatedPlayer, location: location.name, source: resolved.roomType, rng });
        if (sealLoot.item) { resolved.loot.push(sealLoot.item); addCount(run.recruitSealExtraLoot, sealLoot.item.name, sealLoot.item.quantity); }
      }
      recordLoot(run, resolved.loot);
      if (combatMode === 'simulated') {
        resolved.loot.filter(entry => isCombatConsumable(entry.name)).forEach(entry => addCount(run.consumablesGenerated, entry.name, entry.quantity));
        const pickup = acquireRunLoot(simulatedPlayer, resolved.loot, lootPolicy); simulatedPlayer = pickup.player;
        recordPickup(resolved.loot, pickup);
        const geared = applySimulationGearPolicy(simulatedPlayer, pickup.acquired, gearPolicy); simulatedPlayer = geared.player; run.gearDecisions.push(...geared.decisions);
        pickup.acquired.filter(entry => isCombatConsumable(entry.name)).forEach(entry => addCount(run.consumablesAcquired, entry.name, entry.quantity));
        pickup.leftBehind.filter(entry => isCombatConsumable(entry.name)).forEach(entry => { addCount(run.consumablesLeftBehind, entry.name, entry.quantity); if (entry.reason === 'capacity') run.consumableCapacityFailures += entry.quantity; });
      }
    }

    takeSnapshot('afterRoom', { roomType: resolved.roomType });

    if (verbose) {
      const offered = generated.choices.map(choice => choice.roomType).join(', ');
      const foes = Array.isArray(resolved.enemies) ? ` | ${normalizeComposition(resolved.enemies)}` : '';
      // eslint-disable-next-line no-console
      console.log(`[run ${runIndex + 1} window ${run.windows}] ${offered} -> ${selected.roomType}${foes}`);
    }
  }

  if (!run.completed && !run.dead && !run.extracted && !run.abnormalReason) run.abnormalReason = 'max-window-guard';
  if (simulatedPlayer) inventoryContents(simulatedPlayer).filter(entry => findItemData(entry.itemId)?.type === 'consumable').forEach(entry => addCount(run.consumablesRemaining, entry.itemId, entry.quantity));
  if (run.completed) {
    run.securedSilver = run.silver; run.persistentSilver += run.silver;
    addItemsByCategory(run.itemFlow.secured, inventoryContents(simulatedPlayer).map(entry => ({ name: entry.itemId, quantity: entry.quantity })));
  }
  return run;
};

const mergeRecord = (target, source) => Object.entries(source).forEach(([key, value]) => addCount(target, key, value));

export const simulateRuns = ({ location: locationInput = 'goblin', runs = 1000, seed = 1, policy = 'random', maxWindows = DEFAULT_MAX_WINDOWS, verbose = false, combatMode = 'abstract', combatPolicy = 'competent', bossPolicy, balanceVariant = 'production_baseline', lootPolicy = 'balanced', gearPolicy = 'off', craftPolicy = 'off', extractionPolicy = 'off', classId = 'Archer', persistentSilver = 0, profile = 'fresh', build = 'default', relicLevel, activeIds, passiveIds, consumables, equipment, progression, tuning: tuningId = 'production_7_14', captureRouteStates = false } = {}) => {
  const location = resolveSimulationLocation(locationInput);
  const requestedRuns = Math.max(1, Math.floor(Number(runs) || 1));
  const batchSeed = toUint32(seed);
  const tuning = resolveSimulationTuning(tuningId);
  const resolvedBalanceVariant = resolveSimulationBalanceVariant(balanceVariant);
  const aggregate = {
    completed: 0, deaths: 0, extracted: 0, suspiciousExtractions: 0, extractionReasons: {}, extractionHp: [], extractionCombatIndices: [], abnormal: 0, abnormalReasons: {}, windows: [], combats: [], bossWindows: [], silver: [], silverGenerated: 0, silverSecured: 0, persistentSilverAfter: [], gearEvaluations: 0, gearEquipped: 0, poulticesCrafted: 0, poulticesUsed: 0, poulticesPreserved: 0, poulticeHpRestored: 0, fieldConsumableUsage: {},
    roomOffered: {}, roomOfferedWindows: {}, roomChosen: {}, hiddenChosen: {}, enemyCountDistribution: {}, alertModifiers: {}, alertLevels: {},
    enemyAppearances: {}, enemyEncounterAppearances: {}, compositions: {}, pairings: {}, itemQuantities: {},
    itemCategories: {}, itemRunAppearances: {}, equipmentRunAppearances: {}, dwoeglavCompanions: {}, consumablesGenerated: {}, consumablesAcquired: {}, consumablesLeftBehind: {}, consumablesRemaining: {}, consumableCapacityFailures: 0,
    encounters: 0, enemyCount: 0, cursedEncounters: 0, bosses: 0, dwoeglavAppearances: 0,
    dwoeglavEncounters: 0, dwoeglavSolo: 0,
    duplicateEncounters: 0,
    phases: { early: createPhaseMetrics(), mid: createPhaseMetrics(), late: createPhaseMetrics() },
    combatResults: [], combatEnteringHp: {}, combatEndingHp: {}, carriedSilverLost: 0, deathCombatIndexDistribution: {}, deathCombatIndices: [], deserterMetrics: {},
    itemFlow: { generated: {}, acquired: {}, leftBehind: {}, secured: {}, lost: {}, safePreserved: {} }, capacityFailureRuns: 0, inventorySnapshots: [], runStrongFightCounts: [], firstStrongFightIndices: [], reachedBossWithoutStrong: 0, consecutiveStrongRuns: 0, recruitSealExtraLoot: {},
    encounterTimeline: [], endpointStrongFightCounts: { extracted: [], death: [], boss: [], abnormal: [] }, bossEntryStates: [],
    routeStateSnapshots: [],
    matchedRunOutcomes: [],
  };

  for (let runIndex = 0; runIndex < requestedRuns; runIndex += 1) {
    const run = simulateRun({ location: location.id, policy, seed: deriveRunSeed(batchSeed, runIndex), runIndex, maxWindows, verbose, combatMode, combatPolicy, bossPolicy, balanceVariant: resolvedBalanceVariant.id, lootPolicy, gearPolicy, craftPolicy, extractionPolicy, classId, persistentSilver, profile, build, relicLevel, activeIds, passiveIds, consumables, equipment, progression, tuning: tuning.id, captureRouteStates });
    aggregate.routeStateSnapshots.push(...(run.routeStateSnapshots || []));
    const bossFight = run.combatResults.find(result => result.boss);
    const deathFight = run.combatResults.findLast(result => result.playerDeath);
    const bossState = run.bossEntryState ? JSON.stringify(run.bossEntryState) : null;
    aggregate.matchedRunOutcomes.push({
      runIndex, seed: run.seed,
      outcome: run.completed ? 'boss_victory' : run.dead ? 'death' : run.extracted ? 'extracted' : 'abnormal',
      bossReached: Boolean(run.bossCount), bossOutcome: bossFight?.outcome || null,
      bossSeed: bossFight?.seed || null, deathCombatIndex: run.deathCombatIndex || null,
      bossEntryState: bossState,
      bossEntryHp: bossFight?.startingPlayerHp ?? null,
      bossConsumableUses: bossFight?.consumableUses || 0,
      combatConsumableUsesBeforeBoss: bossFight ? run.combatResults.filter(result => !result.boss).reduce((sum, result) => sum + result.consumableUses, 0) : 0,
      poulticesUsedBeforeBoss: bossFight?.poulticesUsedBeforeFight || 0,
      lethalWindow: deathFight?.lethalWindow || null,
    });
    aggregate.completed += run.completed ? 1 : 0;
    aggregate.deaths += run.dead ? 1 : 0;
    aggregate.extracted += run.extracted ? 1 : 0;
    aggregate.suspiciousExtractions += run.suspiciousExtraction ? 1 : 0;
    if (run.extractionReason) addCount(aggregate.extractionReasons, run.extractionReason);
    if (run.extracted) aggregate.extractionHp.push(run.extractionHp);
    if (run.extracted) aggregate.extractionCombatIndices.push(run.extractionCombatIndex);
    aggregate.abnormal += !run.completed && !run.dead && !run.extracted ? 1 : 0;
    aggregate.gearEvaluations += run.gearDecisions.length; aggregate.gearEquipped += run.gearDecisions.filter(decision => decision.equip).length;
    aggregate.poulticesCrafted += run.poulticesCrafted; aggregate.poulticesUsed += run.poulticesUsed; aggregate.poulticesPreserved += run.poulticesPreserved; aggregate.poulticeHpRestored += run.poulticeHpRestored; mergeRecord(aggregate.fieldConsumableUsage, run.fieldConsumableUsage);
    mergeRecord(aggregate.recruitSealExtraLoot, run.recruitSealExtraLoot);
    if (run.abnormalReason) addCount(aggregate.abnormalReasons, run.abnormalReason);
    aggregate.windows.push(run.windows);
    aggregate.combats.push(run.combatCountBeforeBoss);
    if (run.bossCount) aggregate.bossWindows.push(run.bossWindow);
    aggregate.silver.push(run.silver);
    aggregate.persistentSilverAfter.push(run.persistentSilver);
    aggregate.silverGenerated += run.silverGenerated;
    aggregate.silverSecured += run.securedSilver;
    aggregate.combatResults.push(...run.combatResults);
    aggregate.encounterTimeline.push(...run.encounterTimeline);
    if (run.bossEntryState && aggregate.bossEntryStates.length < 20) aggregate.bossEntryStates.push({ runIndex: run.runIndex, seed: run.seed, state: run.bossEntryState });
    Object.keys(aggregate.itemFlow).forEach(key => mergeRecord(aggregate.itemFlow[key], run.itemFlow[key]));
    aggregate.capacityFailureRuns += run.capacityFailure ? 1 : 0;
    aggregate.inventorySnapshots.push(...run.inventorySnapshots);
    const preBossResults = run.combatResults.filter(result => !result.boss);
    const strongIndices = preBossResults.filter(result => result.hasStrongEnemy).map(result => result.combatIndex);
    aggregate.runStrongFightCounts.push(strongIndices.length);
    const endpoint = run.extracted ? 'extracted' : run.dead ? 'death' : run.bossCount ? 'boss' : 'abnormal';
    aggregate.endpointStrongFightCounts[endpoint].push(strongIndices.length);
    if (strongIndices.length) aggregate.firstStrongFightIndices.push(strongIndices[0]);
    if (run.bossCount && !strongIndices.length) aggregate.reachedBossWithoutStrong += 1;
    if (strongIndices.some((value, index) => index > 0 && value === strongIndices[index - 1] + 1)) aggregate.consecutiveStrongRuns += 1;
    run.combatEnteringHp.forEach((hp, index) => { (aggregate.combatEnteringHp[index + 1] ||= []).push(hp); });
    run.combatEndingHp.forEach((hp, index) => { (aggregate.combatEndingHp[index + 1] ||= []).push(hp); });
    aggregate.carriedSilverLost += run.carriedSilverLost;
    mergeRecord(aggregate.consumablesGenerated, run.consumablesGenerated); mergeRecord(aggregate.consumablesAcquired, run.consumablesAcquired); mergeRecord(aggregate.consumablesLeftBehind, run.consumablesLeftBehind); mergeRecord(aggregate.consumablesRemaining, run.consumablesRemaining); aggregate.consumableCapacityFailures += run.consumableCapacityFailures;
    if (run.deathCombatIndex) { addCount(aggregate.deathCombatIndexDistribution, run.deathCombatIndex); aggregate.deathCombatIndices.push(run.deathCombatIndex); }
    run.combatResults.forEach(result => mergeRecord(aggregate.deserterMetrics, result.deserterMetrics || {}));
    ['roomOffered', 'roomOfferedWindows', 'roomChosen', 'hiddenChosen', 'enemyCountDistribution', 'alertModifiers', 'alertLevels', 'enemyAppearances',
      'enemyEncounterAppearances', 'compositions', 'pairings', 'itemQuantities', 'itemCategories', 'dwoeglavCompanions']
      .forEach(key => mergeRecord(aggregate[key], run[key]));
    run.itemsSeen.forEach(name => addCount(aggregate.itemRunAppearances, name));
    run.equipmentSeen.forEach(name => addCount(aggregate.equipmentRunAppearances, name));
    aggregate.encounters += run.encounters;
    aggregate.enemyCount += run.enemyCount;
    aggregate.cursedEncounters += run.cursedEncounterCount;
    aggregate.bosses += run.bossCount;
    aggregate.dwoeglavAppearances += run.dwoeglavAppearances;
    aggregate.dwoeglavEncounters += run.dwoeglavEncounters;
    aggregate.dwoeglavSolo += run.dwoeglavSolo;
    aggregate.duplicateEncounters += run.duplicateEncounters;
    Object.keys(aggregate.phases).forEach(phase => {
      const target = aggregate.phases[phase];
      const source = run.phases[phase];
      target.encounters += source.encounters;
      target.enemyCount += source.enemyCount;
      target.duplicateEncounters += source.duplicateEncounters;
      ['enemyCountDistribution', 'families', 'enemyAppearances', 'enemyEncounterAppearances', 'compositions', 'pairings']
        .forEach(key => mergeRecord(target[key], source[key]));
    });
  }

  const totalWindows = aggregate.windows.reduce((sum, value) => sum + value, 0);
  const totalChosen = Object.values(aggregate.roomChosen).reduce((sum, value) => sum + value, 0);
  const roomTypes = new Set([...Object.keys(aggregate.roomOffered), ...Object.keys(aggregate.roomChosen)]);
  const rooms = {};
  [...roomTypes].sort().forEach(type => {
    const offered = aggregate.roomOffered[type] || 0;
    const chosen = aggregate.roomChosen[type] || 0;
    rooms[type] = {
      offered,
      offeredPerRun: offered / requestedRuns,
      offeredWindowPercentage: totalWindows ? ((aggregate.roomOfferedWindows[type] || 0) / totalWindows) * 100 : 0,
      chosen,
      chosenPerRun: chosen / requestedRuns,
      chosenSharePercentage: totalChosen ? (chosen / totalChosen) * 100 : 0,
    };
  });
  const itemMetrics = {};
  Object.keys(aggregate.itemQuantities).sort((a, b) => a.localeCompare(b, 'ru')).forEach(name => {
    itemMetrics[name] = {
      quantity: aggregate.itemQuantities[name],
      perRun: aggregate.itemQuantities[name] / requestedRuns,
      runPercentage: ((aggregate.itemRunAppearances[name] || 0) / requestedRuns) * 100,
    };
  });

  const bossMaterialName = BOSS_MATERIAL_BY_LOCATION[location.name] || null;
  const structuralByIndexRaw = aggregate.encounterTimeline.reduce((out, encounter) => {
    const metric = (out[encounter.combatIndex] ||= { reached: 0, strongFights: 0, strongEnemyCount: 0, strongEnemyNames: {}, combatTypes: {}, compositions: {} });
    metric.reached += 1; metric.strongFights += encounter.hasStrongEnemy ? 1 : 0; metric.strongEnemyCount += encounter.strongEnemyCount;
    encounter.strongEnemyNames.forEach(name => addCount(metric.strongEnemyNames, name)); addCount(metric.combatTypes, encounter.combatType); addCount(metric.compositions, encounter.composition); return out;
  }, {});
  const structuralByCombatIndex = Object.fromEntries(Object.entries(structuralByIndexRaw).map(([index, metric]) => [index, { reached: metric.reached, strongFights: metric.strongFights, strongFightPercentage: metric.reached ? metric.strongFights / metric.reached * 100 : 0, averageStrongEnemyCount: metric.reached ? metric.strongEnemyCount / metric.reached : 0, strongEnemyNames: sortedRecord(metric.strongEnemyNames), combatTypes: sortedRecord(metric.combatTypes), compositions: sortedRecord(metric.compositions) }]));
  const combatByIndex = aggregate.combatResults.reduce((out, result) => {
    const metric = (out[result.combatIndex] ||= { reached: 0, victories: 0, deaths: 0, enteringHp: [], endingHpAfterVictory: [], consumablesUsed: 0, healingConsumablesUsed: 0, deathsWithHealingRemaining: 0, poulticesCrafted: [], poulticesUsed: [], equipmentFound: [], equipmentEquipped: [], compositionSizes: [], strongPoolAvailable: 0, strongFights: 0, strongEnemyCount: 0, strongEnemyNames: {} });
    metric.reached += 1; metric.victories += result.outcome === 'victory' ? 1 : 0; metric.deaths += result.playerDeath ? 1 : 0;
    metric.enteringHp.push(result.startingPlayerHp); if (result.outcome === 'victory') metric.endingHpAfterVictory.push(result.endingPlayerHp);
    metric.consumablesUsed += result.consumableUses; metric.healingConsumablesUsed += result.healingConsumablesUsed; metric.deathsWithHealingRemaining += result.deathWithHealingRemaining ? 1 : 0; metric.poulticesCrafted.push(result.poulticesCraftedBeforeFight); metric.poulticesUsed.push(result.poulticesUsedBeforeFight); metric.equipmentFound.push(result.equipmentFoundBeforeFight); metric.equipmentEquipped.push(result.equipmentUpgradesEquippedBeforeFight); metric.compositionSizes.push(result.compositionSize);
    metric.strongPoolAvailable += result.strongPoolAvailable ? 1 : 0; metric.strongFights += result.hasStrongEnemy ? 1 : 0; metric.strongEnemyCount += result.strongEnemyCount || 0;
    (result.strongEnemyNames || []).forEach(name => addCount(metric.strongEnemyNames, name)); return out;
  }, {});
  const combatIndexMetrics = Object.fromEntries(Object.entries(combatByIndex).map(([index, metric]) => [index, { reached: metric.reached, victories: metric.victories, deaths: metric.deaths, conditionalDeathRate: metric.reached ? metric.deaths / metric.reached * 100 : 0, enteringHp: summarizeValues(metric.enteringHp), endingHpAfterVictory: summarizeValues(metric.endingHpAfterVictory), consumablesUsed: metric.consumablesUsed, healingConsumablesUsed: metric.healingConsumablesUsed, deathsWithHealingRemaining: metric.deathsWithHealingRemaining, poulticesCraftedBeforeFight: summarizeValues(metric.poulticesCrafted), poulticesUsedBeforeFight: summarizeValues(metric.poulticesUsed), equipmentFoundBeforeFight: summarizeValues(metric.equipmentFound), equipmentUpgradesEquippedBeforeFight: summarizeValues(metric.equipmentEquipped), compositionSize: summarizeValues(metric.compositionSizes), strongPoolAvailable: metric.strongPoolAvailable === metric.reached, strongPoolAvailableRuns: metric.strongPoolAvailable, strongFights: metric.strongFights, strongEnemyCount: metric.strongEnemyCount, strongEnemyNames: sortedRecord(metric.strongEnemyNames) }]));
  const compositionOutcomes = aggregate.combatResults.reduce((out, result) => { const key = result.composition || 'unknown'; const value = (out[key] ||= { fights: 0, victories: 0, deaths: 0, strong: false }); value.fights += 1; value.victories += result.outcome === 'victory' ? 1 : 0; value.deaths += result.playerDeath ? 1 : 0; value.strong ||= result.hasStrongEnemy; return out; }, {});
  const snapshotReports = Object.fromEntries([...new Set(aggregate.inventorySnapshots.map(snapshot => snapshot.checkpoint))].map(checkpoint => {
    const snapshots = aggregate.inventorySnapshots.filter(snapshot => snapshot.checkpoint === checkpoint);
    return [checkpoint, { samples: snapshots.length, capacity: summarizeValues(snapshots.map(value => value.capacity)), occupied: summarizeValues(snapshots.map(value => value.occupied)), sections: Object.fromEntries(['safe', 'general', 'consumable', 'resource'].map(type => [type, { capacity: summarizeValues(snapshots.map(value => value.sections[type].capacity)), occupied: summarizeValues(snapshots.map(value => value.sections[type].occupied)), free: summarizeValues(snapshots.map(value => value.sections[type].free)) }])), contents: checkpoint === 'beforeBoss' ? snapshots.map(value => value.contents) : undefined }];
  }));
  const phaseReports = Object.fromEntries(Object.entries(aggregate.phases).map(([phase, metrics]) => [phase, {
    encounters: metrics.encounters,
    averageEnemyCount: metrics.encounters ? metrics.enemyCount / metrics.encounters : 0,
    enemyCountDistribution: sortedRecord(metrics.enemyCountDistribution),
    duplicateEncounters: metrics.duplicateEncounters,
    duplicateSharePercentage: metrics.encounters ? (metrics.duplicateEncounters / metrics.encounters) * 100 : 0,
    families: Object.fromEntries(Object.keys(metrics.families).sort().map(family => [family, {
      encounters: metrics.families[family],
      sharePercentage: metrics.encounters ? (metrics.families[family] / metrics.encounters) * 100 : 0,
    }])),
    archetypes: Object.fromEntries(Object.keys(metrics.enemyAppearances).sort((a, b) => a.localeCompare(b, 'ru')).map(name => [name, {
      appearances: metrics.enemyAppearances[name],
      encounters: metrics.enemyEncounterAppearances[name] || 0,
      encounterSharePercentage: metrics.encounters ? ((metrics.enemyEncounterAppearances[name] || 0) / metrics.encounters) * 100 : 0,
    }])),
    topCompositions: rankedRecord(metrics.compositions),
    topPairings: rankedRecord(metrics.pairings),
  }]));
  return {
    metadata: { simulator: 'Ashen Abyss Run Simulator', version: RUN_SIMULATOR_VERSION },
    config: { locationId: location.id, locationName: location.name, runs: requestedRuns, seed: batchSeed, policy, maxWindows, combatMode, combatPolicy, bossPolicy: bossPolicy || combatPolicy, balanceVariant: resolvedBalanceVariant.id, balanceVariantStatus: resolvedBalanceVariant.status || 'active', promotedOverrides: resolvedBalanceVariant.promotedOverrides || [], balanceOverrides: resolvedBalanceVariant.overrides, lootPolicy, gearPolicy, craftPolicy, extractionPolicy, classId, profile, build, relicLevel, tuning: tuning.id, progressionThresholds: { ...tuning } },
    routeStateSnapshots: captureRouteStates ? aggregate.routeStateSnapshots : undefined,
    matchedRunOutcomes: aggregate.matchedRunOutcomes,
    resolvedProfile: combatMode === 'simulated' ? aggregate.combatResults[0]?.profile || resolveSimulationPlayerProfile({ profile, classId, build, relicLevel, activeIds, passiveIds, consumables, equipment, progression }).snapshot : null,
    runs: {
      requested: requestedRuns,
      completed: aggregate.completed,
      deaths: aggregate.deaths,
      bossReached: aggregate.bosses,
      routesReachedBoss: aggregate.bosses,
      bossReachRate: aggregate.bosses / requestedRuns * 100,
      bossVictories: combatMode === 'simulated' ? aggregate.completed : null,
      bossDefeats: combatMode === 'simulated' ? aggregate.combatResults.filter(result => result.boss && result.outcome === 'defeat').length : null,
      bossWinRateAmongReached: combatMode === 'simulated' && aggregate.bosses ? aggregate.completed / aggregate.bosses * 100 : null,
      extracted: aggregate.extracted,
      extractionRate: aggregate.extracted / requestedRuns * 100,
      deathsAfterContinue: aggregate.deaths,
      suspiciousExtractions: aggregate.suspiciousExtractions,
      suspiciousExtractionRate: aggregate.extracted ? aggregate.suspiciousExtractions / aggregate.extracted * 100 : 0,
      extractionReasons: sortedRecord(aggregate.extractionReasons),
      extractionHp: summarizeValues(aggregate.extractionHp),
      extractionCombatIndex: summarizeValues(aggregate.extractionCombatIndices),
      extractionCombatIndexDistribution: sortedRecord(aggregate.extractionCombatIndices.reduce((out, value) => { addCount(out, value); return out; }, {})),
      abnormal: aggregate.abnormal,
      abnormalReasons: sortedRecord(aggregate.abnormalReasons),
      windows: summarizeValues(aggregate.windows),
      combatsBeforeBoss: summarizeValues(aggregate.combats),
      combatCountDistribution: sortedRecord(aggregate.combats.reduce((record, value) => { addCount(record, value); return record; }, {})),
      bossWindow: summarizeValues(aggregate.bossWindows),
      bossWindowDistribution: sortedRecord(aggregate.bossWindows.reduce((record, value) => { addCount(record, value); return record; }, {})),
    },
    rooms,
    hiddenRoomsChosen: sortedRecord(aggregate.hiddenChosen),
    encounters: {
      total: aggregate.encounters,
      bosses: aggregate.bosses,
      cursed: aggregate.cursedEncounters,
      duplicateEncounters: aggregate.duplicateEncounters,
      duplicateSharePercentage: aggregate.encounters ? (aggregate.duplicateEncounters / aggregate.encounters) * 100 : 0,
      averageEnemyCount: aggregate.encounters ? aggregate.enemyCount / aggregate.encounters : 0,
      enemyCountDistribution: sortedRecord(aggregate.enemyCountDistribution),
      alertModifiers: sortedRecord(aggregate.alertModifiers),
      alertLevels: sortedRecord(aggregate.alertLevels),
      archetypes: Object.fromEntries(Object.keys(aggregate.enemyAppearances).sort((a, b) => a.localeCompare(b, 'ru')).map(name => [name, {
        appearances: aggregate.enemyAppearances[name],
        encounterPercentage: aggregate.encounters ? ((aggregate.enemyEncounterAppearances[name] || 0) / aggregate.encounters) * 100 : 0,
      }])),
      topCompositions: rankedRecord(aggregate.compositions),
      topPairings: rankedRecord(aggregate.pairings),
      phases: phaseReports,
      structuralByCombatIndex,
    },
    dwoeglav: {
      appearances: aggregate.dwoeglavAppearances,
      encounters: aggregate.dwoeglavEncounters,
      soloEncounters: aggregate.dwoeglavSolo,
      topCompanions: rankedRecord(aggregate.dwoeglavCompanions),
    },
    economy: {
      silver: { total: aggregate.silver.reduce((sum, value) => sum + value, 0), ...summarizeValues(aggregate.silver) },
      silverGenerated: aggregate.silverGenerated,
      silverSecured: aggregate.silverSecured,
      categories: sortedRecord(aggregate.itemCategories),
      items: itemMetrics,
      equipment: Object.fromEntries(Object.entries(itemMetrics).filter(([name]) => findItemData(name)?.type === 'equipment')),
      bossGuaranteedReward: bossMaterialName ? {
        name: bossMaterialName,
        quantity: aggregate.itemQuantities[bossMaterialName] || 0,
        runsWithReward: aggregate.itemRunAppearances[bossMaterialName] || 0,
        completedRunAppearancePercentage: aggregate.completed
          ? ((aggregate.itemRunAppearances[bossMaterialName] || 0) / aggregate.completed) * 100
          : 0,
      } : null,
      topDrops: rankedRecord(aggregate.itemQuantities),
      carriedSilverLostOnDeath: aggregate.carriedSilverLost,
      persistentSilverAfter: summarizeValues(aggregate.persistentSilverAfter),
      inventory: {
        itemFlow: Object.fromEntries(Object.entries(aggregate.itemFlow).map(([key, value]) => [key, sortedRecord(value)])),
        capacityFailureRuns: aggregate.capacityFailureRuns,
        capacityFailureRunPercentage: aggregate.capacityFailureRuns / requestedRuns * 100,
        snapshots: snapshotReports,
      },
    },
    modeling: {
      authoritative: ['room offers and gates', 'ordinary/cursed/boss encounters', 'resource loot', 'treasure loot', 'encounter rewards', ...(combatMode === 'simulated' ? ['production combat outcomes', 'between-combat HP attrition'] : [])],
      notModeled: [combatMode === 'abstract' ? 'combat outcomes and resource use; reaching the boss is a structural route result, not a victory' : 'equipment sale-value optimization', 'human win rate (combat policy results are synthetic)', 'discarding low-value loot to make room for valuable loot', 'lockpick failure', 'secret trap rewards', 'fishing rewards', 'altar choices'],
    },
    simulatedCombat: combatMode === 'simulated' ? {
      fights: aggregate.combatResults.length,
      victories: aggregate.combatResults.filter(result => result.outcome === 'victory').length,
      averageActions: aggregate.combatResults.length ? aggregate.combatResults.reduce((sum, result) => sum + result.actions, 0) / aggregate.combatResults.length : 0,
      averageCombatsSurvived: aggregate.combatResults.length / requestedRuns,
      deathCombatIndexDistribution: sortedRecord(aggregate.deathCombatIndexDistribution),
      deathCombatIndex: summarizeValues(aggregate.deathCombatIndices),
      enteringHpByCombatIndex: Object.fromEntries(Object.entries(aggregate.combatEnteringHp).map(([index, values]) => [index, summarizeValues(values)])),
      endingHpByCombatIndex: Object.fromEntries(Object.entries(aggregate.combatEndingHp).map(([index, values]) => [index, summarizeValues(values)])),
      consumableUses: aggregate.combatResults.reduce((sum, result) => sum + result.consumableUses, 0),
      consumableUsage: aggregate.combatResults.reduce((out, result) => { Object.entries(result.consumableUsage).forEach(([id, count]) => { out[id] = (out[id] || 0) + count; }); return out; }, {}),
      abilityUsage: aggregate.combatResults.reduce((out, result) => { Object.entries(result.abilityUsage || {}).forEach(([id, count]) => { out[id] = (out[id] || 0) + count; }); return out; }, {}),
      actionDiversity: new Set(aggregate.combatResults.flatMap(result => result.decisionIds || [])).size,
      consumableUsesByCombatIndex: Object.fromEntries(Object.entries(aggregate.combatResults.reduce((out, result) => { (out[result.combatIndex] ||= []).push(result.consumableUses); return out; }, {})).map(([index, values]) => [index, summarizeValues(values)])),
      deathsWithHealingRemaining: aggregate.combatResults.filter(result => result.playerDeath && Object.keys(result.itemsRemaining).some(name => getItemDefinition(name)?.type === 'heal')).length,
      deathHealingClassification: aggregate.combatResults.filter(result => result.playerDeath).reduce((out, result) => { const diagnostic = result.healingAtDeath || {}; if (diagnostic.physicallyRemaining) out.physicallyRemaining += 1; if (diagnostic.availableOnLastPlayerTurn) out.availableOnLastPlayerTurn += 1; if (diagnostic.availableButNotChosen) out.availableButNotChosen += 1; if (diagnostic.diedBeforeNextAction) out.diedBeforeNextAction += 1; if (diagnostic.unavailableReason) out.unavailableReasons[diagnostic.unavailableReason] = (out.unavailableReasons[diagnostic.unavailableReason] || 0) + 1; return out; }, { physicallyRemaining: 0, availableOnLastPlayerTurn: 0, availableButNotChosen: 0, diedBeforeNextAction: 0, unavailableReasons: {} }),
      deathsAfterHealingExhausted: aggregate.combatResults.filter(result => result.playerDeath && !Object.keys(result.itemsRemaining).some(name => getItemDefinition(name)?.type === 'heal')).length,
      consumablesGenerated: sortedRecord(aggregate.consumablesGenerated), consumablesAcquired: sortedRecord(aggregate.consumablesAcquired), consumablesLeftBehind: sortedRecord(aggregate.consumablesLeftBehind), consumableCapacityFailures: aggregate.consumableCapacityFailures,
      consumablesRemaining: sortedRecord(aggregate.consumablesRemaining),
      gear: { evaluations: aggregate.gearEvaluations, equipped: aggregate.gearEquipped },
      usedByItemId: aggregate.combatResults.reduce((out, result) => { Object.entries(result.consumableUsage || {}).forEach(([id, count]) => addCount(out, id, count)); return out; }, { ...aggregate.fieldConsumableUsage }),
      combatConsumableUsage: aggregate.combatResults.reduce((out, result) => { Object.entries(result.consumableUsage || {}).forEach(([id, count]) => addCount(out, id, count)); return out; }, {}),
      poisonMetrics: aggregate.combatResults.reduce((out, result) => { Object.entries(result.poisonMetrics || {}).forEach(([id, value]) => { out[id] = (out[id] || 0) + value; }); return out; }, {}),
      lethalWindows: { deathsFrom55PlusHp: aggregate.combatResults.filter(result => result.lethalWindow?.atLeast55Percent).length, byPattern: aggregate.combatResults.filter(result => result.lethalWindow).reduce((out, result) => { const key = result.lethalWindow.damagePattern; out[key] = (out[key] || 0) + 1; return out; }, {}) },
      fieldConsumableUsage: sortedRecord(aggregate.fieldConsumableUsage),
      recruitSealExtraLoot: sortedRecord(aggregate.recruitSealExtraLoot),
      fieldCrafting: { poulticesCrafted: aggregate.poulticesCrafted, poulticesUsed: aggregate.poulticesUsed, poulticesPreserved: aggregate.poulticesPreserved, hpRestored: aggregate.poulticeHpRestored },
      deserterMetrics: sortedRecord(aggregate.deserterMetrics),
      profile: aggregate.combatResults[0]?.profile || null,
      replayableBossEntryStates: aggregate.bossEntryStates,
      byCombatIndex: combatIndexMetrics,
      strongEncounters: {
        firstStrongFightDistribution: sortedRecord(aggregate.firstStrongFightIndices.reduce((out, value) => { addCount(out, value); return out; }, {})),
        strongFightsBeforeBoss: { ...summarizeValues(aggregate.runStrongFightCounts), distribution: sortedRecord(aggregate.runStrongFightCounts.reduce((out, value) => { addCount(out, value); return out; }, {})) },
        strongFightsByEndpoint: Object.fromEntries(Object.entries(aggregate.endpointStrongFightCounts).map(([endpoint, values]) => [endpoint, { ...summarizeValues(values), distribution: sortedRecord(values.reduce((out, value) => { addCount(out, value); return out; }, {})) }])),
        reachedBossWithoutStrong: aggregate.reachedBossWithoutStrong,
        reachedBossWithoutStrongPercentage: aggregate.bosses ? aggregate.reachedBossWithoutStrong / aggregate.bosses * 100 : 0,
        runsWithConsecutiveStrongFights: aggregate.consecutiveStrongRuns,
        consecutiveStrongFightRunPercentage: requestedRuns ? aggregate.consecutiveStrongRuns / requestedRuns * 100 : 0,
        encounterClasses: Object.fromEntries(['ordinary', 'strong'].map(kind => { const values = aggregate.combatResults.filter(result => !result.boss && (kind === 'strong' ? result.hasStrongEnemy : !result.hasStrongEnemy)); const victories = values.filter(result => result.outcome === 'victory').length; const deaths = values.filter(result => result.playerDeath).length; return [kind, { fights: values.length, victories, deaths, winRate: values.length ? victories / values.length * 100 : 0, deathRate: values.length ? deaths / values.length * 100 : 0 }]; })),
        dangerousCompositionsMinimumFights: 5,
        dangerousCompositions: Object.entries(compositionOutcomes).filter(([, value]) => value.fights >= 5).map(([composition, value]) => ({ composition, ...value, winRate: value.victories / value.fights * 100, deathRate: value.deaths / value.fights * 100 })).sort((left, right) => right.deathRate - left.deathRate || right.fights - left.fights).slice(0, 20),
      },
    } : null,
  };
};

const formatNumber = value => Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

export const formatRunSimulationReport = report => {
  const lines = [
    'ASHEN ABYSS RUN SIMULATOR', '',
    `Location: ${report.config.locationName}`,
    `Runs: ${formatNumber(report.config.runs)}`,
    `Seed: ${report.config.seed}`,
    `Policy: ${report.config.policy}`, '',
    `Combat mode: ${report.config.combatMode}${report.config.combatMode === 'simulated' ? ` | combat policy: ${report.config.combatPolicy} | class: ${report.config.classId}` : ''}`,
    `Tuning: ${report.config.tuning} (strong ${report.config.progressionThresholds.strongEnemyUnlock}, boss ${report.config.progressionThresholds.bossUnlock})`,
    report.config.combatMode === 'abstract' ? 'STRUCTURAL ROUTE SIMULATION — boss reach is not a player victory.' : 'Synthetic combat-policy results — not a measured human win rate.',
    'RUN LENGTH',
    `Completed: ${formatNumber(report.runs.completed)} | Deaths: ${formatNumber(report.runs.deaths)} | Abnormal: ${formatNumber(report.runs.abnormal)}`,
    `Windows avg/median/p90: ${formatNumber(report.runs.windows.mean)} / ${formatNumber(report.runs.windows.median)} / ${formatNumber(report.runs.windows.p90)}`,
    `Combats before boss avg: ${formatNumber(report.runs.combatsBeforeBoss.mean)}`,
    `Boss window p10/p50/p90: ${formatNumber(report.runs.bossWindow.p10)} / ${formatNumber(report.runs.bossWindow.median)} / ${formatNumber(report.runs.bossWindow.p90)}`, '',
    'ROOMS',
    ...Object.entries(report.rooms).map(([type, metric]) => `${type.padEnd(14)} offered/run ${formatNumber(metric.offeredPerRun)} | chosen/run ${formatNumber(metric.chosenPerRun)} | share ${formatNumber(metric.chosenSharePercentage)}%`), '',
    'ENCOUNTERS',
    `Total: ${formatNumber(report.encounters.total)} | avg enemies: ${formatNumber(report.encounters.averageEnemyCount)} | cursed: ${formatNumber(report.encounters.cursed)}`,
    'Top compositions:',
    ...report.encounters.topCompositions.slice(0, 8).map((entry, index) => `${index + 1}. ${entry.name}: ${formatNumber(entry.count)}`), '',
    'PHASES',
    ...Object.entries(report.encounters.phases).flatMap(([phase, metrics]) => [
      `${phase.toUpperCase()} — encounters ${formatNumber(metrics.encounters)}, avg enemies ${formatNumber(metrics.averageEnemyCount)}, duplicates ${formatNumber(metrics.duplicateSharePercentage)}%`,
      `Families: ${Object.entries(metrics.families).map(([family, value]) => `${family} ${formatNumber(value.sharePercentage)}%`).join(', ') || 'none'}`,
      ...metrics.topCompositions.slice(0, 5).map((entry, index) => `  ${index + 1}. ${entry.name}: ${formatNumber(entry.count)}`),
    ]), '',
    'DWOEGLAV',
    `Appearances: ${formatNumber(report.dwoeglav.appearances)} | encounters: ${formatNumber(report.dwoeglav.encounters)} | solo: ${formatNumber(report.dwoeglav.soloEncounters)}`,
    `Top companions: ${report.dwoeglav.topCompanions.slice(0, 5).map(entry => `${entry.name} (${entry.count})`).join(', ') || 'none'}`, '',
    'ECONOMY',
    `Silver/run mean/median/p90: ${formatNumber(report.economy.silver.mean)} / ${formatNumber(report.economy.silver.median)} / ${formatNumber(report.economy.silver.p90)}`,
    `Categories: ${Object.entries(report.economy.categories).map(([name, count]) => `${name} ${formatNumber(count / report.config.runs)}/run`).join(', ') || 'none'}`,
    `Top drops: ${report.economy.topDrops.slice(0, 8).map(entry => `${entry.name} (${entry.count})`).join(', ') || 'none'}`,
    ...(report.simulatedCombat ? ['', 'SIMULATED COMBAT',
      `Fights: ${formatNumber(report.simulatedCombat.fights)} | victories: ${formatNumber(report.simulatedCombat.victories)} | avg actions: ${formatNumber(report.simulatedCombat.averageActions)}`,
      `Average combats survived: ${formatNumber(report.simulatedCombat.averageCombatsSurvived)}`,
      `Carried Silver lost on death: ${formatNumber(report.economy.carriedSilverLostOnDeath)}`,
    ] : []),
  ];
  return lines.join('\n');
};

// The legacy window model above remains separate from the actual hex comparison.
export { createHexCraftingRoute, simulateHexCraftingRun } from './hexCraftingSimulator';
