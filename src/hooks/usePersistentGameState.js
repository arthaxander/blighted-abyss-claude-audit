import { normalizeBossClears, hydrateBossClears, recordBossClear } from '../utils/autobattleUnlocks';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useAccount } from '../contexts/AccountContext';
import { hydratePlayerSnapshot, buildPlayerSnapshot } from '../utils/playerState';
import { ensureRelicState } from '../data/relics';
import { SAFE_SLOT_LIMIT } from '../constants/gameplay';
import { normalizeStorage } from '../utils/storageManagement';
import { migrateLegacyRunes } from '../utils/runeSockets';
import { applyClassLoadoutToPlayer, ensureClassProgression } from '../data/classProgression';
import { createItemStack, normalizeInventorySlots, SAFE_SLOT_COUNT } from '../utils/expeditionInventory';
import { LEVEL_TWO_LOCATIONS, isLocationAvailable } from '../data/locations';
import { sanitizeForCombatSnapshot } from '../utils/combatSnapshot';

export const STORAGE_VERSION = 7;

const nameFromEntry = (entry) => (typeof entry === 'string' ? entry : entry?.name || '');

export const normalizeStorageItems = (items = []) => normalizeStorage(items);

// The top-level value is the canonical persistent copy. Saves from before it was
// introduced can have progression only on the player; an empty migration shell
// must not erase that older, populated copy.
const selectCanonicalClassProgression = parsed => {
  const root = parsed?.classProgression;
  const embedded = parsed?.player?.classProgression;
  if (root && (Object.keys(root).length > 0 || !embedded)) return root;
  return embedded || root;
};

const equipmentNames = (equipment = []) => {
  if (Array.isArray(equipment)) return equipment.filter(Boolean);
  if (!equipment || typeof equipment !== 'object') return [];
  return Object.values(equipment).filter(Boolean);
};

export const sanitizeSafeSlots = (safeSlots = [], inventory = [], equipment = []) => {
  const allowedNames = new Set([
    ...(inventory || []).map(nameFromEntry),
    ...equipmentNames(equipment),
  ]);
  const result = [];
  (safeSlots || []).forEach(entry => {
    if (allowedNames.has(entry?.name || entry)) {
      result.push(entry?.name || entry);
    }
  });
  return result.slice(0, SAFE_SLOT_LIMIT);
};

const initialState = {
  version: STORAGE_VERSION,
  player: null,
  currentScreen: 'character',
  encountersCleared: 0,
  locationEncounterCounters: {},
  clearedBossLocations: [],
  storageItems: [],
  carryOverRunInventory: normalizeInventorySlots([], SAFE_SLOT_COUNT),
  carryOverSilver: 0,
  arenaBattle: null,
  relicState: ensureRelicState(),
  classProgression: ensureClassProgression(),
  activeCombat: null,
  pendingLoot: null,
  deathSummary: null,
  vendorPurchaseState: { periodId: null, counts: {} },
};

export const getFreshPersistentGameState = () => ({
  ...initialState,
  locationEncounterCounters: {},
  clearedBossLocations: [],
  storageItems: [],
  carryOverRunInventory: normalizeInventorySlots([], SAFE_SLOT_COUNT),
  carryOverSilver: 0,
  relicState: ensureRelicState(),
  classProgression: ensureClassProgression(),
  vendorPurchaseState: { periodId: null, counts: {} },
});

