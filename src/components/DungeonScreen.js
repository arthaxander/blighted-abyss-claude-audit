import { getAltarCurseIds } from '../utils/altarChoices';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { enemies } from '../data/enemies';
import { normalizeItemName, rollTreasureLoot } from '../data/items';
import { getLocationByName, LEVEL_TWO_PROGRESSION } from '../data/locations';
import FieldCraftingModal from './FieldCraftingModal';
import { ensureRelicState } from '../data/relics';
import LockpickMinigame from './LockpickMinigame';
import TrapDisarmModal from './TrapDisarmModal';
import { createTrapAmbush, getTrapMetal } from '../utils/trapEncounter';
import AltarRoomModal from './AltarRoomModal';
import DungeonInventoryModal from './DungeonInventoryModal';
import FishingRoomModal from './FishingRoomModal';
import RoomChoiceCard from './RoomChoiceCard';
import DungeonRunHud from './DungeonRunHud';
import EnemyDetailCard from './EnemyDetailCard';
import ExpeditionCombatPreview from './ExpeditionCombatPreview';
import { applyInventoryItemUse } from '../utils/inventoryItemUse';
import { applyAbyssPowerToEnemy, createAbyssPowerDescriptor } from '../utils/abyssPower';
import { LOCATION_EFFECTS } from '../data/locationEffects';
import './DungeonScreen.css';
import {
  formatActiveCurseText,
  getActiveCursesList,
  getCurseDefinition,
  getCurseTier,
  getEligibleCursePool,
  getNextCurseTierPreview,
  isAbyssBound,
  resolveCurseOffering,
} from '../data/curses';
import { QUEST_EVENTS } from '../data/quests';
import { SAFE_SLOT_LIMIT } from '../constants/gameplay';
import { getTarotCardById, getTarotChestModifiers } from '../data/tarotCards';
import { createFishingChallenge } from '../data/fishing';
import { getSublocationDefinition } from '../data/expeditionSublocations';
import {
  createEncounterPair,
  createDeserterCampEncounter,
  createGoblinNestsEncounter,
  createMushroomCavesEncounter,
  createWitheringForestEncounter,
  createRestlessRuinsEncounter,
  createMinesOfDecayEncounter,
  applyDeserterAlertModifier,
  getCursedEnemyPool, createCursedEncounter,
  getTrashEnemyPool,
  DESERTER_LOCATION,
  FUNGAL_LOCATION,
  GOBLIN_LOCATION,
  WITHERING_FOREST_LOCATION,
  RESTLESS_RUINS_LOCATION,
  MINES_OF_DECAY_LOCATION,
} from '../utils/enemyPools';
import { useToast } from '../contexts/UIContext';
import {
  generateRoomChoices,
  buildRoomPayload,
  migrateLegacySecretRoomChoices,
  getLocationRoomGenerationState,
  validateRoomChoices,
  ROOM_TYPES,
  SECRET_TYPES,
} from '../utils/roomGeneration';
import { getRunInventoryLayout, insertItems, migrateRunInventory } from '../utils/expeditionInventory';
import { buildRoomArtworkWindowKey, resolveRoomChoiceArtworks, resolveRoomTypeArtwork } from '../utils/roomArtwork';

const MINI_BOSS_CHANCE = 0.03;
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const pickRandom = (list = []) => list[Math.floor(Math.random() * list.length)] ?? null;
const appendRunInventoryItems = (player, items) => {
  const layout = getRunInventoryLayout(player?.equipment);
  const slots = migrateRunInventory(player?.runInventory || [], player?.equipment, player?.runInventoryLayoutVersion);
  return insertItems(slots, items.map(item => ({ itemId: normalizeItemName(item.name || item.itemId), quantity: item.quantity || 1 })), { layout });
};

