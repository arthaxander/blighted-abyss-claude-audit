import { getAltarCurseIds } from './altarChoices';
import { getEligibleCursePool } from '../data/curses';
import { ALTAR_POLICIES, resolveSimulationCurseState, advanceSimulationAltar, chooseSimulationAltar } from './simulationAltars';
import { craftSelectedFieldRecipe } from './fieldCrafting';
import { enemies } from '../data/enemies';
import { HEX_SIMULATION_LOCATIONS } from './hexSimulationScenarios';
import { findItemData, rollTreasureLoot } from '../data/items';
import { getSelectedFieldRecipes } from '../data/fieldCraftingLoadout';
import { getSublocationDefinition } from '../data/expeditionSublocations';
import { createExpeditionMapRun, moveExpeditionRun, resolveCurrentExpeditionCell, setPendingExpeditionCellContent } from './expeditionMapRun';
import { getAdjacentCellIds } from './expeditionMapLayout';
import { buildRoomPayload, ROOM_TYPES, SECRET_TYPES } from './roomGeneration';
import { createWitheringForestEncounter, createRestlessRuinsEncounter, createMinesOfDecayEncounter, createCursedEncounter, createGoblinNestsEncounter, createMushroomCavesEncounter, createDeserterCampEncounter, applyDeserterAlertModifier, getTrashEnemyPool, getCursedEnemyPool, GOBLIN_LOCATION, FUNGAL_LOCATION } from './enemyPools';
import { createSeededSimulationRng, deriveSimulationSeed } from './simulationRng';
import { applyAbyssPowerToEnemy } from './abyssPower';
import { resolveEncounterRewards, createEncounterRewardRoster } from './encounterRewards';
import { resolveSimulationPlayerProfile } from './simulationPlayerProfiles';
import { simulateCombat } from './combatSimulator';
import { reconcileCombatConsumables } from './combatRunPersistence';
import { getRunInventoryLayout, insertItems, migrateRunInventory, RUN_INVENTORY_LAYOUT_VERSION } from './expeditionInventory';
import { applyFieldCraftingPolicy } from './fieldCraftingPolicy';

const phaseOf = run => run.state.progress.depthUnlocked ? 'depth' : run.state.selectedSublocationId ? 'sublocation' : 'approach';
const addCounts = (out, source) => Object.entries(source || {}).forEach(([key, n]) => { out[key] = (out[key] || 0) + n; });
const supplies = player => (player.runInventory || []).filter(stack => stack && findItemData(stack.itemId)?.type === 'consumable').reduce((out, stack) => ({ ...out, [stack.itemId]: (out[stack.itemId] || 0) + stack.quantity }), {});

// Full-clear traversal is held fixed across crafting policies. Every step is validated
// by the game's movement/key authority. No old room-window simulator is used here.
const nextPath = (run, sublocationSlot) => {
  const phase = phaseOf(run);
  const selected = run.state.selectedSublocationId;
  const remaining = run.mainLayout.cells.filter(cell => cell.region === phase && cell.significant && !cell.resolved && (phase !== 'sublocation' || cell.sublocationId === selected));
  const gate = phase === 'approach'
    ? run.mainLayout.cells.find(cell => cell.landmark?.type === 'sublocation-entrance' && cell.sublocationId === run.state.availableSublocationIds[sublocationSlot])?.id
    : phase === 'sublocation' ? run.mainLayout.depthEntryCellIds[selected] : run.mainLayout.bossCellId;
  const goals = new Set(remaining.length ? remaining.map(cell => cell.id) : [gate]);
  const queue = [[run.mainLayout.currentCellId]];
  const seen = new Set(queue[0]);
  while (queue.length) {
    const path = queue.shift();
    const tail = path[path.length - 1];
    if (path.length > 1 && goals.has(tail)) return path.slice(1);
    for (const id of getAdjacentCellIds(run.mainLayout, tail)) {
      if (seen.has(id)) continue;
      const cell = run.mainLayout.cells.find(entry => entry.id === id);
      if (!goals.has(id) && cell.region !== phase && !(phase === 'sublocation' && cell.region === 'approach')) continue;
      const probe = { ...run, mainLayout: { ...run.mainLayout, currentCellId: tail } };
      if (!moveExpeditionRun(probe, id, { rng: () => 0.5 }).moved) continue;
      seen.add(id);
      queue.push([...path, id]);
    }
  }
  throw new Error(`No legal route from ${run.mainLayout.currentCellId} in ${phase}`);
};