export const hydratePersistentGameState = (parsed, { levelTwoLocations = LEVEL_TWO_LOCATIONS } = {}) => {
  if (!parsed || typeof parsed !== 'object') return getFreshPersistentGameState();
  let hydrationStage = 'PLAYER';
  try {
    if (parsed.player != null && (typeof parsed.player !== 'object' || Array.isArray(parsed.player))) {
      throw new Error('invalid-player-shape');
    }
    const needsClassHpMigration = parsed.player && (parsed.classProgression?.[parsed.player.class]?.schemaVersion || parsed.player.classProgression?.[parsed.player.class]?.schemaVersion || 0) < 2;
    const legacyHpRatio = parsed.player?.maxHp > 0 ? Math.max(0, Math.min(1, (parsed.player.hp ?? parsed.player.maxHp) / parsed.player.maxHp)) : 1;
    const authoritativeProgression = selectCanonicalClassProgression(parsed);
    let restoredPlayer = parsed.player ? hydratePlayerSnapshot({ ...parsed.player, classProgression: authoritativeProgression }) : null;
    const blockedLevelTwoNames = new Set(levelTwoLocations.filter(location => !isLocationAvailable(location)).map(location => location.name));
    const knownLevelTwoNames = new Set(levelTwoLocations.map(location => location.name));
    // A saved location can be unreachable for two different reasons: it exists
    // in the catalog but is switched off, or its name is no longer part of the
    // catalog at all (renamed or removed content). Both must return the player
    // to Level 2 selection instead of resuming a dungeon nobody can enter.
    const isLevelTwoRun = Number(restoredPlayer?.abyssLevel) >= 2 && restoredPlayer?.currentLocation != null;
    const locationIsBlocked = blockedLevelTwoNames.has(restoredPlayer?.currentLocation);
    const locationIsUnknown = !knownLevelTwoNames.has(restoredPlayer?.currentLocation);
    const recoveredFromUnavailableLevelTwo = isLevelTwoRun && (locationIsBlocked || locationIsUnknown);
    // A combat reward that has not been picked up yet must stay reachable: the
    // combat loot screen is the only surface that can grant its silver, special
    // rewards and boss clear.
    const hasUnclaimedCombatLoot = parsed.pendingLoot?.source === 'combat'
      && Boolean(parsed.activeCombat?.battleResult);
    if (recoveredFromUnavailableLevelTwo) {
      restoredPlayer = {
        ...restoredPlayer,
        currentLocation: null,
        currentEnemies: undefined,
        currentCombatRoomType: null,
        currentDungeonChoices: null,
        currentDungeonChoicesLocation: null,
        currentPathEvent: null,
        expeditionPhase: 'level-selection',
      };
    }
    hydrationStage = 'STORAGE';
    let restoredStorage = normalizeStorageItems(parsed.storageItems);
    if (restoredPlayer?.runes && (Object.values(restoredPlayer.runes.slots || {}).some(Boolean) || restoredPlayer.runes.inventory?.length)) {
      const migration = migrateLegacyRunes({ equipment: restoredPlayer.equipment, runes: restoredPlayer.runes, storage: restoredStorage });
      restoredPlayer = { ...restoredPlayer, equipment: migration.equipment, runes: migration.runes, pendingRuneMigration: migration.pendingRuneMigration };
      restoredStorage = migration.storage;
    }
    hydrationStage = 'PROGRESSION';
    const classProgression = ensureClassProgression(authoritativeProgression || restoredPlayer?.classProgression, restoredPlayer);
    if (restoredPlayer) restoredPlayer = { ...restoredPlayer, classProgression, ...(needsClassHpMigration ? { hp:Math.round(restoredPlayer.maxHp * legacyHpRatio), classHpMigrationVersion:1 } : {}) };
    hydrationStage = 'CARRY_OVER';
    // Older payloads sometimes contain a malformed legacy carryOverItems
    // field. Salvage the rest of the account instead of trapping the player
    // behind a total reset for one invalid optional inventory container.
    const legacyCarryOver = Array.isArray(parsed.carryOverItems) ? parsed.carryOverItems : [];
    const carryOverRunInventory = Array.isArray(parsed.carryOverRunInventory)
      ? normalizeInventorySlots(parsed.carryOverRunInventory, SAFE_SLOT_COUNT)
      : normalizeInventorySlots(legacyCarryOver.slice(0, SAFE_SLOT_COUNT).map(item => createItemStack(item)), SAFE_SLOT_COUNT);
    return {
      version: STORAGE_VERSION,
      player: restoredPlayer,
      currentScreen: recoveredFromUnavailableLevelTwo
        ? (hasUnclaimedCombatLoot ? 'combatLoot' : 'levelTwoLocationSelect')
        : ['arena', 'arenaCombat'].includes(parsed.currentScreen) ? 'guild' : parsed.currentScreen || 'guild',
      encountersCleared: parsed.encountersCleared || 0,
      locationEncounterCounters: parsed.locationEncounterCounters || {},
      storageItems: restoredStorage,
      carryOverRunInventory,
      carryOverSilver: Math.max(0, Number(parsed.carryOverSilver) || 0),
      arenaBattle: null,
      relicState: ensureRelicState(parsed.relicState),
      classProgression,
      // A combat tied to an unreachable location can never be resumed, so the
      // run state is dropped. One exception: a finished battle whose reward is
      // still unclaimed. That snapshot is the only thing that knows the
      // encounter, the boss flag and the loot roll, so keeping it is what makes
      // the reward claimable at all; it can never reopen a dead location.
      activeCombat: recoveredFromUnavailableLevelTwo && !hasUnclaimedCombatLoot ? null : parsed.activeCombat || null,
      clearedBossLocations: hydrateBossClears(parsed),
      // After the reward is taken the player must land on Level 2 selection,
      // not in the dungeon whose location no longer exists. The marker is only
      // meaningful for a reward recovered in this load: it must not survive into
      // a save where the location is reachable again.
      pendingLoot: parsed.pendingLoot
        ? (recoveredFromUnavailableLevelTwo && hasUnclaimedCombatLoot
          ? { ...parsed.pendingLoot, recoveredFromUnavailableLocation: true }
          : (({ recoveredFromUnavailableLocation, ...rest }) => rest)(parsed.pendingLoot))
        : null,
      deathSummary: parsed.deathSummary || null,
      vendorPurchaseState: parsed.vendorPurchaseState && typeof parsed.vendorPurchaseState === 'object'
        ? { periodId: parsed.vendorPurchaseState.periodId || null, counts: { ...(parsed.vendorPurchaseState.counts || {}) } }
        : { periodId: null, counts: {} },
    };
  } catch (error) {
    console.warn('Ошибка чтения серверного сохранения', error);
    return {
      ...getFreshPersistentGameState(),
      hydrationError: 'Не удалось восстановить существующее сохранение. Ваш прогресс не изменён.',
      hydrationErrorCode: `HYDRATE_${hydrationStage}`,
      unhydratedSave: parsed,
    };
  }
};