const DungeonScreen = ({
  player,
  autobattleUnlocked = false,
  onEnterDungeon,
  onReturnToGuild,
  hasPortalStone = false,
  onUsePortalStone,
  onSeverAbyssLink,
  onUpdatePlayer,
  onQuestEvent,
  onPendingLoot,
  encounterCounters = {},
  onToggleSafeSlot,
  safeSlotLimit = SAFE_SLOT_LIMIT,
  expeditionCell = null,
  onExpeditionCellContent,
  onExpeditionCellResolved,
  onExpeditionCellCancel,
}) => {
  const tarotSpread = useMemo(
    () => (Array.isArray(player?.tarotSpread) ? player.tarotSpread : []),
    [player?.tarotSpread]
  );
  const { pushToast } = useToast();
  const activeRelicState = ensureRelicState(player?.relics);
  const activeRelicMaxed = (activeRelicState.progress?.[activeRelicState.activeRelicId]?.level || 0) >= 10;
  const tarotDetails = useMemo(
    () => tarotSpread.map(id => getTarotCardById(id)).filter(Boolean),
    [tarotSpread]
  );
  const selectedLocation = player?.currentLocation || null;
  const activeLocation = getLocationByName(selectedLocation);
  const locationEnemies = useMemo(
    () => enemies.filter(e => e.location === selectedLocation),
    [selectedLocation]
  );

  const nonBossEnemies = useMemo(
    () => locationEnemies.filter(e => !e.boss),
    [locationEnemies]
  );
  const bossEnemies = useMemo(() => locationEnemies.filter(e => e.boss), [locationEnemies]);
  const roomGenerationLocationState = getLocationRoomGenerationState(player?.roomGenerationState, selectedLocation);
  const completedCombatRooms = roomGenerationLocationState.completedCombatRooms || 0;
  const bossName = bossEnemies[0]?.name || 'Босс';
  const miniBossEnemies = useMemo(
    () => nonBossEnemies.filter(e => e.miniBoss),
    [nonBossEnemies]
  );
  const trashEnemies = useMemo(
    () => getTrashEnemyPool({ nonBossEnemies, selectedLocation, completedCombatRooms, expeditionRegion: expeditionCell?.region }),
    [completedCombatRooms, nonBossEnemies, selectedLocation, expeditionCell?.region]
  );
  const cursedEnemyPool = useMemo(
    () => getCursedEnemyPool(nonBossEnemies),
    [nonBossEnemies]
  );
  const eligibleCursePool = useMemo(
    () => getEligibleCursePool(
      player?.curses,
      player?.dominantCurseId,
      player?.abyssLevel
    ),
    [player?.abyssLevel, player?.curses, player?.dominantCurseId]
  );
  const activeSublocationDefinition = useMemo(
    () => getSublocationDefinition(
      selectedLocation,
      expeditionCell?.sublocationId || player?.expeditionMap?.state?.selectedSublocationId
    ),
    [expeditionCell?.sublocationId, player?.expeditionMap?.state?.selectedSublocationId, selectedLocation]
  );

  const buildFightEncounter = useCallback((
    encounterKind = 'combat',
    {
      requireStrong = false,
      sublocationDefinition = null,
    } = {}
  ) => {
    if (encounterKind === 'cursed') {
      const cursedEncounter = createCursedEncounter(cursedEnemyPool, Math.random, {
        weightOf: enemy => {
          if (sublocationDefinition?.effectId !== 'cursed-rubble') return 1;
          const name = String(enemy?.name || '');
          return /Оскверн|Искаж/i.test(name) ? 3 : 1;
        },
      });
      if (cursedEncounter) return cursedEncounter;
    }

    const encounterCompletedRooms = requireStrong ? Number.MAX_SAFE_INTEGER : completedCombatRooms;
    const encounterPool = requireStrong
      ? getTrashEnemyPool({ nonBossEnemies, selectedLocation, completedCombatRooms: encounterCompletedRooms, expeditionRegion: expeditionCell?.region })
      : trashEnemies;

    if (selectedLocation === DESERTER_LOCATION) {
      const deserterEncounter = createDeserterCampEncounter(encounterPool, Math.random, {
        completedCombatRooms: encounterCompletedRooms,
        requireStrong,
      });
      if (deserterEncounter) {
        return applyDeserterAlertModifier({
          ...deserterEncounter,
          completedCombatRooms: encounterCompletedRooms,
          pool: encounterPool,
          rng: Math.random,
        });
      }
    }

    if (selectedLocation === GOBLIN_LOCATION) {
      const goblinEncounter = createGoblinNestsEncounter(encounterPool, Math.random, {
        completedCombatRooms: encounterCompletedRooms,
        requireStrong,
        preferredStrongEnemies: sublocationDefinition?.preferredStrongEnemies || [],
        preferredMultiplier: 4,
        expeditionRegion: expeditionCell?.region,
      });
      if (goblinEncounter) return goblinEncounter;
    }

    if (selectedLocation === FUNGAL_LOCATION) {
      const mushroomEncounter = createMushroomCavesEncounter(encounterPool, Math.random, {
        completedCombatRooms: encounterCompletedRooms,
        requireStrong,
      });
      if (mushroomEncounter) return mushroomEncounter;
    }

    if (selectedLocation === WITHERING_FOREST_LOCATION) {
      const forestEncounter = createWitheringForestEncounter(encounterPool, Math.random, {
        completedCombatRooms: encounterCompletedRooms,
        requireStrong,
        previousTemplateKey: player?.lastWitheringForestEncounterTemplateKey || null,
      });
      if (forestEncounter) return forestEncounter;
    }

    if (selectedLocation === RESTLESS_RUINS_LOCATION) {
      const ruinsEncounter = createRestlessRuinsEncounter(encounterPool, Math.random, {
        completedCombatRooms: encounterCompletedRooms, requireStrong,
      });
      if (ruinsEncounter) return ruinsEncounter;
    }

    if (selectedLocation === MINES_OF_DECAY_LOCATION) {
      const minesEncounter = createMinesOfDecayEncounter(encounterPool, Math.random, {
        completedCombatRooms: encounterCompletedRooms, requireStrong,
      });
      if (minesEncounter) return minesEncounter;
    }

    // Never silently fall back to generic two-enemy packs on floor II.
    if ([WITHERING_FOREST_LOCATION, RESTLESS_RUINS_LOCATION, MINES_OF_DECAY_LOCATION].includes(selectedLocation)) {
      throw new Error(`Missing authored three-enemy encounter for ${selectedLocation}`);
    }

    const canSpawnMini = false;
    const spawnMini = canSpawnMini && Math.random() < MINI_BOSS_CHANCE;
    if (spawnMini) {
      const chosenMini = pickRandom(miniBossEnemies);
      if (chosenMini) {
        return { enemies: [chosenMini], miniBoss: true };
      }
    }

    if (encounterPool.length > 0 && !requireStrong) {
      const encounter = { enemies: createEncounterPair(encounterPool, Math.random, { location: selectedLocation }), miniBoss: false };
      return encounter;
    }

    if (canSpawnMini) {
      const fallbackMini = pickRandom(miniBossEnemies);
      if (fallbackMini) {
        return { enemies: [fallbackMini], miniBoss: true };
      }
    }

    return { enemies: [], miniBoss: false };
  }, [miniBossEnemies, trashEnemies, cursedEnemyPool, selectedLocation, completedCombatRooms, nonBossEnemies, player?.lastWitheringForestEncounterTemplateKey, expeditionCell?.region]);

  const generatePaths = useCallback((stateOverride = null) => {
    if (!selectedLocation) return { choices: [], state: null };
    const localBoss = bossEnemies[0];
    if (expeditionCell?.phase === 'boss') {
      return { choices: [{ id: `${expeditionCell.id}-boss`, type: 'Босс', roomType: ROOM_TYPES.BOSS, enemies: localBoss ? [localBoss] : [] }], state: null };
    }
    if (expeditionCell?.phase === 'depth' && [ROOM_TYPES.COMBAT, ROOM_TYPES.CURSED_ENEMY].includes(expeditionCell?.previewRoomType)) {
      const useCursed = expeditionCell.previewRoomType === ROOM_TYPES.CURSED_ENEMY;
      const encounter = buildFightEncounter(useCursed ? 'cursed' : 'combat', { requireStrong: !useCursed });
      const abyssPower = createAbyssPowerDescriptor();
      const depthEnemies = (useCursed ? encounter?.enemies?.slice(0, 1) : encounter?.enemies || [])
        .map(enemy => applyAbyssPowerToEnemy(enemy));
      return { choices: [{ id: `${expeditionCell.id}-depth`, type: useCursed ? 'Проклятый враг' : 'Бой', roomType: useCursed ? ROOM_TYPES.CURSED_ENEMY : ROOM_TYPES.COMBAT, enemies: depthEnemies, encounterStrength: encounter?.encounterStrength, abyssPower }], state: null };
    }
    if (expeditionCell?.previewRoomType) {
      const savedRoomState = stateOverride || getLocationRoomGenerationState(player?.roomGenerationState, selectedLocation);
      const activeRoomState = [WITHERING_FOREST_LOCATION, RESTLESS_RUINS_LOCATION, MINES_OF_DECAY_LOCATION].includes(selectedLocation)
        ? { ...savedRoomState, progressionTuning: LEVEL_TWO_PROGRESSION }
        : savedRoomState;
      const inSublocation = expeditionCell.region === 'sublocation';
      const buildExpeditionFight = encounterKind => buildFightEncounter(encounterKind, {
        requireStrong: inSublocation && encounterKind !== 'cursed',
        sublocationDefinition: inSublocation ? activeSublocationDefinition : null,
      });
      const path = buildRoomPayload(expeditionCell.previewRoomType, {
        locationName: selectedLocation,
        state: activeRoomState,
        rng: Math.random,
        bossEnemy: localBoss,
        hasBossEnemy: Boolean(localBoss),
        hasCursedEnemyPool: cursedEnemyPool.length > 0,
        buildFightEncounter: buildExpeditionFight,
        rollChestLoot: primordialSource => rollTreasureLoot(selectedLocation, 2, 3, {
          primordialSource,
          expeditionZone: expeditionCell.region,
          sublocationId: expeditionCell.sublocationId,
        }),
        cursePool: eligibleCursePool,
        allowSecretCurseAltar: false,
      });
      return {
        choices: [{
          ...path,
          id: `${expeditionCell.id}-content`,
          expeditionZone: expeditionCell.region,
          sublocationId: expeditionCell.sublocationId || null,
          sublocationEffectId: inSublocation ? activeSublocationDefinition?.effectId || null : null,
        }],
        state: null,
      };
    }
    const savedRoomState = stateOverride || getLocationRoomGenerationState(player?.roomGenerationState, selectedLocation);
    const activeRoomState = [WITHERING_FOREST_LOCATION, RESTLESS_RUINS_LOCATION, MINES_OF_DECAY_LOCATION].includes(selectedLocation)
      ? { ...savedRoomState, progressionTuning: LEVEL_TWO_PROGRESSION }
      : savedRoomState;
    const { choices, state } = generateRoomChoices({
      locationName: selectedLocation,
      state: activeRoomState,
      bossEnemy: localBoss,
      hasBossEnemy: Boolean(localBoss),
      hasCursedEnemyPool: cursedEnemyPool.length > 0,
      buildFightEncounter,
      rollChestLoot: primordialSource => rollTreasureLoot(selectedLocation, 2, 3, { primordialSource }),
      cursePool: eligibleCursePool,
    });
    return { choices, state };
  }, [activeSublocationDefinition, bossEnemies, buildFightEncounter, cursedEnemyPool.length, eligibleCursePool, expeditionCell, player?.roomGenerationState, selectedLocation]);

  const [paths, setPaths] = useState(() => []);
  const [lockpickChallenge, setLockpickChallenge] = useState(null);
  const [trapChallenge, setTrapChallenge] = useState(null);
  const trapResolvedRef = useRef(false);
  const [activeAltar, setActiveAltar] = useState(null);
  const [altarResolving, setAltarResolving] = useState(false);
  const [fishingChallenge, setFishingChallenge] = useState(null);
  const [showInventoryModal, setShowInventoryModal] = useState(false);
  const [showFieldCrafting, setShowFieldCrafting] = useState(false);
  const [inspectedRoomEnemy, setInspectedRoomEnemy] = useState(null);
  const [resolvingPathId, setResolvingPathId] = useState(null);
  const claimedPathIdsRef = useRef(new Set());
  const autoStartedExpeditionPathRef = useRef(null);
  const altarResolvingRef = useRef(false);
  const interactionBlocked = Boolean(
    resolvingPathId ||
    lockpickChallenge ||
    trapChallenge ||
    activeAltar ||
    fishingChallenge ||
    showInventoryModal ||
    showFieldCrafting ||
    inspectedRoomEnemy
  );
  const roomArtworkWindowKey = useMemo(() => buildRoomArtworkWindowKey({
    locationId: activeLocation?.id,
    rooms: paths,
    choiceWindowIndex: roomGenerationLocationState.choiceWindowIndex,
  }), [activeLocation?.id, paths, roomGenerationLocationState.choiceWindowIndex]);
  const roomArtworkUrls = useMemo(() => resolveRoomChoiceArtworks({
    locationId: activeLocation?.id,
    rooms: paths,
    stableWindowKey: roomArtworkWindowKey,
  }), [activeLocation?.id, paths, roomArtworkWindowKey]);

  const persistPathState = useCallback((nextPaths, nextEvent = null, nextRoomState = null) => {
    const visiblePaths = expeditionCell ? nextPaths.slice(0, 1) : nextPaths;
    setPaths(visiblePaths);
    if (expeditionCell && visiblePaths[0]) onExpeditionCellContent?.(visiblePaths[0]);
    if (!selectedLocation) return;
    if (onUpdatePlayer) {
      onUpdatePlayer(prev => ({
        currentDungeonChoices: expeditionCell ? null : nextPaths,
        currentDungeonChoicesLocation: selectedLocation,
        currentPathEvent: nextEvent,
        ...(nextRoomState
          ? {
              roomGenerationState: {
                ...(prev?.roomGenerationState || {}),
                [selectedLocation]: nextRoomState,
              },
            }
          : {}),
      }));
    }
  }, [expeditionCell, onExpeditionCellContent, onUpdatePlayer, selectedLocation]);

  const refreshPaths = useCallback(() => {
    setResolvingPathId(null);
    claimedPathIdsRef.current = new Set();
    if (expeditionCell) {
      setPaths([]);
      onExpeditionCellResolved?.();
      return;
    }
    if (!selectedLocation) {
      setPaths([]);
      return;
    }
    const { choices, state } = generatePaths();
    persistPathState(choices, null, state);
  }, [expeditionCell, generatePaths, onExpeditionCellResolved, persistPathState, selectedLocation]);

  useEffect(() => {
    if (!selectedLocation) {
      setPaths([]);
      return;
    }
    if (expeditionCell) {
      if (expeditionCell.content) setPaths([expeditionCell.content]);
      else {
        const generated = generatePaths();
        persistPathState(generated.choices, null, generated.state);
      }
      return;
    }
    const savedChoices = Array.isArray(player?.currentDungeonChoices) ? player.currentDungeonChoices : null;
    const savedLocation = player?.currentDungeonChoicesLocation;
    if (savedChoices && savedLocation === selectedLocation) {
      const activeRoomState = getLocationRoomGenerationState(player?.roomGenerationState, selectedLocation);
      const migratedChoices = migrateLegacySecretRoomChoices(savedChoices, { locationName: selectedLocation });
      const savedChoicesAreValid = validateRoomChoices(migratedChoices, {
        state: activeRoomState,
        bossEnemy: bossEnemies[0],
        hasBossEnemy: bossEnemies.length > 0,
        hasCursedEnemyPool: cursedEnemyPool.length > 0,
      });
      if (savedChoicesAreValid) {
        setPaths(migratedChoices);
        if (migratedChoices.some((choice, index) => choice !== savedChoices[index])) {
          onUpdatePlayer?.({ currentDungeonChoices: migratedChoices });
        }
        return;
      }
    }
    refreshPaths();
  }, [bossEnemies, cursedEnemyPool.length, expeditionCell, generatePaths, onUpdatePlayer, persistPathState, player?.currentDungeonChoices, player?.currentDungeonChoicesLocation, player?.roomGenerationState, refreshPaths, selectedLocation]);

  useEffect(() => {
    const event = player?.currentPathEvent;
    if (event?.type === 'Алтарь' && event?.status === 'active') {
      const curseIds = getAltarCurseIds(event);
      setActiveAltar({ curseId: curseIds.includes(event.curseId) ? event.curseId : curseIds[0], curseIds, pathId: event.pathId });
    }
  }, [player?.currentPathEvent]);


  const normalizeLootEntry = (entry) => {
    if (!entry) return null;
    if (typeof entry === 'string') {
      const trimmed = normalizeItemName(entry);
      return trimmed ? { name: trimmed, quantity: 1 } : null;
    }
    const normalizedName = normalizeItemName(entry.name);
    if (!normalizedName) return null;
    return { name: normalizedName, quantity: entry.quantity ?? 1 };
  };

  const grantChestRewards = useCallback((lootRoll) => {
    let loot = Array.isArray(lootRoll) && lootRoll.length > 0
      ? [...lootRoll]
      : rollTreasureLoot(selectedLocation, 2, 3, { primordialSource: 'treasureRoom' });
    const chestModifiers = getTarotChestModifiers(tarotSpread);
    if (chestModifiers.extraRolls > 0) {
      for (let i = 0; i < chestModifiers.extraRolls; i += 1) {
        loot = loot.concat(rollTreasureLoot(selectedLocation, 1, 1));
      }
    }
    if (chestModifiers.removeRolls > 0) {
      for (let i = 0; i < chestModifiers.removeRolls && loot.length > 0; i += 1) {
        loot.splice(Math.floor(Math.random() * loot.length), 1);
      }
    }
    let silverGain = 0;
    const itemRewards = [];
    loot.forEach(entry => {
      const normalized = normalizeLootEntry(entry);
      if (!normalized) return;
      if (normalized.name === 'Серебро') {
        silverGain += normalized.quantity || 0;
      } else {
        itemRewards.push(normalized);
      }
    });

    if (onPendingLoot) {
      onPendingLoot({ source: 'treasure', silver: silverGain, items: itemRewards });
      return { silverGain, itemRewards };
    }

    let updatedInventoryRef = null;
    let updatedSilverRef = 0;

    if (onUpdatePlayer) {
      onUpdatePlayer(prev => {
        if (!prev) return prev;
        const insertion = appendRunInventoryItems(prev, itemRewards);
        updatedInventoryRef = insertion.slots;
        updatedSilverRef = (prev.silver || 0) + silverGain;
        return { ...prev, runInventory: insertion.slots, silver: updatedSilverRef };
      });
    }

    if (onQuestEvent && updatedInventoryRef) {
      onQuestEvent(
        [{ type: QUEST_EVENTS.INVENTORY_CHECK, runInventory: updatedInventoryRef }],
        { runInventory: updatedInventoryRef }
      );
    }

    return { silverGain, itemRewards };
  }, [onPendingLoot, onUpdatePlayer, onQuestEvent, selectedLocation, tarotSpread]);

  const startLockpickChallenge = useCallback((lootRoll) => {
    setLockpickChallenge({ loot: lootRoll });
  }, []);

  const startTrapChallenge = useCallback((path) => {
    trapResolvedRef.current = false;
    setTrapChallenge({
      metalReward: getTrapMetal(selectedLocation, player?.abyssLevel),
      metalQuantity: randomInt(1, 3),
      ambush: createTrapAmbush(locationEnemies, selectedLocation, completedCombatRooms),
      combatContext: {
        expeditionZone: path?.expeditionZone || expeditionCell?.region || null,
        sublocationId: path?.sublocationId || expeditionCell?.sublocationId || null,
        sublocationEffectId: path?.sublocationEffectId
          || (expeditionCell?.region === 'sublocation' ? activeSublocationDefinition?.effectId || null : null),
      },
    });
  }, [selectedLocation, player?.abyssLevel, locationEnemies, completedCombatRooms, expeditionCell, activeSublocationDefinition]);

  const handleLockpickSuccess = useCallback(() => {
    if (!lockpickChallenge) return;
    grantChestRewards(lockpickChallenge.loot);
    setLockpickChallenge(null);
    refreshPaths();
  }, [grantChestRewards, lockpickChallenge, refreshPaths]);

  const handleLockpickFailure = useCallback(() => {
    setLockpickChallenge(null);
    refreshPaths();
  }, [refreshPaths]);

  const grantResourceRewards = useCallback((path) => {
    const pathId = path?.id || null;
    if (pathId && claimedPathIdsRef.current.has(pathId)) return;
    if (pathId) {
      setResolvingPathId(pathId);
      claimedPathIdsRef.current.add(pathId);
    }
    const loot = Array.isArray(path?.loot) ? path.loot.filter(entry => entry?.name) : [];
    if (loot.length === 0) {
      refreshPaths();
      return;
    }
    if (onPendingLoot) {
      onPendingLoot({ source: 'resource', silver: 0, items: loot });
      refreshPaths();
      return;
    }

    let updatedInventory = null;
    if (!onUpdatePlayer) {
      refreshPaths();
      return;
    }

    onUpdatePlayer(prev => {
      if (!prev) return prev;
      const insertion = appendRunInventoryItems(prev, loot);
      updatedInventory = insertion.slots;
      return { runInventory: insertion.slots };
    });

    if (onQuestEvent && updatedInventory) {
      onQuestEvent(
        [{ type: QUEST_EVENTS.INVENTORY_CHECK, runInventory: updatedInventory }],
        { runInventory: updatedInventory }
      );
    }

    refreshPaths();
  }, [onPendingLoot, onQuestEvent, onUpdatePlayer, refreshPaths]);

  const revealSecretPath = (path) => {
    if (!path || path.roomType !== ROOM_TYPES.SECRET) return path;
    const payload = path.hiddenPayload || {};
    switch (path.hiddenRoomType) {
      case SECRET_TYPES.TREASURE:
        return { ...payload, id: path.id, type: 'Сокровище', roomType: ROOM_TYPES.TREASURE, fromSecret: true };
      case SECRET_TYPES.COMBAT:
        return { ...payload, id: path.id, type: 'Бой', roomType: ROOM_TYPES.COMBAT, fromSecret: true };
      case SECRET_TYPES.CURSED_ENEMY:
        return { ...payload, id: path.id, type: 'Проклятый враг', roomType: ROOM_TYPES.CURSED_ENEMY, fromSecret: true };
      case SECRET_TYPES.TRAP:
        return { ...payload, id: path.id, type: 'Ловушка', roomType: 'SECRET_TRAP', fromSecret: true };
      case SECRET_TYPES.RESOURCE:
        return { ...payload, id: path.id, type: 'Ресурсы', roomType: ROOM_TYPES.RESOURCE, fromSecret: true };
      case SECRET_TYPES.CURSE_ALTAR:
        return { ...payload, id: path.id, type: 'Алтарь', roomType: ROOM_TYPES.CURSE_ALTAR, fromSecret: true };
      case SECRET_TYPES.FISHING:
        return { ...payload, id: path.id, type: 'Рыбалка', roomType: ROOM_TYPES.FISHING, fromSecret: true };
      default:
        return { ...payload, id: path.id, type: 'Ресурсы', roomType: ROOM_TYPES.RESOURCE, fromSecret: true };
    }
  };

  const handlePathSelect = (selectedPath) => {
    if (interactionBlocked) return;
    const selectedPathId = selectedPath?.id || null;
    if (selectedPathId && claimedPathIdsRef.current.has(selectedPathId)) return;
    const path = revealSecretPath(selectedPath);
    if (!selectedLocation) {
      pushToast('Локация не выбрана', { tone: 'warning' });
      return;
    }
    if (path.type === 'Бой' || path.type === 'Босс' || path.type === 'Проклятый враг') {
      const encounterDetails =
        path.type === 'Босс'
          ? { enemies: path.enemies || [bossEnemies[0]], miniBoss: false }
          : path.enemies && path.enemies.length > 0
            ? { enemies: path.enemies, miniBoss: path.miniBoss }
            : buildFightEncounter(path.roomType === ROOM_TYPES.CURSED_ENEMY ? 'cursed' : 'combat');
      const encounter = encounterDetails.enemies;
      if (!encounter || encounter.length === 0) {
        pushToast('Нет подходящих врагов для боя', { tone: 'warning' });
        return;
      }
      const forestTemplateKey = path.encounterTemplateKey || encounterDetails.encounterTemplateKey || null;
      if (selectedLocation === WITHERING_FOREST_LOCATION && forestTemplateKey && onUpdatePlayer) {
        onUpdatePlayer({ lastWitheringForestEncounterTemplateKey: forestTemplateKey });
      }
      onEnterDungeon(
        encounter,
        path.type === 'Босс',
        selectedLocation,
        path.roomType,
        {
          expeditionZone: path.expeditionZone || expeditionCell?.region || null,
          sublocationId: path.sublocationId || expeditionCell?.sublocationId || null,
          sublocationEffectId: path.sublocationEffectId
            || (expeditionCell?.region === 'sublocation' ? activeSublocationDefinition?.effectId || null : null),
        }
      );
    } else if (path.type === 'Сокровище') {
      const lootRoll = Array.isArray(path.loot) && path.loot.length > 0
        ? path.loot
        : rollTreasureLoot(selectedLocation, 2, 3, { primordialSource: path.fromSecret ? 'secretRoom' : 'treasureRoom' });
      startLockpickChallenge(lootRoll);
      return;
    } else if (path.type === 'Ловушка') {
      startTrapChallenge(path);
      return;
    } else if (path.type === 'Ресурсы') {
      grantResourceRewards(path);
      return;
    } else if (path.type === 'Алтарь') {
      const curseIds = getAltarCurseIds(path).filter(id => getCurseDefinition(id));
      const curseDef = getCurseDefinition(curseIds[0]);
      if (!curseDef) {
        pushToast('Алтарь разрушен и не даёт силы', { tone: 'warning' });
        refreshPaths();
        return;
      }
      const pathId = path.id || `altar-${path.curseId || 'unknown'}`;
      claimedPathIdsRef.current.add(pathId);
      const altarEvent = { type: 'Алтарь', status: 'active', pathId, curseId: curseIds[0], curseIds };
      setActiveAltar({ curseId: curseIds[0], curseIds, pathId });
      if (onUpdatePlayer) {
        onUpdatePlayer({ currentPathEvent: altarEvent });
      }
      return;
    } else if (path.type === 'Рыбалка') {
      const challenge = createFishingChallenge(selectedLocation, player?.fishingSetup || {});
      if (!challenge) {
        refreshPaths();
        return;
      }
      setFishingChallenge(challenge);
      return;
    }
    refreshPaths();
  };

  useEffect(() => {
    if (!expeditionCell || paths.length !== 1 || interactionBlocked) return undefined;
    const path = paths[0];
    if ([ROOM_TYPES.COMBAT, ROOM_TYPES.CURSED_ENEMY, ROOM_TYPES.BOSS].includes(path?.roomType)) {
      return undefined;
    }
    const pathId = path?.id || expeditionCell.id;
    if (autoStartedExpeditionPathRef.current === pathId) return undefined;
    autoStartedExpeditionPathRef.current = pathId;
    handlePathSelect(path);
    // handlePathSelect intentionally follows the current render state; pathId is the one-shot guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expeditionCell, interactionBlocked, paths]);

  const handleTrapResolution = useCallback((result) => {
    if (!trapChallenge || trapResolvedRef.current) return;
    if (result?.success && !onPendingLoot) {
      pushToast('Не удалось открыть добычу.', { tone: 'warning' });
      return;
    }
    trapResolvedRef.current = true;
    const activeChallenge = trapChallenge;
    setTrapChallenge(null);
    if (result?.method === 'abandon') {
      refreshPaths();
      return;
    }
    if (result?.success) {
      onPendingLoot({ source: 'trap', silver: 0,
        items: [{ name: activeChallenge.metalReward, quantity: activeChallenge.metalQuantity }] });
      refreshPaths();
      return;
    }
    if (activeChallenge.ambush.length) {
      // The trap cell is completed by the combat result, not before combat begins.
      onEnterDungeon(activeChallenge.ambush, false, selectedLocation, 'TRAP_ENEMY', activeChallenge.combatContext);
    } else {
      pushToast('На шум никто не пришёл.', { tone: 'warning' });
      refreshPaths();
    }
  }, [trapChallenge, onPendingLoot, pushToast, refreshPaths, onEnterDungeon, selectedLocation]);

  const handleFishingSuccess = useCallback(() => {
    if (!fishingChallenge) return;
    const fishName = normalizeItemName(fishingChallenge.rewards?.fishItem);
    if (!onPendingLoot) {
      pushToast('Не удалось открыть улов. Попробуйте вернуться к водоёму.', { tone: 'warning' });
      return;
    }
    onPendingLoot({ source: 'fishing', silver: fishingChallenge.rewards?.silver || 0,
      items: fishName ? [{ name: fishName, quantity: 1 }] : [] });
    setFishingChallenge(null);
    refreshPaths();
  }, [fishingChallenge, onPendingLoot, pushToast, refreshPaths]);

  const handleFishingFailure = useCallback(() => {
    setFishingChallenge(null);
    refreshPaths();
  }, [refreshPaths]);

  const handleFishingClose = useCallback(() => {
    setFishingChallenge(null);
    refreshPaths();
  }, [refreshPaths]);

  const handleAltarOffer = useCallback(() => {
    if (!activeAltar || !getAltarCurseIds(activeAltar).includes(activeAltar.curseId) || !onUpdatePlayer || altarResolvingRef.current || altarResolving) return;
    altarResolvingRef.current = true;
    setAltarResolving(true);

    const outcome = resolveCurseOffering(
      player?.curses,
      activeAltar.curseId,
      player?.dominantCurseId,
      { abyssLevel: player?.abyssLevel }
    );

    if (!outcome?.accepted) {
      altarResolvingRef.current = false;
      setAltarResolving(false);
      return;
    }

    if (activeAltar.pathId) {
      claimedPathIdsRef.current.add(activeAltar.pathId);
    }

    onUpdatePlayer({
      currentDungeonChoices: null,
      currentDungeonChoicesLocation: null,
      currentPathEvent: null,
      curses: outcome.nextState,
      dominantCurseId: outcome.dominantCurseId,
    });

    setActiveAltar(null);
    refreshPaths();
    altarResolvingRef.current = false;
    setAltarResolving(false);
  }, [
    activeAltar,
    altarResolving,
    onUpdatePlayer,
    player?.abyssLevel,
    player?.curses,
    player?.dominantCurseId,
    refreshPaths,
  ]);

  const handleAltarClose = useCallback(() => {
    altarResolvingRef.current = false;
    setAltarResolving(false);
    setActiveAltar(null);
    if (onUpdatePlayer) {
      onUpdatePlayer({ currentPathEvent: null });
    }
    refreshPaths();
  }, [onUpdatePlayer, refreshPaths]);

  const activeCurseList = useMemo(() => getActiveCursesList(player?.curses), [player?.curses]);
  const abyssBound = isAbyssBound(player?.curses);
  const altarDefinition = activeAltar ? getCurseDefinition(activeAltar.curseId) : null;
  const altarPreview = activeAltar
    ? getNextCurseTierPreview(
        player?.curses,
        activeAltar.curseId,
        player?.dominantCurseId,
        { abyssLevel: player?.abyssLevel }
      )
    : null;
  const altarTier = activeAltar ? getCurseTier(player?.curses, activeAltar.curseId) : 0;
  const altarArtwork = useMemo(
    () => activeAltar ? resolveRoomTypeArtwork(activeLocation?.id, ROOM_TYPES.CURSE_ALTAR) : null,
    [activeAltar, activeLocation?.id]
  );
  const runEffects = useMemo(() => {
    const effects = [];
    const locationEffect = LOCATION_EFFECTS[selectedLocation];
    if (locationEffect) {
      effects.push({ ...locationEffect, completedCombatRooms, kind: 'location', symbol: 'Л' });
    } else if (activeLocation?.identityText) {
      effects.push({
        id: `location-${activeLocation.id}`,
        name: 'Особенность локации',
        description: activeLocation.identityText,
        kind: 'location',
        symbol: 'Л',
      });
    }
    activeCurseList.forEach(curse => {
      const definition = getCurseDefinition(curse.id);
      const dominant = player?.dominantCurseId === curse.id;
      effects.push({
        id: `curse-${curse.id}`,
        name: `${curse.name} (${['—', 'I', 'II', 'III', 'IV', 'V'][curse.tier]})${dominant ? ' — Главное Проклятие' : ''}`,
        description: formatActiveCurseText(definition, curse.tier),
        kind: 'curse',
        symbol: definition?.presentation?.symbol,
        accent: definition?.presentation?.accent,
        dominant,
      });
    });
    if (abyssBound) effects.push({
      id: 'abyss-binding',
      name: 'Связь с Бездной',
      description: 'Проклятие V уровня связало героя с Бездной. Обычная эвакуация невозможна. Разорвать связь можно только ценой жизни.',
      kind: 'system',
      symbol: '⛓',
    });
    tarotDetails.forEach(card => effects.push({
      id: `tarot-${card.id}`,
      name: card.name,
      description: card.description,
      kind: 'tarot',
      symbol: 'Т',
    }));
    return effects;
  }, [abyssBound, activeCurseList, activeLocation, selectedLocation, tarotDetails, completedCombatRooms, player?.dominantCurseId]);

  const expeditionCombatPreviewPath = (
    expeditionCell
    && paths.length === 1
    && [ROOM_TYPES.COMBAT, ROOM_TYPES.CURSED_ENEMY, ROOM_TYPES.BOSS].includes(paths[0]?.roomType)
  ) ? paths[0] : null;

  return (
    <>
      <div className="dungeon-run-screen">
        {!expeditionCombatPreviewPath && (
          <>
            <h2 className="dungeon-run-screen__location">{selectedLocation || 'Локация не выбрана'}</h2>
            <DungeonRunHud
              effects={runEffects}
              resonance={activeRelicMaxed ? null : (player?.runResonance || 0)}
              onOpenInventory={() => setShowInventoryModal(true)}
              onOpenCrafting={() => setShowFieldCrafting(true)}
              onUsePortal={onUsePortalStone}
              portalAvailable={hasPortalStone}
              portalBlockedReason={abyssBound ? 'Камень портала не отвечает: герой связан с Бездной' : null}
              abyssBound={abyssBound}
              onSeverAbyssLink={onSeverAbyssLink}
              utilitiesDisabled={interactionBlocked}
            />
          </>
        )}
        {expeditionCell && paths.length === 0 && (
          <p className="dungeon-run-screen__choice-heading">Открываем событие…</p>
        )}
        {expeditionCombatPreviewPath && (
          <ExpeditionCombatPreview
            autobattleUnlocked={autobattleUnlocked}
            onAutobattleChange={enabled => { if (autobattleUnlocked) onUpdatePlayer?.({ autobattleEnabled: enabled }); }}
            onUseFieldItem={slotIndex => onUpdatePlayer?.(previous => applyInventoryItemUse(previous, slotIndex, { inExpedition: true, inCombat: false }).player)}
            room={expeditionCombatPreviewPath}
            player={player}
            locationEffect={LOCATION_EFFECTS[selectedLocation] || null}
            sublocationDefinition={activeSublocationDefinition}
            onEnter={handlePathSelect}
            onRetreat={onExpeditionCellCancel}
            onInspectEnemy={setInspectedRoomEnemy}
          />
        )}
        {!expeditionCell && <>
          <p className="dungeon-run-screen__choice-heading">Выберите путь</p>
          <div className="room-choice-list">
            {paths.map((path, index) => (
              <RoomChoiceCard
                key={path.id || index}
                room={path}
                pathNumber={index + 1}
                disabled={interactionBlocked}
                onSelect={handlePathSelect}
                bossName={bossName}
                artworkUrl={roomArtworkUrls[index]}
                onInspectEnemy={setInspectedRoomEnemy}
              />
            ))}
          </div>
        </>}
      </div>
      {inspectedRoomEnemy && (
        <div
          className="enemy-detail-overlay"
          onMouseDown={event => { if (event.target === event.currentTarget) setInspectedRoomEnemy(null); }}
        >
          <EnemyDetailCard enemy={inspectedRoomEnemy} onClose={() => setInspectedRoomEnemy(null)} />
        </div>
      )}
      {lockpickChallenge && (
        <LockpickMinigame
          challenge={lockpickChallenge}
          onSuccess={handleLockpickSuccess}
          onFail={handleLockpickFailure}
        />
      )}
      {fishingChallenge && (
        <FishingRoomModal
          challenge={fishingChallenge}
          onSuccess={handleFishingSuccess}
          onFail={handleFishingFailure}
          onClose={handleFishingClose}
        />
      )}
      {trapChallenge && (
        <TrapDisarmModal
          challenge={trapChallenge}
          onResolve={handleTrapResolution}
          onCancel={() => handleTrapResolution({ method: 'abandon', success: false })}
        />
      )}
      {activeAltar && altarDefinition && (
        <AltarRoomModal
          curse={altarDefinition}
          choices={getAltarCurseIds(activeAltar).map(id => ({ curse: getCurseDefinition(id), preview: getNextCurseTierPreview(player?.curses, id, player?.dominantCurseId, { abyssLevel: player?.abyssLevel }) })).filter(choice => choice.curse)}
          onSelect={curseId => {
            if (altarResolvingRef.current || !getAltarCurseIds(activeAltar).includes(curseId)) return;
            const next = { ...activeAltar, curseId };
            setActiveAltar(next);
            onUpdatePlayer?.({ currentPathEvent: { ...next, type: 'Алтарь', status: 'active' } });
          }}
          currentTier={altarTier}
          preview={altarPreview}
          illustrationUrl={altarArtwork}
          onOffer={handleAltarOffer}
          offerDisabled={altarResolving}
          onClose={handleAltarClose}
        />
      )}
      {showInventoryModal && (
        <DungeonInventoryModal
          player={player}
          onClose={() => setShowInventoryModal(false)}
          onUpdatePlayer={onUpdatePlayer}
          onToggleSafeSlot={onToggleSafeSlot}
          safeSlotLimit={safeSlotLimit}
        />
      )}
      {showFieldCrafting && (
        <FieldCraftingModal player={player} onClose={() => setShowFieldCrafting(false)} onUpdatePlayer={onUpdatePlayer} />
      )}
    </>
  );
};

export default DungeonScreen;