export const createHexCraftingRoute = ({ location = 'goblin', seed = 1, templateId, sublocationSlot = 0, initialCurses = {}, altarPolicy = 'accept', preferredCurseId = null, abyssLevel } = {}) => {
  const definition = HEX_SIMULATION_LOCATIONS.find(entry => entry.id === location || entry.name === location);
  if (!definition?.combatSupported) throw new Error('Для этой локации ещё нет готовой боевой модели');
  if (![0, 1, 2].includes(sublocationSlot)) throw new Error('Invalid sublocation slot');
  const floor = abyssLevel ?? definition.abyssLevel;
  if (!Number.isInteger(floor) || floor < 1 || floor > 6) throw new Error('Invalid abyss level');
  if (!ALTAR_POLICIES.includes(altarPolicy)) throw new Error('Invalid altar policy');
  let curseState = resolveSimulationCurseState(initialCurses, floor);
  const startingCurses = curseState.curses;
  const mapRng = createSeededSimulationRng(seed);
  let run = createExpeditionMapRun({ locationId: definition.name, templateId, abyssLevel: floor, curses: startingCurses, rng: mapRng });
  const local = enemies.filter(enemy => enemy.location === definition.name);
  const bossEnemy = local.find(enemy => enemy.boss);
  if (!bossEnemy) throw new Error(`Missing authored boss for ${definition.name}`);
  const nonBossEnemies = local.filter(enemy => !enemy.boss);
  const cursedPool = getCursedEnemyPool(nonBossEnemies);
  const route = [];
  let completed = 0;
  let movementSteps = 0;
  let previousTemplateKey = null;
  for (let guard = 0; guard < 1000; guard++) {
    const path = nextPath(run, sublocationSlot);
    for (const id of path) {
      const moved = moveExpeditionRun(run, id, { rng: mapRng });
      if (!moved.moved) throw new Error(`Illegal route step: ${moved.reason}`);
      run = moved.run;
      movementSteps++;
      if (run.pendingCellId) break;
    }
    if (!run.pendingCellId) continue;
    const cell = run.mainLayout.cells.find(entry => entry.id === run.pendingCellId);
    const index = route.length;
    const rng = createSeededSimulationRng(deriveSimulationSeed(seed, index + 100));
    const sublocation = getSublocationDefinition(definition.name, cell.sublocationId);
    const directDepthFight = cell.region === 'depth' && [ROOM_TYPES.COMBAT, ROOM_TYPES.CURSED_ENEMY].includes(cell.previewRoomType);
    const requireStrong = cell.region === 'sublocation' || directDepthFight;
    const progress = requireStrong ? Number.MAX_SAFE_INTEGER : completed;
    const pool = getTrashEnemyPool({ nonBossEnemies, selectedLocation: definition.name, completedCombatRooms: progress, expeditionRegion: cell.region });
    const buildFightEncounter = kind => {
      let encounter;
      if (kind === 'cursed') encounter = createCursedEncounter(cursedPool, rng, { weightOf: enemy => sublocation?.effectId === 'cursed-rubble' && /Оскверн|Искаж/i.test(enemy.name) ? 3 : 1 });
      else {
        const options = { completedCombatRooms: progress, requireStrong, preferredStrongEnemies: sublocation?.preferredStrongEnemies || [], preferredMultiplier: 4, expeditionRegion: cell.region };
        if (definition.name === GOBLIN_LOCATION) encounter = createGoblinNestsEncounter(pool, rng, options);
        else if (definition.name === FUNGAL_LOCATION) encounter = createMushroomCavesEncounter(pool, rng, options);
        else if (definition.id === 'withering_forest') encounter = createWitheringForestEncounter(pool, rng, { ...options, previousTemplateKey });
        else if (definition.id === 'restless_ruins') encounter = createRestlessRuinsEncounter(pool, rng, options);
        else if (definition.id === 'mines_of_decay') encounter = createMinesOfDecayEncounter(pool, rng, { ...options, previousTemplateKey });
        else if (definition.id === 'deserter') encounter = applyDeserterAlertModifier({ ...createDeserterCampEncounter(pool, rng, options), completedCombatRooms: progress, pool, rng });
        else throw new Error(`Missing encounter generator for ${definition.id}`);
      }
      previousTemplateKey = encounter?.encounterTemplateKey || previousTemplateKey;
      if (!encounter?.enemies?.length) throw new Error('Missing authored encounter');
      return directDepthFight ? { ...encounter, enemies: encounter.enemies.map(enemy => applyAbyssPowerToEnemy(enemy)) } : encounter;
    };
    let room = buildRoomPayload(cell.previewRoomType, {
      locationName: definition.name, rng, state: { completedCombatRooms: completed }, bossEnemy,
      hasBossEnemy: true, hasCursedEnemyPool: cursedPool.length > 0, buildFightEncounter,
      rollChestLoot: primordialSource => rollTreasureLoot(definition.name, 2, 3, { primordialSource, expeditionZone: cell.region, sublocationId: cell.sublocationId, rng }),
      cursePool: getEligibleCursePool(curseState.curses, curseState.dominantCurseId, floor), allowSecretCurseAltar: false,
    });
    if (room.roomType === ROOM_TYPES.SECRET) room = { ...(room.hiddenPayload || {}), roomType: room.hiddenRoomType };
    const combat = Boolean(room.enemies?.length);
    const loot = combat ? resolveEncounterRewards({ roster: createEncounterRewardRoster(room.enemies), location: definition.name, expeditionZone: cell.region, sublocationId: cell.sublocationId }, rng).items : room.loot || [];
    if (room.roomType === ROOM_TYPES.CURSE_ALTAR) {
      room = { ...room, curseId: chooseSimulationAltar(curseState, getAltarCurseIds(room), floor, altarPolicy, preferredCurseId) };
      curseState = advanceSimulationAltar(curseState, room.curseId, floor, altarPolicy);
    }
    route.push({ curseIds: room.curseIds, curseId: room.curseId, cellId: cell.id, phase: cell.region, sublocationId: cell.sublocationId, effectId: sublocation?.effectId, roomType: room.roomType, enemies: room.enemies || [], loot, trapDamage: room.roomType === SECRET_TYPES.TRAP ? room.damage || 10 : 0, seed: deriveSimulationSeed(seed, index + 5000) });
    if (combat) completed++;
    run = resolveCurrentExpeditionCell(setPendingExpeditionCellContent(run, room), { rng: mapRng });
    if (cell.region === 'boss') return { version: 'hex-board-v2', abyssLevel: floor, initialCurses: startingCurses, altarPolicy, preferredCurseId, altarBudget: run.state.altarBudget, templateId: run.mainLayout.templateId, movementSteps, seed, location: definition, route, steps: guard + 1, selectedSublocationId: run.state.selectedSublocationId };
  }
  throw new Error('Hex route guard exceeded');
};