const canonicalizeLevelTwoSaveLocation = player => {
  if (!player || Number(player.abyssLevel) < 2 || player.currentLocation == null) return player;
  const findEnabledLocation = value => {
    if (typeof value !== 'string') return null;
    const key = value.trim();
    return LEVEL_TWO_LOCATIONS.find(location => (
      isLocationAvailable(location) && (location.name === key || location.id === key)
    )) || null;
  };
  const direct = findEnabledLocation(player.currentLocation);
  const fallback = direct || findEnabledLocation(player.currentDungeonChoicesLocation);
  if (!fallback) return player;
  return {
    ...player,
    currentLocation: fallback.name,
    ...(player.currentDungeonChoicesLocation
      ? { currentDungeonChoicesLocation: fallback.name }
      : {}),
  };
};

export const serializePersistentGameState = state => {
  // Hydration and the reducer own normalization. Serialization must be a pure
  // snapshot operation: in particular, rebuilding a combatant's loadout here
  // recalculates stats/abilities and creates a second progression object whose
  // key insertion order can differ from the top-level copy.
  const classProgression = state.classProgression;
  const playerSnapshot = state.player ? canonicalizeLevelTwoSaveLocation(buildPlayerSnapshot(state.player)) : null;
  // Both wire locations deliberately share the one canonical value. Do not
  // independently normalize the embedded compatibility copy.
  const player = playerSnapshot ? { ...playerSnapshot, classProgression } : null;
  return {
    version: STORAGE_VERSION,
    player,
    currentScreen: state.currentScreen,
    encountersCleared: state.encountersCleared,
    locationEncounterCounters: state.locationEncounterCounters,
    clearedBossLocations: normalizeBossClears(state.clearedBossLocations),
    storageItems: state.storageItems,
    carryOverRunInventory: normalizeInventorySlots(state.carryOverRunInventory, SAFE_SLOT_COUNT),
    carryOverSilver: state.carryOverSilver,
    relicState: state.relicState,
    classProgression,
    activeCombat: state.activeCombat ? sanitizeForCombatSnapshot(state.activeCombat) : null,
    pendingLoot: state.pendingLoot,
    deathSummary: state.deathSummary,
    vendorPurchaseState: state.vendorPurchaseState,
  };
};

