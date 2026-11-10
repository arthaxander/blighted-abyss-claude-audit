import { isAutobattleUnlocked } from './utils/autobattleUnlocks';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CombatScreen from './components/CombatScreen';
import AssetBundleGate from './components/AssetBundleGate';
import { getLocationImageBundleId } from './data/imageBundles';
import AutobattleScreen from './components/AutobattleScreen';
import { evaluateBattleStatus } from './utils/combatUtils';
import CustomCombatScreen from './components/CustomCombatScreen';
import GuildScreen from './components/GuildScreen';
import LocationSelectionScreen from './components/LocationSelectionScreen';
import CharacterSelectionScreen from './components/CharacterSelectionScreen';
import DeathSummary from './components/DeathSummary';
import ProgressionFeedback from './components/ProgressionFeedback';
import ClassRewardFeedback, { createClassRewardEvent } from './components/ClassRewardFeedback';
import RelicResonanceTransfer from './components/RelicResonanceTransfer';
import GuildDevPanel from './components/GuildDevPanel';
import DevMinigameSandbox from './components/DevMinigameSandbox';
import { CLASS_LEVEL_CAP, applyClassLoadoutToPlayer, ensureClassProgression, grantClassExperience } from './data/classProgression';
import DungeonScreen from './components/DungeonScreen';
import ExpeditionMapScreen from './components/ExpeditionMapScreen';
import PendingLootModal from './components/PendingLootModal';
import InventoryGridModal from './components/InventoryGridModal';
import ItemDetailsModal from './components/ItemDetailsModal';
import CombatLootScreen from './components/CombatLootScreen';
import ConfirmDialog from './components/ui/ConfirmDialog';
import { findItemData, normalizeItemName } from './data/items';
import { ensureRelicState, grantAllRelics, grantRelicExperience } from './data/relics';
import { shouldShowRelicResonanceTransfer, transferRunResonance } from './utils/abyssResonance';
import {
  initializeQuestLog,
  processQuestEvents,
  QUEST_EVENTS,
  applyRunInventoryQuestProgress,
} from './data/quests';
import { ensureArenaProfile } from './utils/playerState';
import { applyTarotPostVictoryEffects } from './data/tarotCards';
import { usePersistentGameState } from './hooks/usePersistentGameState';
import { useAccount } from './contexts/AccountContext';
import { useToast } from './contexts/UIContext';
import { createEmptyEquipmentSlots, getEquippedItemNames, normalizeEquipmentLoadout } from './utils/equipmentManager';
import { incrementCompletedCombatRooms, resetLocationRoomGenerationState, ROOM_TYPES } from './utils/roomGeneration';
import { prepareFreshDungeonRun, prepareLevelTwoDungeonRun, prepareLevelTwoSelection, resetDungeonRunState } from './utils/dungeonRunState';
import { LEVEL_TWO_LOCATIONS, isLocationAvailable } from './data/locations';
import { getAppViewportOverride, isActiveCombatScreen, shouldShowAppNavigation } from './utils/appShell';
import { canAccessCustomCombat, createCustomCombatSandbox } from './utils/customCombat';
import { commitPendingLoot, createPendingLoot } from './utils/pendingLoot';
import { warmPendingLootArt } from './utils/lootArtPreload';
import { createExpeditionDeathResult, extractRunInventory, getRunInventoryLayout, hasOrdinaryFreeInventorySlot, insertItems, legacyInventoryToSlots, migrateRunInventory, unloadRunInventoryToStash } from './utils/expeditionInventory';
import { depositIntoStorage, getStorageEntryId, sellStorageSelection } from './utils/storageManagement';
import { getRuneById } from './data/runes';
import { applyInventoryItemUse } from './utils/inventoryItemUse';
import { switchPlayerClass } from './utils/developerClassSwitch';
import { claimGuildQuestReward, purchaseGuildVendorItem } from './utils/guildTransactions';
import { addGuildSilver } from './utils/guildCurrency';
import { depositRunInventoryEntry, equipStorageEntry, withdrawStorageEntry } from './utils/storageTransactions';
import { reconcileCombatConsumables, resolveCombatPlayerFromBattleResult, resolvePostCombatVitals } from './utils/combatRunPersistence';
import { rollRecruitSealExtraLoot } from './utils/recruitSealRewards';
import { useAppMusic } from './audio/useAppMusic';
import { useAppSfx } from './audio/useAppSfx';
import { playSfx } from './audio/sfxController';
import { isAbyssBound } from './data/curses';
import {
  applyPendingExpeditionKeyRoll,
  cancelPendingExpeditionCell,
  dismissExpeditionKeyNotice,
  EXPEDITION_KEY_REWARD_NAMES,
  getActiveExpeditionLayout,
  isExpeditionMapFeatureEnabled,
  moveExpeditionRun,
  previewPendingExpeditionKeyRoll,
  reconcileExpeditionKeyGuarantees,
  resolveCurrentExpeditionCell,
  setExpeditionMapRuntimeEnabled,
  setPendingExpeditionCellContent,
} from './utils/expeditionMapRun';

const PORTAL_STONE_NAME = 'Камень портала';
const PORTAL_STONE_RANDOM_MIN_FIGHTS = 2;
const PORTAL_STONE_RANDOM_CHANCE = 0.12;

const isValidActiveCombatSnapshot = (snapshot) => Boolean(
  snapshot?.state &&
  Array.isArray(snapshot.state.players) &&
  snapshot.state.players[0] &&
  Array.isArray(snapshot.state.enemies)
);

const shouldLogLifecycleDiagnostics = () => process.env.NODE_ENV !== 'production';

const getCombatHp = (unit) => unit?.hp;

const getEnemyCount = (enemies) => (Array.isArray(enemies) ? enemies.filter(Boolean).length : 0);

const getCombatInputDiagnostics = ({
  player,
  currentScreen,
  activeCombat,
  pendingCombat,
  pendingCombatRefValue,
  freshCombatIntent,
  combatEntrySource,
}) => ({
  combatEntrySource,
  currentScreen,
  activeCombatPresent: Boolean(activeCombat),
  pendingCombatPresent: Boolean(pendingCombat),
  pendingCombatRefPresent: Boolean(pendingCombatRefValue),
  freshCombatIntentPresent: Boolean(freshCombatIntent),
  playerPresent: Boolean(player),
  playerHp: getCombatHp(player),
  playerCurrentEnemiesCount: getEnemyCount(player?.currentEnemies),
  currentPathEvent: player?.currentPathEvent || null,
  currentDungeonChoicesCount: getEnemyCount(player?.currentDungeonChoices),
  currentLocation: player?.currentLocation || null,
});

const validateFreshCombatPlayer = (player) => {
  if (!player) return 'missing-player';
  const hp = getCombatHp(player);
  if (!Number.isFinite(hp)) return 'missing-or-non-finite-player-hp';
  if (hp <= 0) return 'fresh-player-hp-not-positive';
  return null;
};

const validateEnemyList = (enemies) => {
  if (!Array.isArray(enemies)) return 'enemies-not-array';
  if (getEnemyCount(enemies) === 0) return 'empty-enemies';
  return null;
};

export const getCombatSnapshotState = (snapshot) => {
  if (!isValidActiveCombatSnapshot(snapshot)) return 'invalid';
  const { victory: enemiesDefeated, defeat: playerDefeated } = evaluateBattleStatus(snapshot);
  if (snapshot.battleResult?.outcome === 'victory') {
    return enemiesDefeated && snapshot.battleResult.loot ? 'terminal-victory' : 'invalid';
  }
  if (snapshot.battleResult?.outcome === 'defeat') {
    return playerDefeated ? 'terminal-defeat' : 'invalid';
  }
  if (enemiesDefeated) return 'legacy-terminal-victory';
  if (playerDefeated) return 'legacy-terminal-defeat';
  return 'active';
};

const validateActiveCombatSnapshot = (snapshot) => {
  if (!snapshot) return 'missing-active-combat';
  if (!snapshot.state) return 'active-combat-missing-state';
  const snapshotPlayer = snapshot.state.players?.[0];
  if (!snapshotPlayer) return 'active-combat-missing-player';
  if (!Number.isFinite(getCombatHp(snapshotPlayer))) return 'active-combat-player-hp-invalid';
  const enemyError = validateEnemyList(snapshot.state.enemies);
  if (enemyError) return `active-combat-${enemyError}`;
  if (getCombatSnapshotState(snapshot) === 'invalid') return 'active-combat-invalid-terminal-result';
  return null;
};