export const measureCraftingOpportunity = player => {
  const recipes = getSelectedFieldRecipes(player);
  const available = recipes.filter(recipe => craftSelectedFieldRecipe(player, recipe).success).map(recipe => recipe.name);
  // Separate alternatives, not a sum: recipes compete for the same materials.
  const repeatable = Object.fromEntries(recipes.map(recipe => {
    let next = player; let n = 0;
    while (n < 100) { const result = craftSelectedFieldRecipe(next, recipe); if (!result.success) break; next = result.player; n++; }
    return [recipe.name, n];
  }));
  return { available, repeatable, carried: supplies(player) };
};

export const simulateHexCraftingRun = ({ route: authoredRoute, location = 'goblin', seed = 1, classId = 'Defender', profile = 'fresh', craftPolicy = 'off', disabledCategories = [], playerOptions = {}, templateId, sublocationSlot = 0, combatPolicy = 'competent', bossPolicy = combatPolicy, initialCurses = {}, altarPolicy = 'accept', preferredCurseId = null } = {}) => {
  const authored = authoredRoute || createHexCraftingRoute({ location, seed, templateId, sublocationSlot, initialCurses, altarPolicy, preferredCurseId });
  const initial = resolveSimulationPlayerProfile({ ...playerOptions, classId, profile }).player;
  const floor = authored.abyssLevel || authored.location.abyssLevel || 1;
  let player = { ...initial, ...resolveSimulationCurseState(authored.initialCurses || initialCurses, floor), abyssLevel: floor, currentLocation: authored.location.name, runInventory: migrateRunInventory(initial.runInventory, initial.equipment, initial.runInventoryLayoutVersion), runInventoryLayoutVersion: RUN_INVENTORY_LAYOUT_VERSION };
  const metrics = { seed, classId, profile, craftPolicy, location: authored.location.id, outcome: 'incomplete', altars: { visited: 0, accepted: 0, skipped: 0 }, crafted: {}, used: {}, trapUsed: {}, ingredientsConsumed: {}, resourcesAcquired: {}, lootLeftBehind: {}, missingIngredients: 0, noSpace: 0, hpRestored: 0, phases: {}, encounters: 0, abnormal: false, combats: [] };
  let previousPhase = null;
  for (const cell of authored.route) {
    if (cell.phase !== previousPhase) {
      metrics.phases[cell.phase] = { ...measureCraftingOpportunity(player), hp: player.hp, maxHp: player.maxHp, curses: player.curses };
      previousPhase = cell.phase;
    }
    if (cell.roomType === ROOM_TYPES.CURSE_ALTAR) {
      const next = advanceSimulationAltar(player, cell.curseId, floor, authored.altarPolicy || altarPolicy);
      metrics.altars.visited++;
      metrics.altars[next.accepted ? 'accepted' : 'skipped']++;
      player = { ...player, curses: next.curses, dominantCurseId: next.dominantCurseId };
    }
    player = { ...player, activeExpeditionZone: cell.phase, activeSublocationId: cell.sublocationId, activeSublocationEffectId: cell.effectId || null };
    if (cell.enemies.length) {
      const hpBeforePreparation = player.hp;
      const preparation = applyFieldCraftingPolicy(player, craftPolicy, { enemies: cell.enemies, rng: createSeededSimulationRng(cell.seed + 1), disabledCategories });
      player = preparation.player;
      for (const key of ['crafted', 'used', 'ingredientsConsumed']) addCounts(metrics[key], preparation.metrics[key]);
      for (const key of ['missingIngredients', 'noSpace', 'hpRestored']) metrics[key] += preparation.metrics[key];
      if (cell.phase === 'boss') metrics.beforeBoss = measureCraftingOpportunity(player);
      const combat = simulateCombat({ player, enemies: cell.enemies, location: authored.location.id, seed: cell.seed, policy: cell.phase === 'boss' ? bossPolicy : combatPolicy });
      metrics.combats.push({ cellId: cell.cellId, phase: cell.phase, curses: player.curses, enemies: cell.enemies.map(e => e.name), hpBeforePreparation, startingHp: player.hp, endingHp: combat.endingPlayerHp, maxHp: player.maxHp, outcome: combat.outcome, playerTurns: combat.playerTurns, enemyTurns: combat.enemyTurns, used: combat.consumableUsage });
      metrics.encounters++;
      addCounts(metrics.used, combat.consumableUsage);
      addCounts(metrics.trapUsed, combat.fieldTrapUsage);
      player = { ...reconcileCombatConsumables(player, combat.player), hp: combat.endingPlayerHp, preCombatEffects: [] };
      if (combat.outcome !== 'victory') { metrics.outcome = combat.outcome; metrics.abnormal = combat.abnormal; break; }
    }
    player = { ...player, hp: Math.max(0, player.hp - cell.trapDamage) };
    if (player.hp <= 0) { metrics.outcome = 'defeat'; break; }
    for (const item of cell.loot) {
      if (findItemData(item.name)?.type === 'currency') continue;
      const inserted = insertItems(player.runInventory, [{ itemId: item.name, quantity: item.quantity }], { layout: getRunInventoryLayout(player.equipment) });
      const rejected = inserted.rejected.reduce((n, stack) => n + stack.quantity, 0);
      if (rejected) metrics.lootLeftBehind[item.name] = (metrics.lootLeftBehind[item.name] || 0) + rejected;
      if (findItemData(item.name)?.type === 'material') metrics.resourcesAcquired[item.name] = (metrics.resourcesAcquired[item.name] || 0) + item.quantity - rejected;
      player = { ...player, runInventory: inserted.slots };
    }
    if (cell.phase === 'boss') metrics.outcome = 'victory';
  }
  metrics.endingCurses = player.curses;
  metrics.dominantCurseId = player.dominantCurseId;
  metrics.endingHp = player.hp;
  metrics.remaining = supplies(player);
  return metrics;
};