export const getSaveErrorCode = error => {
  const source = error?.code || (Number.isInteger(error?.status) ? `HTTP_${error.status}` : 'UNKNOWN');
  const detail = String(source)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32) || 'UNKNOWN';
  return `SAVE_${detail}`;
};

const reducer = (state, action) => {
  switch (action.type) {
    case 'set-player': {
      const nextPlayer =
        typeof action.payload === 'function'
          ? action.payload(state.player)
          : action.payload;
      return { ...state, player: nextPlayer ? { ...nextPlayer, classProgression: state.classProgression } : nextPlayer };
    }
    case 'set-screen':
      return { ...state, currentScreen: action.payload };
    case 'start-dungeon-run':
      return {
        ...state,
        player: { ...action.payload, classProgression: state.classProgression },
        currentScreen: 'dungeon',
        activeCombat: null,
      };
    case 'enter-level-two-selection': {
      const nextPlayer = action.payload?.player;
      const previousLocationName = action.payload?.previousLocationName;
      return {
        ...state,
        player: nextPlayer ? { ...nextPlayer, classProgression: state.classProgression } : state.player,
        currentScreen: 'levelTwoLocationSelect',
        activeCombat: null,
        locationEncounterCounters: previousLocationName
          ? { ...state.locationEncounterCounters, [previousLocationName]: 0 }
          : state.locationEncounterCounters,
      };
    }
    case 'set-encounters':
      return { ...state, encountersCleared: action.payload };
    case 'set-location-encounters':
      return { ...state, locationEncounterCounters: action.payload };
    case 'set-arena-battle':
      return { ...state, arenaBattle: action.payload };
    case 'set-storage': {
      const nextStorageItems =
        typeof action.payload === 'function'
          ? action.payload(state.storageItems)
          : action.payload;
      return { ...state, storageItems: normalizeStorageItems(nextStorageItems) };
    }
    case 'commit-storage-player':
      return {
        ...state,
        player: { ...action.payload.player, classProgression: state.classProgression },
        storageItems: normalizeStorageItems(action.payload.storageItems),
        vendorPurchaseState: Object.prototype.hasOwnProperty.call(action.payload, 'vendorPurchaseState')
          ? action.payload.vendorPurchaseState
          : state.vendorPurchaseState,
      };
    case 'set-carry-over':
      return { ...state, carryOverRunInventory: normalizeInventorySlots(action.payload, SAFE_SLOT_COUNT) };
    case 'set-carry-over-silver':
      return { ...state, carryOverSilver: Math.max(0, Number(action.payload) || 0) };
    case 'set-relic-state':
      return { ...state, relicState: ensureRelicState(action.payload) };
    case 'set-class-progression': {
      const next = typeof action.payload === 'function' ? action.payload(state.classProgression) : action.payload;
      const classProgression = ensureClassProgression(next, state.player);
      return {
        ...state,
        classProgression,
        player: state.player ? applyClassLoadoutToPlayer(state.player, classProgression) : state.player,
      };
    }
    case 'record-boss-clear':
      return { ...state, clearedBossLocations: recordBossClear(state.clearedBossLocations, action.payload) };
    case 'set-active-combat':
      return { ...state, activeCombat: (typeof action.payload === 'function' ? action.payload(state.activeCombat) : action.payload) || null };
    case 'set-pending-loot':
      return { ...state, pendingLoot: (typeof action.payload === 'function' ? action.payload(state.pendingLoot) : action.payload) || null };
    case 'set-death-summary':
      return { ...state, deathSummary: action.payload || null };
    case 'reset':
      return getFreshPersistentGameState();
    default:
      return state;
  }
};