export const validateCombatInput = ({
  player,
  pendingCombat,
  pendingCombatRefValue,
  activeCombat,
}) => {
  const hasPendingCombat = Boolean(pendingCombat);
  const freshCombatIntent = pendingCombat || pendingCombatRefValue || null;
  const validActiveCombat = isValidActiveCombatSnapshot(activeCombat) ? activeCombat : null;
  const warnings = [];

  if (freshCombatIntent && activeCombat) {
    warnings.push('fresh-combat-intent-and-active-combat-both-present');
  }
  if (pendingCombat && activeCombat) {
    warnings.push('pending-combat-and-active-combat-both-present');
  }
  if (pendingCombat && pendingCombatRefValue && pendingCombat !== pendingCombatRefValue) {
    warnings.push('pending-combat-state-and-ref-disagree');
  }

  if (freshCombatIntent) {
    const source = hasPendingCombat ? 'pendingCombatState' : 'pendingCombatRef';
    const playerError = validateFreshCombatPlayer(player);
    const enemyError = validateEnemyList(freshCombatIntent.enemies);
    const reasons = [playerError, enemyError].filter(Boolean);
    return {
      isValid: reasons.length === 0,
      source,
      freshCombatIntent,
      validActiveCombat,
      enemies: freshCombatIntent.enemies || [],
      isBoss: Boolean(freshCombatIntent.isBoss),
      initialCombatSnapshot: null,
      reasons,
      warnings,
      usedPlayerCurrentEnemiesFallback: false,
    };
  }

  if (validActiveCombat) {
    const activeError = validateActiveCombatSnapshot(validActiveCombat);
    return {
      isValid: !activeError,
      source: 'activeCombatSnapshot',
      freshCombatIntent: null,
      validActiveCombat,
      enemies: validActiveCombat.state?.enemies || [],
      isBoss: Boolean(validActiveCombat.isBoss),
      initialCombatSnapshot: validActiveCombat,
      reasons: activeError ? [activeError] : [],
      warnings,
      usedPlayerCurrentEnemiesFallback: false,
    };
  }

  if (Array.isArray(player?.currentEnemies) && player.currentEnemies.length > 0) {
    const playerError = validateFreshCombatPlayer(player);
    const enemyError = validateEnemyList(player.currentEnemies);
    const reasons = [playerError, enemyError].filter(Boolean);
    return {
      isValid: reasons.length === 0,
      source: 'player.currentEnemies-fallback',
      freshCombatIntent: null,
      validActiveCombat: null,
      enemies: player.currentEnemies,
      isBoss: Boolean(player.isBoss),
      initialCombatSnapshot: null,
      reasons,
      warnings: [...warnings, 'using-player-currentEnemies-fallback'],
      usedPlayerCurrentEnemiesFallback: true,
    };
  }

  return {
    isValid: false,
    source: 'invalid',
    freshCombatIntent: null,
    validActiveCombat: null,
    enemies: [],
    isBoss: false,
    initialCombatSnapshot: null,
    reasons: ['no-valid-combat-source'],
    warnings,
    usedPlayerCurrentEnemiesFallback: false,
  };
};

export const acceptCombatSnapshot = ({ snapshot, pendingCombatRef, setPendingCombat, setActiveCombat }) => {
  if (pendingCombatRef) pendingCombatRef.current = null;
  setPendingCombat(null);
  setActiveCombat(snapshot);
};

export const prepareCombatLootResolution = (pendingLoot, player) => {
  if (!pendingLoot || !player) return { committed: false, reason: 'missing-state' };
  const slots = migrateRunInventory(player.runInventory || [], player.equipment, player.runInventoryLayoutVersion);
  return commitPendingLoot(pendingLoot, slots, getRunInventoryLayout(player.equipment));
};

export const resolveNonCombatPendingLoot = (pendingLoot, player) => {
  if (!pendingLoot || !player) return { committed: false, reason: 'missing-state', player };
  const currentSlots = migrateRunInventory(player.runInventory || [], player.equipment, player.runInventoryLayoutVersion);
  const result = commitPendingLoot(pendingLoot, currentSlots, getRunInventoryLayout(player.equipment));
  return result.committed
    ? { ...result, player: applyRunInventoryQuestProgress(player, result.slots) }
    : { ...result, player };
};

const restorePlayerForGuildReturn = resetDungeonRunState;

export const createGuildPlayerAfterDeath = deathResult => {
  if (!deathResult?.player) return null;
  const restored = restorePlayerForGuildReturn(deathResult.player);
  const layout = getRunInventoryLayout(restored.equipment);
  let runInventory = migrateRunInventory(
    restored.runInventory || [],
    restored.equipment,
    restored.runInventoryLayoutVersion
  );
  const insuredStack = deathResult.insurance?.successful ? deathResult.insurance.insuredStack : null;
  if (insuredStack) {
    const insertion = insertItems(runInventory, [insuredStack], { layout, allowSafeFallback: false });
    runInventory = insertion.slots;
  }
  return { ...restored, runInventory };
};


const hasPortalStone = (playerState) => Boolean(playerState?.portalStone?.hasStone);

const grantPortalStone = (playerState, levelId, acquiredFrom = 'drop') => {
  if (!playerState || hasPortalStone(playerState)) return playerState;
  return {
    ...playerState,
    portalStone: {
      hasStone: true,
      levelId: levelId ?? playerState.currentLocation ?? null,
      acquiredFrom,
    },
  };
};

export const createGuildPlayerFromSelection = ({ newPlayer, carryOverRunInventory = [], carryOverSilver = 0, classProgression, relicState }) => {
  const normalizedLoadout = normalizeEquipmentLoadout(
    newPlayer.equipment || createEmptyEquipmentSlots(),
    newPlayer.inventory || [],
    newPlayer.class
  );
  const progressedPlayer = applyClassLoadoutToPlayer(newPlayer, classProgression);
  const { inventory: legacyInventory, safeSlots: legacySafeSlots, ...canonicalPlayer } = progressedPlayer;
  const layout = getRunInventoryLayout(normalizedLoadout.equipment);
  const runInventory = legacyInventoryToSlots(normalizedLoadout.inventory, layout.totalCapacity, [], layout);
  carryOverRunInventory.forEach((stack, index) => { if (stack && index < 2) runInventory[index] = { ...stack }; });
  return {
    ...canonicalPlayer,
    silver: carryOverSilver || progressedPlayer.silver || 0,
    guildSilver: carryOverSilver || progressedPlayer.guildSilver || progressedPlayer.silver || 0,
    tarotSpread: [],
    equipment: normalizedLoadout.equipment,
    runInventory,
    questLog: initializeQuestLog(newPlayer.questLog),
    arenaProfile: ensureArenaProfile(newPlayer.arenaProfile),
    relics: ensureRelicState(relicState),
    classProgression: ensureClassProgression(classProgression, progressedPlayer),
  };
};

export const resolveGuildRelicMetaUpdate = ({ relicState, player }, updater) => {
  const current = ensureRelicState(relicState || player?.relics);
  const next = ensureRelicState(typeof updater === 'function' ? updater(current) : updater);
  return { relicState: next, player: player ? { ...player, relics: next } : player };
};

