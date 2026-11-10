import { normalizeFieldLoadout } from '../data/fieldCraftingLoadout';
import { initializeQuestLog } from '../data/quests';
import { resetLocationRoomGenerationState } from './roomGeneration';
import { migrateRunInventory, RUN_INVENTORY_LAYOUT_VERSION } from './expeditionInventory';
import { LEVEL_TWO_LOCATIONS } from '../data/locations';
import { createExpeditionMapRun, isExpeditionMapFeatureEnabled } from './expeditionMapRun';

export const prepareFreshDungeonRun = (playerState, locationName) => {
  if (!playerState || !locationName) return playerState;
  const freshHp = Math.max(0, playerState.maxHp ?? playerState.baseStats?.maxHp ?? playerState.hp ?? 0);
  const equippedIds = new Set(Object.values(playerState.equipment || {}).map(item => item?.instanceId).filter(Boolean));
  const sourceInventory = migrateRunInventory(playerState.runInventory || [], playerState.equipment, playerState.runInventoryLayoutVersion);
  const hasOwnershipConflict = sourceInventory.some(item => item?.instanceId && equippedIds.has(item.instanceId));
  const runInventory = hasOwnershipConflict
    ? sourceInventory.map(item => item?.instanceId && equippedIds.has(item.instanceId) ? null : item)
    : sourceInventory;
  const { inventory: legacyInventory, safeSlots: legacySafeSlots, ...canonicalPlayer } = playerState;
  const expeditionMap = isExpeditionMapFeatureEnabled()
    ? createExpeditionMapRun({ locationId: locationName, abyssLevel: 1 })
    : undefined;
  return {
    ...canonicalPlayer,
    fieldCraftingRunLoadout: normalizeFieldLoadout(playerState.fieldCraftingLoadout),
    abyssLevel: 1,
    expeditionPhase: 'exploring',
    bossClearId: null,
    hp: freshHp,
    currentLocation: locationName,
    currentEnemies: undefined,
    currentCombatRoomType: null,
    isBoss: false,
    currentDungeonChoices: null,
    currentDungeonChoicesLocation: null,
    currentPathEvent: null,
    activeCombat: null,
    preCombatEffects: [],
    preparedTrap: null,
    portalStone: null,
    curses: {},
    dominantCurseId: null,
    runSilver: 0,
    runResonance: 0,
    lastStandConsumed: false,
    _lastStandConsumed: false,
    runInventory,
    runInventoryLayoutVersion: RUN_INVENTORY_LAYOUT_VERSION,
    roomGenerationState: resetLocationRoomGenerationState(playerState.roomGenerationState || {}, locationName),
    expeditionMap,
    expeditionMapRoomActive: false,
    activeExpeditionZone: null,
    activeSublocationId: null,
    activeSublocationEffectId: null,
  };
};

export const resetDungeonRunState = (playerState) => {
  if (!playerState) return playerState;
  const effectiveMaxHp = Math.max(
    0,
    playerState.maxHp ?? playerState.baseStats?.maxHp ?? playerState.hp ?? 0
  );

  return {
    ...playerState,
    fieldCraftingRunLoadout: null,
    abyssLevel: null,
    expeditionPhase: null,
    bossClearId: null,
    hp: effectiveMaxHp,
    shield: 0,
    effects: [],
    turnMeter: 0,
    currentLocation: null,
    currentEnemies: undefined,
    currentCombatRoomType: null,
    isBoss: false,
    preCombatEffects: [],
    preparedTrap: null,
    items: undefined,
    _equipmentBattleFlags: {},
    _equipmentTurnFlags: {},
    portalStone: null,
    currentDungeonChoices: null,
    currentDungeonChoicesLocation: null,
    currentPathEvent: null,
    activeCombat: null,
    curses: {},
    dominantCurseId: null,
    roomGenerationState: {},
    expeditionMap: undefined,
    expeditionMapRoomActive: false,
    activeExpeditionZone: null,
    activeSublocationId: null,
    activeSublocationEffectId: null,
    questLog: initializeQuestLog(playerState.questLog),
  };
};

export const prepareLevelTwoSelection = playerState => {
  if (!playerState
    || Number(playerState.abyssLevel) > 1
    || (playerState.expeditionPhase !== 'boss-defeated' && playerState.portalStone?.acquiredFrom !== 'boss')) return null;
  const cleared = { ...playerState, portalStone: null };
  const firstLevelLocation = cleared.currentLocation;
  return {
    ...cleared,
    abyssLevel: 2,
    expeditionPhase: 'level-selection',
    bossClearId: cleared.bossClearId || `legacy-boss:${firstLevelLocation}`,
    currentLocation: null,
    currentEnemies: undefined,
    currentCombatRoomType: null,
    isBoss: false,
    // All level-II counters start fresh after the floor-I boss. A previously
    // visited mine/ruin must not retain strong or boss unlock progress.
    roomGenerationState: LEVEL_TWO_LOCATIONS.reduce(
      (state, location) => resetLocationRoomGenerationState(state, location.name),
      firstLevelLocation
        ? resetLocationRoomGenerationState(cleared.roomGenerationState, firstLevelLocation)
        : cleared.roomGenerationState,
    ),
    currentDungeonChoices: null,
    currentDungeonChoicesLocation: null,
    currentPathEvent: null,
    activeExpeditionZone: null,
    activeSublocationId: null,
    activeSublocationEffectId: null,
  };
};

// The roster PR can enable its registry entry and reuse this transition without
// the level-one fresh-run reset (which would heal and discard run resources).
export const prepareLevelTwoDungeonRun = (playerState, locationName) => {
  if (!playerState || playerState.abyssLevel !== 2 || playerState.expeditionPhase !== 'level-selection' || !locationName) return null;
  return {
    ...playerState,
    currentLocation: locationName,
    expeditionPhase: 'exploring',
    currentEnemies: undefined,
    currentCombatRoomType: null,
    isBoss: false,
    currentDungeonChoices: null,
    currentDungeonChoicesLocation: null,
    currentPathEvent: null,
    roomGenerationState: resetLocationRoomGenerationState(playerState.roomGenerationState, locationName),
    // Create an independent map after selecting a second-floor location;
    // never retain the first-floor geometry when descending.
    expeditionMap: isExpeditionMapFeatureEnabled()
      ? createExpeditionMapRun({ locationId: locationName, abyssLevel: 2 })
      : undefined,
    expeditionMapRoomActive: false,
    activeExpeditionZone: null,
    activeSublocationId: null,
    activeSublocationEffectId: null,
  };
};