export const usePersistentGameState = () => {
  const account = useAccount();
  const [state, dispatch] = useReducer(reducer, account.account?.save, hydratePersistentGameState);
  const [saveError, setSaveError] = useState(null);
  const [saveRetrying, setSaveRetrying] = useState(false);
  const [resetError, setResetError] = useState(null);
  const [resetting, setResetting] = useState(false);
  const suppressNextSaveRef = useRef(false);
  const suppressLoadedSaveRef = useRef(Boolean(account.account?.save));
  const saveRequestRef = useRef(0);

  useEffect(() => {
    if (!account.authoritative || !account.saveGameState || state.hydrationError) return;
    // Loading an existing server save is not a player mutation. Apart from
    // avoiding a redundant write, this prevents migrations from being persisted
    // before the player has had a chance to inspect the restored state.
    if (suppressLoadedSaveRef.current) { suppressLoadedSaveRef.current = false; return; }
    if (suppressNextSaveRef.current) { suppressNextSaveRef.current = false; return; }
    const requestId = ++saveRequestRef.current;
    account.saveGameState(serializePersistentGameState(state))
      .then(() => {
        if (requestId === saveRequestRef.current) setSaveError(null);
      })
      .catch(error => {
        if (requestId !== saveRequestRef.current) return;
        console.warn('Ошибка серверного сохранения', error.message);
        setSaveError({
          code: getSaveErrorCode(error),
          message: 'Сервер отклонил сохранение. Последние изменения не подтверждены.',
          diagnostic: error.diagnostic || null,
        });
      });
  }, [state, account]);

  const setPlayer = useCallback((updater) => {
    dispatch({ type: 'set-player', payload: updater });
  }, []);

  const setCurrentScreen = useCallback((screen) => dispatch({ type: 'set-screen', payload: screen }), []);
  const startDungeonRun = useCallback((player) => dispatch({ type: 'start-dungeon-run', payload: player }), []);
  const enterLevelTwoSelection = useCallback((player, previousLocationName = null) => {
    dispatch({ type: 'enter-level-two-selection', payload: { player, previousLocationName } });
  }, []);
  const setEncountersCleared = useCallback((value) => dispatch({ type: 'set-encounters', payload: value }), []);
  const setLocationEncounterCounters = useCallback(
    (value) => {
      const nextValue = typeof value === 'function' ? value(state.locationEncounterCounters) : value;
      dispatch({ type: 'set-location-encounters', payload: nextValue });
    },
    [state.locationEncounterCounters]
  );
  const setArenaBattle = useCallback((payload) => dispatch({ type: 'set-arena-battle', payload }), []);
  const setStorageItems = useCallback((items) => dispatch({ type: 'set-storage', payload: items }), []);
  const commitStoragePlayer = useCallback((payload) => dispatch({ type: 'commit-storage-player', payload }), []);
  const setCarryOverRunInventory = useCallback((slots) => dispatch({ type: 'set-carry-over', payload: slots }), []);
  const setCarryOverSilver = useCallback((silver) => dispatch({ type: 'set-carry-over-silver', payload: silver }), []);
  const setRelicState = useCallback((payload) => dispatch({ type: 'set-relic-state', payload }), []);
  const setClassProgression = useCallback((payload) => dispatch({ type: 'set-class-progression', payload }), []);
  const recordLocationBossClear = useCallback(location => dispatch({ type: 'record-boss-clear', payload: location }), []);
  const setActiveCombat = useCallback((payload) => dispatch({ type: 'set-active-combat', payload }), []);
  // Autobattle choices are durable before revealing a result or entering manual play.
  const commitActiveCombat = useCallback(async snapshot => {
    const next = { ...state, currentScreen: 'combat', activeCombat: snapshot };
    if (account.authoritative) {
      if (!account.saveGameState || state.hydrationError) throw new Error('Saving unavailable');
      await account.saveGameState(serializePersistentGameState(next));
    }
    dispatch({ type: 'set-active-combat', payload: snapshot });
  }, [account, state]);

  const setPendingLoot = useCallback((payload) => dispatch({ type: 'set-pending-loot', payload }), []);
  const setDeathSummary = useCallback((payload) => dispatch({ type: 'set-death-summary', payload }), []);
  const retryPersistentSave = useCallback(async () => {
    if (!account.authoritative || !account.saveGameState || state.hydrationError) return;
    const requestId = ++saveRequestRef.current;
    setSaveRetrying(true);
    try {
      await account.saveGameState(serializePersistentGameState(state));
      if (requestId === saveRequestRef.current) setSaveError(null);
    } catch (error) {
      if (requestId === saveRequestRef.current) setSaveError({
        code: getSaveErrorCode(error),
        message: 'Сервер отклонил сохранение. Последние изменения не подтверждены.',
        diagnostic: error.diagnostic || null,
      });
    } finally {
      setSaveRetrying(false);
    }
  }, [account, state]);
  const retryPersistentLoad = useCallback(() => window.location.reload(), []);
  const resetCorruptSave = useCallback(async () => {
    if (!state.hydrationError || (!account.resetGameState && !account.replaceGameState)) return;
    setResetting(true);
    setResetError(null);
    const fresh = getFreshPersistentGameState();
    try {
      if (account.resetGameState) await account.resetGameState();
      else await account.replaceGameState(serializePersistentGameState(fresh));
      // A corrupt loaded save never reached the normal initial-save guard because
      // hydrationError short-circuited the effect. Consume that stale guard here;
      // suppressNextSaveRef is exclusively for the reset dispatch below. This
      // ensures the first subsequent user transition is persisted.
      suppressLoadedSaveRef.current = false;
      suppressNextSaveRef.current = true;
      dispatch({ type: 'reset' });
    } catch (error) {
      console.warn('Ошибка сброса серверного сохранения', error.message);
      setResetError('Сервер не смог удалить игровой прогресс. Сохранение не изменено.');
    } finally {
      setResetting(false);
    }
  }, [account, state.hydrationError]);

  const value = useMemo(() => ({
    ...state,
    saveError,
    saveRetrying,
    retryPersistentSave,
    resetError,
    resetting,
    resetCorruptSave,
    retryPersistentLoad,
    setPlayer,
    setCurrentScreen,
    startDungeonRun,
    enterLevelTwoSelection,
    setEncountersCleared,
    setLocationEncounterCounters,
    setArenaBattle,
    setStorageItems,
    commitStoragePlayer,
    setCarryOverRunInventory,
    setCarryOverSilver,
    setRelicState,
    setClassProgression,
    setActiveCombat,
    recordLocationBossClear,
    commitActiveCombat,
    setPendingLoot,
    setDeathSummary,
    reset: () => dispatch({ type: 'reset' }),
  }), [
    state,
    saveError,
    saveRetrying,
    retryPersistentSave,
    resetError,
    resetting,
    resetCorruptSave,
    retryPersistentLoad,
    setPlayer,
    setCurrentScreen,
    startDungeonRun,
    enterLevelTwoSelection,
    setEncountersCleared,
    setLocationEncounterCounters,
    setArenaBattle,
    setStorageItems,
    commitStoragePlayer,
    setCarryOverRunInventory,
    setCarryOverSilver,
    setRelicState,
    setClassProgression,
    setActiveCombat,
    recordLocationBossClear,
    commitActiveCombat,
    setPendingLoot,
    setDeathSummary,
  ]);

  return value;
};