const App = () => {
  const { account, getServerNow } = useAccount();
  const {
    player,
    setPlayer,
    currentScreen,
    setCurrentScreen,
    startDungeonRun,
    enterLevelTwoSelection,
    locationEncounterCounters,
    setLocationEncounterCounters,
    storageItems: stashedItems,
    setStorageItems: setStashedItems,
    commitStoragePlayer,
    carryOverRunInventory,
    setCarryOverRunInventory,
    carryOverSilver,
    setCarryOverSilver,
    relicState,
    setRelicState,
    classProgression,
    setClassProgression,
    activeCombat,
    setActiveCombat,
    commitActiveCombat,
    clearedBossLocations,
    recordLocationBossClear,
    pendingLoot,
    setPendingLoot,
    deathSummary,
    setDeathSummary,
    vendorPurchaseState,
    hydrationError,
    hydrationErrorCode,
    saveError,
    saveRetrying,
    retryPersistentSave,
    resetError,
    resetting,
    resetCorruptSave,
    retryPersistentLoad,
    reset: resetPersistentGameState,
  } = usePersistentGameState();
  const musicController = useAppMusic(currentScreen, player?.currentLocation || null);
  useAppSfx();
  const { pushToast } = useToast();
  const [portalDialog, setPortalDialog] = useState(null);
  const [pendingCombat, setPendingCombat] = useState(null);
  const [customCombatView, setCustomCombatView] = useState(null);
  const [customCombatSandbox, setCustomCombatSandbox] = useState(null);
  const [devMinigame, setDevMinigame] = useState(null);
  const [expeditionMapDevEnabled, setExpeditionMapDevEnabled] = useState(() => isExpeditionMapFeatureEnabled());
  const [newGameDialogOpen, setNewGameDialogOpen] = useState(false);
  const [corruptResetDialogOpen, setCorruptResetDialogOpen] = useState(false);
  const [inventoryFromLootOpen, setInventoryFromLootOpen] = useState(false);
  const [lootInfoItem, setLootInfoItem] = useState(null);
  const [fullCarryWarningOpen, setFullCarryWarningOpen] = useState(false);
  const [departureInventoryOpen, setDepartureInventoryOpen] = useState(false);
  const [suppressAbandonedLootWarnings, setSuppressAbandonedLootWarnings] = useState(false);
  const [progressionFeedback, setProgressionFeedback] = useState(null);
  const [pendingClassRewardFeedback, setPendingClassRewardFeedback] = useState(null);
  const [classRewardFeedback, setClassRewardFeedback] = useState(null);
  const [bossDialogWaitingForProgression, setBossDialogWaitingForProgression] = useState(false);
  const [resonanceTransfer, setResonanceTransfer] = useState(null);
  const pendingLootRef = useRef(pendingLoot);
  const pendingCombatRef = useRef(null);
  const liveVictoryRewardIdRef = useRef(null);
  const lifecycleWarningKeysRef = useRef(new Set());

  useEffect(() => { pendingLootRef.current = pendingLoot; }, [pendingLoot]);

  // Begin fetching the exact drop icons as soon as loot is rolled, often
  // before the victory presentation transitions into the reward screen.
  useEffect(() => {
    if (pendingLoot?.items?.length) warmPendingLootArt(pendingLoot);
  }, [pendingLoot]);

  const warnLifecycleOnce = useCallback((key, message, details = {}) => {
    if (!shouldLogLifecycleDiagnostics() || lifecycleWarningKeysRef.current.has(key)) return;
    lifecycleWarningKeysRef.current.add(key);
    console.warn(`[lifecycle] ${message}`, details);
  }, []);

  const clearTransientCombatState = useCallback((reason = 'unspecified') => {
    if (shouldLogLifecycleDiagnostics()) {
      console.info('[lifecycle] clearTransientCombatState', {
        reason,
        pendingCombatPresent: Boolean(pendingCombat),
        pendingCombatRefPresent: Boolean(pendingCombatRef.current),
        activeCombatPresent: Boolean(activeCombat),
      });
    }
    pendingCombatRef.current = null;
    setPendingCombat(null);
    setActiveCombat(null);
  }, [activeCombat, pendingCombat, setActiveCombat]);

  const handleCharacterSelect = (newPlayer) => {
    try {
      const guildPlayer = createGuildPlayerFromSelection({ newPlayer, carryOverRunInventory, carryOverSilver, classProgression, relicState });
      clearTransientCombatState('character-selection');
      setPlayer(guildPlayer);
      setCarryOverRunInventory([]);
      setCarryOverSilver(0);
      setLocationEncounterCounters({});
      setCurrentScreen('guild');
    } catch (error) {
      console.warn('Ошибка создания персонажа', error);
      pushToast('Не удалось создать персонажа. Ваше сохранение не изменено.', { tone: 'error' });
    }
  };

  const updatePersistentRelics = useCallback((updater) => {
    const result = resolveGuildRelicMetaUpdate({ relicState, player }, updater);
    setRelicState(result.relicState);
    setPlayer(previous => previous ? { ...previous, relics: result.relicState } : previous);
    return result.relicState;
  }, [player, relicState, setPlayer, setRelicState]);

  const handleVictory = (loot = { silver: 0, items: [] }, isBoss = false, combatPlayer = null, committedRunInventory = null, rewardId = null) => {
    clearTransientCombatState('victory');
    const classXpGain = 100;
    const classAward = grantClassExperience(classProgression, player?.class || 'Defender', classXpGain);
    setClassProgression(classAward.progression);
    const classCanProgress = Boolean(classAward.result && classAward.result.oldLevel < CLASS_LEVEL_CAP);
    const feedbackEvent = classCanProgress ? { classResult: classAward.result, relicXp: 0 } : null;
    setProgressionFeedback(feedbackEvent);
    const classRewardEvent = createClassRewardEvent(classAward.result);
    setPendingClassRewardFeedback(classRewardEvent);
    const encounterLocation = combatPlayer?.currentEnemies?.[0]?.location || player?.currentEnemies?.[0]?.location || null;
    if (isBoss) recordLocationBossClear(encounterLocation || player?.currentLocation);
    const portalStoneReward = loot?.specialRewards?.find(reward => reward.id === 'portal_stone');
    const bossPortalStoneAwarded = portalStoneReward?.acquiredFrom === 'boss';
    const randomPortalStoneAwarded = portalStoneReward?.acquiredFrom === 'drop';

    setPlayer(prev => {
      if (!prev) return prev;
      const runInventory = committedRunInventory || prev.runInventory || [];

      const relics = ensureRelicState(prev.relics || relicState);
      const shouldAdvanceCombatRoom = !isBoss && encounterLocation && [ROOM_TYPES.COMBAT, ROOM_TYPES.CURSED_ENEMY].includes(prev.currentCombatRoomType);
      const nextRoomGenerationState = isBoss && encounterLocation
        ? resetLocationRoomGenerationState(prev.roomGenerationState, encounterLocation)
        : shouldAdvanceCombatRoom
          ? incrementCompletedCombatRooms(prev.roomGenerationState, encounterLocation)
          : prev.roomGenerationState;

      const postCombatVitals = resolvePostCombatVitals(prev, combatPlayer);
      const postCombatPlayer = {
        ...prev,
        ...postCombatVitals,
        lastStandConsumed: Boolean(combatPlayer?.lastStandConsumed || combatPlayer?._lastStandConsumed),
        _lastStandConsumed: Boolean(combatPlayer?.lastStandConsumed || combatPlayer?._lastStandConsumed),
        runInventory,
        runSilver: prev.runSilver || 0,
        runResonance: (prev.runResonance || 0) + Math.max(0, loot?.resonance || 0),
        currentEnemies: undefined,
        currentCombatRoomType: null,
        isBoss: false,
        roomGenerationState: nextRoomGenerationState,
        relics,
        classProgression: classAward.progression,
        preCombatEffects: [],
        preparedTrap: null,
        ...(isBoss ? {
          abyssLevel: Number(prev.abyssLevel) || 1,
          expeditionPhase: 'boss-defeated',
          bossClearId: prev.bossClearId || rewardId || `boss:${encounterLocation}`,
        } : {}),
        questLog: initializeQuestLog(prev.questLog),
      };
      const basePlayer = { ...postCombatPlayer };
      if (getEquippedItemNames(basePlayer.equipment).includes('Куртка Мародёра')) {
        const maxHp = Math.max(0, basePlayer.maxHp ?? 0);
        const heal = Math.max(1, Math.floor(maxHp * 0.05));
        const beforeHp = basePlayer.hp ?? 0;
        basePlayer.hp = Math.min(maxHp, beforeHp + heal);
      }

      const questEvents = [
        { type: QUEST_EVENTS.VICTORY, location: encounterLocation },
        { type: QUEST_EVENTS.INVENTORY_CHECK, runInventory },
      ];
      const questResult = processQuestEvents(basePlayer.questLog, questEvents, basePlayer);
      let finalPlayer = applyClassLoadoutToPlayer({
        ...basePlayer,
        questLog: questResult.questLog,
      }, classAward.progression);
      const tarotResult = applyTarotPostVictoryEffects(finalPlayer, prev.tarotSpread);
      finalPlayer = tarotResult.player;
      if (bossPortalStoneAwarded) {
        finalPlayer = grantPortalStone(finalPlayer, encounterLocation, 'boss');
      } else if (randomPortalStoneAwarded) {
        finalPlayer = grantPortalStone(finalPlayer, encounterLocation, 'drop');
      }
      if (finalPlayer.expeditionMap?.pendingCellId) {
        let expeditionMap = finalPlayer.expeditionMap;
        if (loot?.expeditionKeyRoll) {
          expeditionMap = applyPendingExpeditionKeyRoll(expeditionMap, loot.expeditionKeyRoll);
        }
        finalPlayer = {
          ...finalPlayer,
          expeditionMap: resolveCurrentExpeditionCell(expeditionMap),
          expeditionMapRoomActive: false,
        };
      }
      return finalPlayer;
    });

    if (encounterLocation) {
      setLocationEncounterCounters(prev => {
        const current = prev?.[encounterLocation] || 0;
        const next = isBoss ? 0 : current + 1;
        return { ...prev, [encounterLocation]: next };
      });
    }
    if (isBoss) {
      if (feedbackEvent || classRewardEvent) {
        setPortalDialog(null);
        setBossDialogWaitingForProgression(true);
      } else {
        setBossDialogWaitingForProgression(false);
        setPortalDialog('boss');
      }
      setCurrentScreen('dungeon');
    } else {
      setCurrentScreen('dungeon');
    }
  };

  const handleResolvePendingLoot = (pendingOverride = null) => {
    const reward = pendingOverride || pendingLoot;
    if (!reward || !player) return;
    const result = resolveNonCombatPendingLoot(reward, player);
    if (!result.committed) return;
    setPlayer(result.player);
    const continuation = reward.continuation;
    setPendingLoot(null);
    setInventoryFromLootOpen(false);
    if (continuation?.screen) setCurrentScreen(continuation.screen);
  };

  const updateCombatPendingLoot = nextPending => {
    pendingLootRef.current = nextPending;
    setPendingLoot(nextPending);
    setActiveCombat(prev => prev?.battleResult ? { ...prev, battleResult: { ...prev.battleResult, pendingLoot: nextPending } } : prev);
  };

  const handleResolveCombatPendingLoot = (battleResult, pendingOverride = null) => {
    if (!pendingLootRef.current || !player) return;
    const reward = pendingOverride || pendingLootRef.current;
    const combatPlayer = resolveCombatPlayerFromBattleResult(battleResult, activeCombat);
    const reconciledPlayer = reconcileCombatConsumables(player, combatPlayer);
    const committed = prepareCombatLootResolution(reward, reconciledPlayer);
    if (!committed.committed) return;
    // Consuming the authoritative ref is the synchronous one-shot guard. A failed
    // capacity check leaves it untouched, so the result remains retryable.
    pendingLootRef.current = null;
    setPendingLoot(null);
    setInventoryFromLootOpen(false);
    const resolvedLoot = {
      ...(battleResult?.loot || {}),
      expeditionKeyRoll: battleResult?.loot?.expeditionKeyRoll
        || reward?.expeditionKeyRoll
        || null,
    };
    handleVictory(resolvedLoot, battleResult.isBoss, combatPlayer, committed.slots, battleResult.id);
    // The reward belonged to a combat whose location no longer exists. Rewards
    // are granted above through the normal path, but the player must land on
    // Level 2 selection instead of the dungeon handleVictory would open.
    if (reward.recoveredFromUnavailableLocation) {
      // Do not keep the boss portal dialog from the removed location open
      // over the Level 2 selection screen (also after class reward feedback).
      setPortalDialog(null);
      setBossDialogWaitingForProgression(false);
      setPlayer(prev => prev ? {
        ...prev,
        currentLocation: null,
        currentEnemies: undefined,
        currentCombatRoomType: null,
        currentDungeonChoices: null,
        currentDungeonChoicesLocation: null,
        currentPathEvent: null,
        expeditionPhase: 'level-selection',
      } : prev);
      setCurrentScreen('levelTwoLocationSelect');
    }
  };

  const handleVictorySplashComplete = useCallback(battleResult => {
    if (!battleResult?.id || pendingLootRef.current?.id !== battleResult.id) return;
    liveVictoryRewardIdRef.current = null;
    setCurrentScreen('combatLoot');
  }, [setCurrentScreen]);

  const handlePendingReward = ({ source, silver = 0, items = [] }) => {
    if (pendingLoot) {
      pushToast('Сначала разберите текущую добычу', { tone: 'warning' });
      return;
    }
    const extra = rollRecruitSealExtraLoot({ player, location: player?.currentLocation, source: source === 'combat' ? 'ordinary' : source });
    const rewardItems = extra.item ? [...items, extra.item] : items;
    const reward = createPendingLoot({ id: `${source}-${Date.now()}`, source, loot: { silver, items: rewardItems }, continuation: { screen: 'dungeon' } });
    setPlayer(prev => ({ ...prev, runSilver: (prev?.runSilver || 0) + silver }));
    setPendingLoot({ ...reward, silverClaimed: true });
  };

  const handleDeath = (cause = 'combat-defeat', { allowInsurance = true } = {}) => {
    clearTransientCombatState('defeat');
    if (!player) return;
    const deathResult = createExpeditionDeathResult({
      ...player,
      runInventory: player.runInventory || [],
    }, { allowInsurance });
    const deathState = createGuildPlayerAfterDeath(deathResult);
    const preservedStacks = deathResult.preservedStacks;
    setCarryOverSilver(0);
    setCarryOverRunInventory([]);
    setPlayer(deathState);
    setLocationEncounterCounters({});
    setDeathSummary({ preservedStacks, insurance: deathResult.insurance, cause });
    setCurrentScreen('deathSummary');
  };

  const updatePlayerState = (updater) => {
    setPlayer(prev => {
      if (!prev) return prev;
      const patch = typeof updater === 'function' ? updater(prev) : updater;
      const merged = { ...prev, ...patch };
      merged.questLog = initializeQuestLog(merged.questLog);
      const normalizedLoadout = normalizeEquipmentLoadout(
        merged.equipment || prev.equipment,
        [],
        merged.class
      );
      const equipment = normalizedLoadout.equipment;
      merged.equipment = equipment;
      delete merged.inventory;
      delete merged.safeSlots;
      return Object.prototype.hasOwnProperty.call(patch, 'runInventory')
        ? applyRunInventoryQuestProgress(merged, merged.runInventory)
        : merged;
    });
  };



  const handleQuestEvents = (events = [], contextOverrides = {}, options = {}) => {
    if (!events.length) return;
    setPlayer(prev => {
      if (!prev) return prev;
      const context = { ...prev, ...contextOverrides };
      const { questLog } = processQuestEvents(prev.questLog, events, context);
      return { ...prev, questLog };
    });
    // Quest state and rewards remain mechanical; routine toast UX is intentionally deferred.
  };

  const handleClaimQuestReward = questId => {
    const transaction = claimGuildQuestReward({ player, storageItems: stashedItems, questId });
    if (!transaction.success) {
      pushToast(transaction.reason === 'storage-full' ? 'В Хранилище недостаточно места' : 'Награда недоступна', { tone: 'warning' });
      return false;
    }
    commitStoragePlayer(transaction);
    if (transaction.relicXp) {
      updatePersistentRelics(current => grantRelicExperience(
        current,
        current.activeRelicId,
        transaction.relicXp
      ).relicState);
    }
    playSfx('rewardClaim');
    return true;
  };

  const handleVendorPurchase = item => {
    const transaction = purchaseGuildVendorItem({
      player,
      storageItems: stashedItems,
      item,
      vendorPurchaseState,
      nowMs: getServerNow?.() ?? Date.now(),
    });
    if (!transaction.success) {
      const message = transaction.reason === 'storage-full'
        ? 'В Хранилище недостаточно места'
        : transaction.reason === 'daily-limit'
          ? 'Суточный лимит покупки исчерпан. Сброс в 00:00 UTC.'
          : 'Недостаточно серебра';
      pushToast(message, { tone: 'warning' });
      return false;
    }
    commitStoragePlayer(transaction);
    return true;
  };

  const handleDepositToStorage = (item) => {
    if (!player || !item) return false;
    const normalizedName = normalizeItemName(typeof item === 'string' ? item : item.itemId || item.name);
    if (!normalizedName && !getRuneById?.(item?.itemId)) return false;
    if (!findItemData(normalizedName) && !getRuneById?.(item?.itemId)) {
      pushToast('Неизвестный предмет нельзя поместить в хранилище', { tone: 'warning' });
      return false;
    }
    const transaction = depositRunInventoryEntry({ storageItems: stashedItems, player, sourceIndex: item.sourceIndex, itemId: item.itemId || normalizedName, quantity: item.quantityToMove || 1 });
    if (!transaction.success) { pushToast(transaction.reason === 'source-missing' ? 'Предмет не найден в инвентаре' : 'В хранилище нет свободного места', { tone: 'warning' }); return false; }
    commitStoragePlayer(transaction);
    handleQuestEvents(
      [{ type: QUEST_EVENTS.INVENTORY_CHECK, runInventory: transaction.player.runInventory }],
      { runInventory: transaction.player.runInventory },
      { silent: true }
    );
    return true;
  };

  const handleWithdrawFromStorage = (entry, requestedQuantity = 1) => {
    if (!player || !entry) return false;
    const transaction = withdrawStorageEntry({ storageItems: stashedItems, player, entryId: getStorageEntryId(entry), quantity: requestedQuantity });
    if (!transaction.success) { pushToast(transaction.reason === 'inventory-full' ? 'В походном инвентаре недостаточно места' : 'Не удалось забрать предмет', { tone: 'warning' }); return false; }
    commitStoragePlayer(transaction);
    handleQuestEvents(
      [{ type: QUEST_EVENTS.INVENTORY_CHECK, runInventory: transaction.player.runInventory }],
      { runInventory: transaction.player.runInventory },
      { silent: true }
    );
    return true;
  };

  const handleEquipFromStorage = (entry, preferredSlot = null) => {
    if (!player || !entry) return false;
    const transaction = equipStorageEntry({ storageItems: stashedItems, player, entryId: getStorageEntryId(entry), preferredSlot });
    if (transaction.requiresSlotChoice) return transaction;
    if (!transaction.success) {
      pushToast(transaction.reason === 'storage-full' ? 'Не хватает места в хранилище для снятого снаряжения.' : transaction.reason || 'Предмет нельзя надеть', { tone: 'warning' });
      return false;
    }
    commitStoragePlayer(transaction);
    return true;
  };

  const handleSellFromStorage = (ids, options) => {
    const sale = sellStorageSelection(stashedItems, ids, options);
    if (!sale.success) return sale;
    commitStoragePlayer({ storageItems: sale.storage, player: addGuildSilver(player, sale.silver) });
    return sale;
  };

  const handleUpdateStorage = updater => setStashedItems(previous => (
    typeof updater === 'function' ? updater(Array.isArray(previous) ? previous : []) : updater
  ));

  const handleEnterDungeon = (
    selectedEnemies,
    isBoss = false,
    locationName = null,
    roomType = null,
    combatContext = {}
  ) => {
    const enemiesForCombat = Array.isArray(selectedEnemies) ? selectedEnemies.filter(Boolean) : [];
    if (enemiesForCombat.length === 0) {
      pushToast('Нет подходящих врагов для боя', { tone: 'warning' });
      return;
    }
    const combatIntent = { enemies: enemiesForCombat, isBoss, locationName };
    pendingCombatRef.current = combatIntent;
    setPendingCombat(combatIntent);
    setPlayer(prev => ({
      ...prev,
      currentEnemies: enemiesForCombat,
      isBoss,
      currentLocation: locationName || prev.currentLocation || null,
      currentCombatRoomType: roomType,
      currentDungeonChoices: null,
      currentDungeonChoicesLocation: null,
      currentPathEvent: null,
      activeExpeditionZone: combatContext?.expeditionZone || null,
      activeSublocationId: combatContext?.sublocationId || null,
      activeSublocationEffectId: combatContext?.sublocationEffectId || null,
    }));
    setActiveCombat(null);
    setCurrentScreen('combat');
  };

  const handleReturnToGuild = (reason = 'guild-return') => {
    if (isAbyssBound(player?.curses) && player?.currentLocation) {
      setPortalDialog(null);
      pushToast('Бездна не отпускает героя', {
        description: 'Обычная эвакуация невозможна.',
        tone: 'warning',
      });
      return false;
    }
    setPortalDialog(null); clearTransientCombatState(reason);
    if (!player) return;
    const extracted = extractRunInventory({ ...player, runInventory: player.runInventory || [] });
    const transfer = transferRunResonance(extracted.player);
    const finalPlayer = restorePlayerForGuildReturn(transfer.player);
    setPlayer(finalPlayer); setRelicState(transfer.after); setLocationEncounterCounters({});
    if (shouldShowRelicResonanceTransfer(transfer)) { setResonanceTransfer(transfer); setCurrentScreen('relicTransfer'); }
    else setCurrentScreen('guild');
    return true;
  };

  const handleUnloadAllToStorage = () => {
    if (!player) return null;
    const result = unloadRunInventoryToStash(player, stashedItems || []);
    setPlayer(result.player);
    setStashedItems(result.storageItems);
    return { movedQuantity: result.movedQuantity, remainingQuantity: result.remainingQuantity };
  };

  const handleUnloadBackpackExceptKept = (keptSlotIndices = []) => {
    if (!player) return null;
    const keepSlotIndices = new Set([0, 1, ...keptSlotIndices]);
    const result = unloadRunInventoryToStash(player, stashedItems || [], { keepSlotIndices });
    commitStoragePlayer(result);
    return { movedQuantity: result.movedQuantity, remainingQuantity: result.remainingQuantity };
  };

  const handleSelectDungeonLocation = (locationName) => {
    if (!locationName) return;
    clearTransientCombatState('fresh-dungeon-run');
    startDungeonRun(prepareFreshDungeonRun(player, locationName));
  };

  const handleExpeditionMove = cellId => {
    updatePlayerState(prev => {
      const result = moveExpeditionRun(prev.expeditionMap, cellId);
      return result.moved ? { expeditionMap: result.run, expeditionMapRoomActive: Boolean(result.run.pendingCellId) } : {};
    });
  };

  const handleExpeditionCellContent = content => {
    updatePlayerState(prev => ({ expeditionMap: setPendingExpeditionCellContent(prev.expeditionMap, content) }));
  };

  const handleExpeditionCellResolved = () => {
    updatePlayerState(prev => ({ expeditionMap: resolveCurrentExpeditionCell(prev.expeditionMap), expeditionMapRoomActive: false }));
  };

  const handleExpeditionCellCancel = () => {
    updatePlayerState(prev => ({
      expeditionMap: cancelPendingExpeditionCell(prev.expeditionMap),
      expeditionMapRoomActive: false,
    }));
  };

  const handleDismissExpeditionKeyNotice = () => {
    updatePlayerState(prev => ({
      expeditionMap: dismissExpeditionKeyNotice(prev.expeditionMap),
    }));
  };

  useEffect(() => {
    if (
      currentScreen !== 'dungeon'
      || !player?.expeditionMap
      || player?.expeditionMapRoomActive
    ) return;

    setPlayer(prev => {
      if (!prev?.expeditionMap) return prev;
      const repaired = reconcileExpeditionKeyGuarantees(prev.expeditionMap);
      return repaired === prev.expeditionMap
        ? prev
        : { ...prev, expeditionMap: repaired };
    });
  }, [currentScreen, player?.expeditionMap, player?.expeditionMapRoomActive, setPlayer]);

  const handleSelectLevelTwoLocation = (locationName) => {
    const location = LEVEL_TWO_LOCATIONS.find(entry => entry.name === locationName);
    if (!isLocationAvailable(location)) return;
    const nextPlayer = prepareLevelTwoDungeonRun(player, location.name);
    if (!nextPlayer) return;
    pendingCombatRef.current = null;
    setPendingCombat(null);
    startDungeonRun(nextPlayer);
  };

  const handleCancelLocationSelection = () => {
    clearTransientCombatState('location-selection-cancel');
    setPlayer(prev => restorePlayerForGuildReturn(prev));
    setLocationEncounterCounters({});
    setCurrentScreen('guild');
  };

  const handleRequestPortalStoneUse = () => {
    if (!hasPortalStone(player) || currentScreen === 'combat' || currentScreen === 'arenaCombat') {
      return;
    }
    if (isAbyssBound(player?.curses)) {
      pushToast('Камень портала не отвечает', { description: 'Герой связан с Бездной.', tone: 'warning' });
      return;
    }
    setPortalDialog('use');
  };

  const handleRequestSeverAbyssLink = () => {
    if (!player || !isAbyssBound(player.curses) || currentScreen === 'combat' || currentScreen === 'arenaCombat') return;
    setPortalDialog('sever-abyss-link');
  };

  const handleConfirmSeverAbyssLink = () => {
    setPortalDialog(null);
    handleDeath('abyss-link-severed', { allowInsurance: false });
  };

  const handleConfirmPortalReturn = () => {
    handleReturnToGuild('portal-stone-return');
  };

  const handlePromptDescendAfterBoss = () => {
    if (Number(player?.abyssLevel) >= 2) return;
    setPortalDialog('descend');
  };

  const handleConfirmDescend = () => {
    const locationName = player?.currentLocation || null;
    if (!player || (player.expeditionPhase !== 'boss-defeated' && player.portalStone?.acquiredFrom !== 'boss')) return;
    const nextPlayer = prepareLevelTwoSelection(player);
    if (!nextPlayer) return;
    setPortalDialog(null);
    pendingCombatRef.current = null;
    setPendingCombat(null);
    enterLevelTwoSelection(nextPlayer, locationName);
  };

  const handleCancelDescend = () => {
    setPortalDialog('boss');
  };

  const styles = {
    app: {
      textAlign: 'center',
      fontFamily: 'Arial, sans-serif',
      maxWidth: '100%',
      boxSizing: 'border-box',
    },
    navigation: {
      marginBottom: '20px',
    },
    button: {
      margin: '0 10px',
      padding: '10px 20px',
      fontSize: '16px',
      cursor: 'pointer',
      backgroundColor: '#007bff',
      color: 'white',
      border: 'none',
      borderRadius: '5px',
    },
    buttonDisabled: {
      cursor: 'not-allowed',
      opacity: 0.5,
    },
    newGame: {
      position: 'fixed',
      top: 6,
      right: 6,
      zIndex: 2500,
      padding: '5px 8px',
      border: '1px dashed #777',
      borderRadius: 5,
      background: '#262626',
      color: '#bbb',
      fontSize: 11,
      opacity: 0.85,
    },
  };

  const pendingCombatRefValue = pendingCombatRef.current;
  const combatValidation = useMemo(
    () => validateCombatInput({
      player,
      pendingCombat,
      pendingCombatRefValue,
      activeCombat,
    }),
    [activeCombat, pendingCombat, pendingCombatRefValue, player]
  );
  const freshCombatIntent = combatValidation.freshCombatIntent;
  const combatEntrySource = combatValidation.source;
  const combatEnemies = combatValidation.isValid ? combatValidation.enemies : [];
  const combatIsBoss = combatValidation.isValid ? combatValidation.isBoss : false;
  const initialCombatSnapshot = combatValidation.isValid ? combatValidation.initialCombatSnapshot : null;
  const combatDiagnostics = useMemo(
    () => getCombatInputDiagnostics({
      player,
      currentScreen,
      activeCombat,
      pendingCombat,
      pendingCombatRefValue,
      freshCombatIntent,
      combatEntrySource,
    }),
    [activeCombat, combatEntrySource, currentScreen, freshCombatIntent, pendingCombat, pendingCombatRefValue, player]
  );

  const handleCombatSnapshot = useCallback((snapshot) => {
    let acceptedSnapshot = snapshot;
    const terminal = snapshot?.battleResult;
    if (terminal?.outcome === 'victory' && terminal.loot) {
      const encounterLocation = snapshot?.state?.players?.[0]?.currentEnemies?.[0]?.location || player?.currentEnemies?.[0]?.location || null;
      const encounterCountAfterVictory = encounterLocation ? (locationEncounterCounters?.[encounterLocation] || 0) + 1 : 0;
      const acquiredFrom = terminal.isBoss && !hasPortalStone(player)
        ? 'boss'
        : !terminal.isBoss && encounterLocation && !hasPortalStone(player) && encounterCountAfterVictory > PORTAL_STONE_RANDOM_MIN_FIGHTS && Math.random() < PORTAL_STONE_RANDOM_CHANCE
          ? 'drop'
          : null;
      const expeditionKeyRoll = terminal.loot?.expeditionKeyRoll
        || activeCombat?.battleResult?.loot?.expeditionKeyRoll
        || previewPendingExpeditionKeyRoll(player?.expeditionMap);
      const specialRewards = [...(terminal.loot?.specialRewards || [])];
      if (acquiredFrom && !specialRewards.some(reward => reward.id === 'portal_stone')) {
        specialRewards.push({ id: 'portal_stone', name: 'Камень портала', acquiredFrom });
      }
      if (
        expeditionKeyRoll?.dropped
        && !specialRewards.some(reward => reward.id === `expedition_key_${expeditionKeyRoll.keyType}`)
      ) {
        specialRewards.push({
          id: `expedition_key_${expeditionKeyRoll.keyType}`,
          name: EXPEDITION_KEY_REWARD_NAMES[expeditionKeyRoll.keyType] || 'Ключ экспедиции',
          keyType: expeditionKeyRoll.keyType,
        });
      }
      const terminalLoot = {
        ...terminal.loot,
        expeditionKeyRoll,
        specialRewards,
      };
      const rewardId = terminal.id || `legacy-combat-${JSON.stringify(terminal.loot)}`;
      if (!activeCombat?.battleResult && currentScreen === 'combat') liveVictoryRewardIdRef.current = rewardId;
      let reward = terminal.pendingLoot
        || (pendingLootRef.current?.source === 'combat' && pendingLootRef.current.id === rewardId ? pendingLootRef.current : null)
        || createPendingLoot({ id: rewardId, source: 'combat', loot: terminalLoot, continuation: { screen: 'dungeon', isBoss: terminal.isBoss } });
      if (!reward.silverClaimed) {
        reward = { ...reward, silverClaimed: true };
        setPlayer(prev => ({ ...prev, runSilver: (prev?.runSilver || 0) + reward.silver }));
      }
      pendingLootRef.current = reward;
      setPendingLoot(reward);
      acceptedSnapshot = { ...snapshot, battleResult: { ...terminal, loot: terminalLoot, id: rewardId, pendingLoot: reward } };
    }
    acceptCombatSnapshot({ snapshot: acceptedSnapshot, pendingCombatRef, setPendingCombat, setActiveCombat });
  }, [activeCombat?.battleResult, currentScreen, locationEncounterCounters, player, setActiveCombat, setPendingLoot, setPlayer]);

  useEffect(() => {
    const terminal = activeCombat?.battleResult;
    if (currentScreen !== 'combat' || terminal?.outcome !== 'victory' || pendingLoot?.source !== 'combat') return;
    if (liveVictoryRewardIdRef.current === pendingLoot.id) return;
    setCurrentScreen('combatLoot');
  }, [activeCombat, currentScreen, pendingLoot, setCurrentScreen]);

  useEffect(() => {
    combatValidation.warnings.forEach(warning => {
      warnLifecycleOnce(`combat-warning:${warning}`, `Combat lifecycle warning: ${warning}`, {
        ...combatDiagnostics,
        reasons: combatValidation.reasons,
      });
    });

    if (currentScreen !== 'combat') return;
    if (combatValidation.isValid) return;

    warnLifecycleOnce('invalid-combat-input', 'Invalid combat input; recovering without defeat.', {
      ...combatDiagnostics,
      reasons: combatValidation.reasons,
    });
    clearTransientCombatState('invalid-combat-recovery');
    if (player) {
      setPlayer(prev => (
        prev
          ? {
              ...prev,
              currentEnemies: undefined,
              isBoss: false,
            }
          : prev
      ));
      setCurrentScreen('dungeon');
    } else {
      setCurrentScreen('character');
    }
  }, [
    clearTransientCombatState,
    combatDiagnostics,
    combatValidation,
    currentScreen,
    player,
    setCurrentScreen,
    setPlayer,
    warnLifecycleOnce,
  ]);

  useEffect(() => {
    if (activeCombat && currentScreen !== 'combat') {
      warnLifecycleOnce('active-combat-outside-combat-screen', 'activeCombat exists outside CombatScreen.', combatDiagnostics);
    }
    if (pendingCombatRefValue && (currentScreen === 'guild' || currentScreen === 'character')) {
      warnLifecycleOnce('pending-ref-on-safe-screen', 'pendingCombatRef exists on a safe/non-combat screen.', combatDiagnostics);
    }
    if (player?.currentEnemies?.length > 0 && currentScreen === 'guild') {
      warnLifecycleOnce('current-enemies-in-guild', 'player.currentEnemies exists while in Guild.', combatDiagnostics);
    }
    if (player?.currentDungeonChoices?.length > 0 && currentScreen === 'guild') {
      warnLifecycleOnce('dungeon-choices-in-guild', 'currentDungeonChoices exists while in Guild.', combatDiagnostics);
    }
    if (player?.currentPathEvent && currentScreen === 'guild') {
      warnLifecycleOnce('path-event-in-guild', 'currentPathEvent exists while in Guild.', combatDiagnostics);
    }
  }, [activeCombat, combatDiagnostics, currentScreen, pendingCombatRefValue, player, warnLifecycleOnce]);

  const showNavigation = shouldShowAppNavigation(currentScreen);
  const combatScreenActive = isActiveCombatScreen(currentScreen) || currentScreen === 'combatLoot';
  const navigationLocked = currentScreen === 'dungeon';

  const handleNavigate = (targetScreen) => {
    if (navigationLocked && targetScreen !== 'dungeon') {
      pushToast('Экспедиция в Бездне', {
        description: 'Завершите поход или используйте Камень портала, чтобы вернуться в Гильдию.',
        tone: 'warning',
      });
      return;
    }
    if (currentScreen === 'guild' && targetScreen === 'dungeon') {
      if (!hasOrdinaryFreeInventorySlot(player)) {
        setFullCarryWarningOpen(true);
        return;
      }
      beginLocationSelection();
      return;
    }
    setCurrentScreen(targetScreen);
  };

  const beginLocationSelection = () => {
      setFullCarryWarningOpen(false);
      clearTransientCombatState('new-run-start');
      setPlayer(prev => (
        prev
          ? {
              ...prev,
              currentLocation: null,
              currentEnemies: undefined,
              currentCombatRoomType: null,
              isBoss: false,
              currentDungeonChoices: null,
              currentDungeonChoicesLocation: null,
              currentPathEvent: null,
            }
          : prev
      ));
      setCurrentScreen('locationSelect');
  };

  const customCombatAccessible = canAccessCustomCombat({
    screen: currentScreen,
    hasPlayer: Boolean(player),
  });
  const openCustomCombat = () => {
    if (!customCombatAccessible) return;
    setCustomCombatSandbox(null);
    setCustomCombatView('config');
  };
  const toggleExpeditionMapDev = () => {
    const next = !expeditionMapDevEnabled;
    setExpeditionMapRuntimeEnabled(next);
    setExpeditionMapDevEnabled(next);
    pushToast(`Expedition Map: ${next ? 'ВКЛ' : 'ВЫКЛ'}`, {
      description: 'Переключатель применяется к следующему походу.',
    });
  };
  const startCustomCombat = (selection, catalog) => {
    if (!customCombatAccessible || !player) return;
    setCustomCombatSandbox(createCustomCombatSandbox(player, selection, catalog));
    setCustomCombatView('battle');
  };
  const finishCustomCombat = () => {
    setCustomCombatSandbox(null);
    setCustomCombatView('config');
  };
  const confirmNewGame = () => {
    pendingCombatRef.current = null;
    setPendingCombat(null);
    setCustomCombatSandbox(null);
    setCustomCombatView(null);
    setPortalDialog(null);
    setNewGameDialogOpen(false);
    resetPersistentGameState();
  };
  const handleClassSwitch = classId => {
    let storage = stashedItems;
    const retainedEquipment = { ...createEmptyEquipmentSlots(), bag: player?.equipment?.bag || null };
    for (const [, equipped] of Object.entries(player?.equipment || {}).filter(([slot, item]) => slot !== 'bag' && Boolean(item))) {
      const incoming = typeof equipped === 'string' ? { itemId: equipped, quantity: 1 } : equipped;
      const deposit = depositIntoStorage(storage, incoming);
      if (!deposit.success) { pushToast('В Хранилище недостаточно места', { tone: 'warning' }); return; }
      storage = deposit.storage;
    }
    const result = switchPlayerClass({ ...player, equipment: retainedEquipment }, classId, { inCombat: combatScreenActive });
    if (!result.success) { pushToast(result.reason, { tone: 'warning' }); return; }
    commitStoragePlayer({ storageItems: storage, player: result.player });
  };

  if (hydrationError || saveError) {
    const errorMessage = hydrationError || saveError.message;
    const diagnosticCode = hydrationError ? hydrationErrorCode : saveError.code;
    return <main className="account-bootstrap"><h1>{hydrationError ? 'Не удалось восстановить сохранение' : 'Не удалось сохранить игру'}</h1><p role="alert">{errorMessage} Код: {diagnosticCode}.</p>{saveError && <><p>Сначала попробуйте ещё раз сохранить текущий прогресс. «Повторить загрузку» загрузит прежнее серверное сохранение и может отменить неподтверждённые изменения.</p>{saveError.diagnostic && <p>Диагностика навыков: {saveError.diagnostic.classId || 'неизвестный класс'}, ячейка {Number.isInteger(saveError.diagnostic.index) ? saveError.diagnostic.index + 1 : '—'}, причина {saveError.diagnostic.reason || 'неизвестна'}.</p>}<button type="button" disabled={saveRetrying} onClick={retryPersistentSave}>{saveRetrying ? 'Сохраняем…' : 'Повторить сохранение'}</button></>}{resetError && <p role="alert">{resetError}</p>}<button type="button" onClick={retryPersistentLoad}>Повторить загрузку</button>{hydrationError && <button type="button" disabled={resetting} onClick={() => setCorruptResetDialogOpen(true)}>{resetting ? 'Удаление…' : 'Начать заново'}</button>}{corruptResetDialogOpen && <ConfirmDialog title="Удалить игровой прогресс?" description="Персонаж и игровой прогресс этого аккаунта будут удалены. Имя аккаунта сохранится." confirmLabel="Удалить и начать заново" onCancel={() => setCorruptResetDialogOpen(false)} onConfirm={async () => { setCorruptResetDialogOpen(false); await resetCorruptSave(); }} />}</main>;
  }

  if (customCombatAccessible && customCombatView === 'config') {
    return <CustomCombatScreen onStart={startCustomCombat} onClose={() => setCustomCombatView(null)} />;
  }

  if (customCombatAccessible && customCombatView === 'battle' && customCombatSandbox) {
    return (
      <CombatScreen
        player={customCombatSandbox.player}
        enemies={customCombatSandbox.enemies}
        isBoss={false}
        onVictory={finishCustomCombat}
        onDefeat={finishCustomCombat}
        onExit={finishCustomCombat}
      />
    );
  }

  return (
    <div className="app-shell" data-app-screen={currentScreen} style={{ ...styles.app, ...(combatScreenActive ? { padding: 0 } : {}), ...getAppViewportOverride(currentScreen) }}>
      {showNavigation && (
        <div style={styles.navigation}>
          <button
            style={
              currentScreen === 'guild' || navigationLocked
                ? { ...styles.button, ...styles.buttonDisabled }
                : styles.button
            }
            onClick={() => handleNavigate('guild')}
            disabled={currentScreen === 'guild' || navigationLocked}
          >
            Гильдия
          </button>
          <button
            style={currentScreen === 'dungeon' || currentScreen === 'locationSelect' ? { ...styles.button, ...styles.buttonDisabled } : styles.button}
            onClick={() => handleNavigate('dungeon')}
            disabled={currentScreen === 'dungeon' || currentScreen === 'locationSelect'}
          >
            Спуститься в Бездну
          </button>
        </div>
      )}
      {currentScreen === 'deathSummary' && deathSummary && <DeathSummary preservedStacks={deathSummary.preservedStacks} insurance={deathSummary.insurance} cause={deathSummary.cause} onContinue={() => { setDeathSummary(null); setCurrentScreen('guild'); }} />}
      {currentScreen === 'relicTransfer' && resonanceTransfer && <RelicResonanceTransfer transfer={resonanceTransfer} onComplete={() => { setResonanceTransfer(null); setCurrentScreen('guild'); }} />}
      {currentScreen === 'character' && (
        <CharacterSelectionScreen accountName={account?.gameName} onCharacterSelect={handleCharacterSelect} classProgression={classProgression} />
      )}
      {currentScreen === 'guild' && player && (
        <AssetBundleGate bundleId="guild">
          <GuildScreen
            player={player}
            onUpdatePlayer={updatePlayerState}
            onUpdateRelics={updatePersistentRelics}
            onQuestEvent={handleQuestEvents}
            onClaimQuestReward={handleClaimQuestReward}
            onPurchaseVendorItem={handleVendorPurchase}
            vendorPurchaseState={vendorPurchaseState}
            getServerNow={getServerNow}
            storageItems={stashedItems}
            onDepositItem={handleDepositToStorage}
            onWithdrawItem={handleWithdrawFromStorage}
            onEquipStorageItem={handleEquipFromStorage}
            onSellStorage={handleSellFromStorage}
            onUpdateStorage={handleUpdateStorage}
            onUnloadAllToStorage={handleUnloadAllToStorage}
            onUnloadBackpackExceptKept={handleUnloadBackpackExceptKept}
            classProgression={classProgression}
            onStartRun={beginLocationSelection}
            onChangeClass={handleClassSwitch}
            onUpdateClassProgression={(next) => {
              setClassProgression(next);
              setPlayer(prev => applyClassLoadoutToPlayer(prev, next));
            }}
          />
          <GuildDevPanel musicController={musicController} currentClass={player.class} expeditionMapEnabled={expeditionMapDevEnabled} onToggleExpeditionMap={toggleExpeditionMapDev} onCustomCombat={openCustomCombat} onOpenMinigame={setDevMinigame} onReset={() => setNewGameDialogOpen(true)} onChangeClass={handleClassSwitch} onGrantAllRelics={() => updatePersistentRelics(grantAllRelics)} onAddItem={itemId => { const deposit = depositIntoStorage(stashedItems, { itemId, quantity: 1 }); if (deposit.success) setStashedItems(deposit.storage); else pushToast('Не удалось добавить предмет: Хранилище заполнено', { tone: 'warning' }); }} />
          <DevMinigameSandbox activeId={devMinigame} player={player} onClose={() => setDevMinigame(null)} />
        </AssetBundleGate>
      )}
      <ProgressionFeedback event={progressionFeedback} onClose={() => {
        setProgressionFeedback(null);
        if (pendingClassRewardFeedback) {
          setClassRewardFeedback(pendingClassRewardFeedback);
          setPendingClassRewardFeedback(null);
        } else if (bossDialogWaitingForProgression) {
          setBossDialogWaitingForProgression(false);
          setPortalDialog('boss');
        }
      }} />
      <ClassRewardFeedback event={classRewardFeedback} onClose={() => {
        setClassRewardFeedback(null);
        if (bossDialogWaitingForProgression) {
          setBossDialogWaitingForProgression(false);
          setPortalDialog('boss');
        }
      }} />
      {currentScreen === 'locationSelect' && player && (
        <LocationSelectionScreen
          onSelectLocation={handleSelectDungeonLocation}
          onCancel={handleCancelLocationSelection}
        />
      )}
      {currentScreen === 'levelTwoLocationSelect' && player && (
        <LocationSelectionScreen
          level={2}
          onSelectLocation={handleSelectLevelTwoLocation}
          onCancel={isAbyssBound(player.curses) ? handleRequestSeverAbyssLink : () => handleReturnToGuild('level-two-selection')}
          cancelLabel={isAbyssBound(player.curses) ? 'Разорвать связь' : undefined}
        />
      )}
      {currentScreen === 'dungeon' && player?.expeditionMap && !player.expeditionMapRoomActive && (
        <AssetBundleGate bundleId={getLocationImageBundleId(player.currentLocation)}>
          <ExpeditionMapScreen
          run={player.expeditionMap}
          player={player}
          autobattleUnlocked={isAutobattleUnlocked(clearedBossLocations, player.currentLocation)}
          onAutobattleChange={enabled => {
            if (isAutobattleUnlocked(clearedBossLocations, player.currentLocation)) {
              updatePlayerState({ autobattleEnabled: enabled });
            }
          }}
          onMove={handleExpeditionMove}
          onResolveContent={() => updatePlayerState({ expeditionMapRoomActive: true })}
          onReturnToGuild={handleReturnToGuild}
          onUpdatePlayer={updatePlayerState}
          onQuestEvent={handleQuestEvents}
          onDismissKeyNotice={handleDismissExpeditionKeyNotice}
          />
        </AssetBundleGate>
      )}
      {currentScreen === 'dungeon' && player && (!player.expeditionMap || player.expeditionMapRoomActive) && (
        <AssetBundleGate bundleId={getLocationImageBundleId(player.currentLocation)}>
          <DungeonScreen
          autobattleUnlocked={isAutobattleUnlocked(clearedBossLocations, player.currentLocation)}
          player={player}
          onEnterDungeon={handleEnterDungeon}
          onReturnToGuild={handleReturnToGuild}
          onDefeat={handleDeath}
          hasPortalStone={hasPortalStone(player)}
          onUsePortalStone={handleRequestPortalStoneUse}
          onSeverAbyssLink={handleRequestSeverAbyssLink}
          onUpdatePlayer={updatePlayerState}
          onUpdateRelics={updatePersistentRelics}
          onQuestEvent={handleQuestEvents}
          onPendingLoot={handlePendingReward}
          encounterCounters={locationEncounterCounters}
          expeditionCell={player.expeditionMap?.pendingCellId ? getActiveExpeditionLayout(player.expeditionMap)?.cells.find(cell => cell.id === player.expeditionMap.pendingCellId) : null}
          onExpeditionCellContent={handleExpeditionCellContent}
          onExpeditionCellResolved={handleExpeditionCellResolved}
          onExpeditionCellCancel={handleExpeditionCellCancel}
          />
        </AssetBundleGate>
      )}
      {currentScreen === 'combat' && player && combatValidation.isValid && (
        <AssetBundleGate bundleId={getLocationImageBundleId(player.currentLocation)}>
          <AutobattleScreen
          enabled={Boolean(player.autobattleEnabled)}
          unlocked={isAutobattleUnlocked(clearedBossLocations, player.currentLocation)}
          onCheckpoint={async snapshot => {
            await commitActiveCombat(snapshot);
            pendingCombatRef.current = null;
            setPendingCombat(null);
          }}
          player={player}
          enemies={combatEnemies}
          isBoss={combatIsBoss}
          onVictory={handleVictory}
          onDefeat={handleDeath}
          initialCombatSnapshot={initialCombatSnapshot}
          onCombatSnapshot={handleCombatSnapshot}
          onClearCombatSnapshot={() => clearTransientCombatState('combat-screen-clear')}
          onVictorySplashComplete={handleVictorySplashComplete}
          />
        </AssetBundleGate>
      )}
      {currentScreen === 'combatLoot' && player && pendingLoot?.source === 'combat' && !inventoryFromLootOpen && (
        <CombatLootScreen
          pendingLoot={pendingLoot}
          player={player}
          onChange={updateCombatPendingLoot}
          onResolve={candidate => handleResolveCombatPendingLoot(activeCombat?.battleResult, candidate)}
          onOpenInventory={() => setInventoryFromLootOpen(true)}
          onInfo={item => setLootInfoItem(item)}
          suppressAbandonWarnings={suppressAbandonedLootWarnings}
          onSuppressAbandonWarningsChange={setSuppressAbandonedLootWarnings}
        />
      )}
      {pendingLoot && pendingLoot.source !== 'combat' && !inventoryFromLootOpen && player && (
        <PendingLootModal
          pendingLoot={pendingLoot}
          player={player}
          onChange={setPendingLoot}
          onResolve={handleResolvePendingLoot}
          onOpenInventory={() => setInventoryFromLootOpen(true)}
          onInfo={item => setLootInfoItem(item)}
          suppressAbandonWarnings={suppressAbandonedLootWarnings}
          onSuppressAbandonWarningsChange={setSuppressAbandonedLootWarnings}
        />
      )}
      {lootInfoItem && <ItemDetailsModal item={lootInfoItem} context={{ inExpedition: true, inCombat: false }} onClose={() => setLootInfoItem(null)} />}
      {departureInventoryOpen && player && (
        <InventoryGridModal
          player={player}
          context={{ inExpedition: false, inCombat: false }}
          onClose={() => setDepartureInventoryOpen(false)}
          onChangeSlots={slots => setPlayer(prev => ({ ...prev, runInventory: slots }))}
          onChangePlayer={next => setPlayer(next)}
        />
      )}
      {fullCarryWarningOpen && (
        <ConfirmDialog
          title="Инвентарь заполнен"
          description="В обычных ячейках нет свободного места для новой добычи. Вы можете начать спуск, но новые типы предметов некуда будет положить."
          confirmLabel="Начать поход"
          cancelLabel="Открыть инвентарь"
          onConfirm={beginLocationSelection}
          onCancel={() => { setFullCarryWarningOpen(false); setDepartureInventoryOpen(true); }}
        />
      )}
      {pendingLoot && inventoryFromLootOpen && player && (
        <InventoryGridModal
          player={player}
          context={{ inExpedition: true, inCombat: false }}
          lootContext={{ selected: pendingLoot.selectedIds.length, total: pendingLoot.items.length }}
          onClose={() => setInventoryFromLootOpen(false)}
          onChangeSlots={slots => setPlayer(prev => ({ ...prev, runInventory: slots }))}
          onChangePlayer={next => setPlayer(next)}
          onUseItem={index => setPlayer(prev => {
            const result = applyInventoryItemUse(prev, index, { inExpedition: true, inCombat: false });
            if (result.used) playSfx('consumableUse');
            return result.player;
          })}
        />
      )}
      {portalDialog === 'use' && (
        <ConfirmDialog
          title={`Использовать ${PORTAL_STONE_NAME}?`}
          description={`Вы вернётесь в Гильдию и сохраните добычу.\nКамень будет утрачен.`}
          confirmLabel="Вернуться"
          cancelLabel="Остаться"
          onConfirm={handleConfirmPortalReturn}
          onCancel={() => setPortalDialog(null)}
        />
      )}
      {newGameDialogOpen ? (
        <ConfirmDialog
          title="Начать новую игру?"
          description="Текущий персонаж и его забег будут удалены."
          confirmLabel="Новая игра"
          cancelLabel="Отмена"
          onConfirm={confirmNewGame}
          onCancel={() => setNewGameDialogOpen(false)}
        />
      ) : null}
      {portalDialog === 'boss' && (
        <ConfirmDialog
          title="Босс повержен"
          description={isAbyssBound(player?.curses)
            ? (Number(player?.abyssLevel) >= 2
              ? 'Бездна не отпускает героя, а следующего этажа пока нет. Можно остаться или разорвать связь ценой жизни.'
              : 'Бездна не отпускает героя. Обычная эвакуация невозможна — путь ведёт только глубже.')
            : Number(player?.abyssLevel) >= 2
            ? 'Архонт повержен. Экспедиция завершена — вернитесь в Гильдию с добычей.'
            : `Камень портала пульсирует, открывая путь назад.\n\nВернуться в Гильдию и сохранить добычу?\nИли спуститься глубже?`}
          confirmLabel={isAbyssBound(player?.curses)
            ? (Number(player?.abyssLevel) >= 2 ? 'Разорвать связь' : 'Спуститься глубже')
            : Number(player?.abyssLevel) >= 2 ? 'Завершить экспедицию' : 'Вернуться в Гильдию'}
          cancelLabel={isAbyssBound(player?.curses)
            ? 'Остаться'
            : Number(player?.abyssLevel) >= 2 ? 'Вернуться с добычей' : 'Спуститься глубже'}
          onConfirm={isAbyssBound(player?.curses)
            ? (Number(player?.abyssLevel) >= 2 ? handleRequestSeverAbyssLink : handlePromptDescendAfterBoss)
            : handleConfirmPortalReturn}
          onCancel={isAbyssBound(player?.curses)
            ? () => setPortalDialog(null)
            : Number(player?.abyssLevel) >= 2 ? handleConfirmPortalReturn : handlePromptDescendAfterBoss}
        />
      )}
      {portalDialog === 'sever-abyss-link' && (
        <ConfirmDialog
          title="Разорвать связь с Бездной?"
          description="Только гибель тела может разорвать связь. Поход завершится как при смерти: добыча и снаряжение будут потеряны, кроме предметов в безопасных ячейках."
          confirmLabel="Разорвать связь"
          cancelLabel="Остаться"
          onConfirm={handleConfirmSeverAbyssLink}
          onCancel={() => setPortalDialog(null)}
        />
      )}
      {portalDialog === 'descend' && (
        <ConfirmDialog
          title="Спуститься глубже?"
          description="При переходе на следующий уровень Камень портала будет утрачен."
          confirmLabel="Спуститься"
          cancelLabel="Остаться"
          onConfirm={handleConfirmDescend}
          onCancel={handleCancelDescend}
        />
      )}
    </div>
  );
};

export default App;



