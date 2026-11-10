import { placeGuardedGoblinContent } from './goblinCaverns';
import { getSublocationDefinition, getSublocationIdsForLocation } from '../data/expeditionSublocations';
import {
  createExpeditionMapState,
  grantExpeditionKey,
  hasExpeditionKey,
  selectSublocation,
  unlockBossWithKey,
  unlockDepthWithKey,
} from './expeditionMap';
import {
  applyMapProgressLocks,
  generateMainExpeditionLayout,
  getAdjacentCellIds,
  findKnownMapTravelPath,
  getHexDistance,
  moveToCell,
} from './expeditionMapLayout';
import { ROOM_TYPES } from './roomGeneration';

export const DEFAULT_SUBLOCATIONS = [
  'forgotten-crypt',
  'flooded-grotto',
  'ashen-shrine',
  'lost-mine',
];

export const EXPEDITION_MAP_RUNTIME_STORAGE_KEY = 'ashen-abyss:expedition-map-v1';

const getRuntimeStorage = () => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

export const getExpeditionMapRuntimeEnabled = (storage = getRuntimeStorage()) => {
  try {
    // Enabled by default; a developer can opt back into the legacy path mode.
    return storage?.getItem(EXPEDITION_MAP_RUNTIME_STORAGE_KEY) !== 'false';
  } catch {
    return false;
  }
};

export const setExpeditionMapRuntimeEnabled = (
  enabled,
  storage = getRuntimeStorage()
) => {
  const next = Boolean(enabled);
  try {
    if (storage) {
      storage.setItem(EXPEDITION_MAP_RUNTIME_STORAGE_KEY, next ? 'true' : 'false');
    }
  } catch {
    // Storage may be unavailable in restricted webviews.
  }
  return next;
};

// The old build-time preview flag is retired: stale Vercel settings must not
// send production players back to the three-route mode. The local DEV switch
// remains available for explicitly testing the legacy route selector.
export const isExpeditionMapFeatureEnabled = () => getExpeditionMapRuntimeEnabled();

const EXPEDITION_ROOM_WEIGHTS = Object.freeze([
  [ROOM_TYPES.COMBAT, 46],
  [ROOM_TYPES.RESOURCE, 15],
  [ROOM_TYPES.SECRET, 12],
  [ROOM_TYPES.TREASURE, 10],
  [ROOM_TYPES.FISHING, 3],
]);

export const NARROW_PATH_COMBAT_WEIGHT_MULTIPLIER = 0.45;

export const getExpeditionBattleWeightScale = cell =>
  Number(cell?.contentProfileDegree ?? cell?.pathDegree) > 0 && Number(cell?.contentProfileDegree ?? cell?.pathDegree) <= 2
    ? NARROW_PATH_COMBAT_WEIGHT_MULTIPLIER
    : 1;

const scaleBattleWeights = (weights, scale) => weights.map(([type, weight]) => [
  type,
  type === ROOM_TYPES.COMBAT || type === ROOM_TYPES.CURSED_ENEMY
    ? weight * scale
    : weight,
]);

const getSublocationRoomWeights = (cell, locationId) => {
  const definition = getSublocationDefinition(locationId, cell?.sublocationId);
  const cursedChance = Math.max(0, Math.min(0.8, Number(definition?.cursedChance) || 0.2));
  const battleWeight = 54;
  return [
    [ROOM_TYPES.COMBAT, battleWeight * (1 - cursedChance)],
    [ROOM_TYPES.CURSED_ENEMY, battleWeight * cursedChance],
    [ROOM_TYPES.RESOURCE, 14],
    [ROOM_TYPES.SECRET, 10],
    [ROOM_TYPES.TREASURE, 10],
    [ROOM_TYPES.FISHING, 2],
  ];
};

const rollWeightedType = (weights, rng = Math.random) => {
  let roll = rng() * weights.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [type, weight] of weights) {
    roll -= weight;
    if (roll <= 0) return type;
  }
  return weights[weights.length - 1]?.[0] || ROOM_TYPES.COMBAT;
};

const rollExpeditionRoomType = (cell, rng = Math.random, locationId = null) => {
  if (cell?.forcedRoomType) return cell.forcedRoomType;
  if (Array.isArray(cell?.forcedRoomTypePool) && cell.forcedRoomTypePool.length) {
    const roll = Math.max(0, Math.min(0.999999999, Number(rng()) || 0));
    return cell.forcedRoomTypePool[
      Math.floor(roll * cell.forcedRoomTypePool.length)
    ];
  }
  if (cell?.phase === 'boss') return ROOM_TYPES.BOSS;

  const battleScale = getExpeditionBattleWeightScale(cell);
  if (cell?.phase === 'depth') {
    if (cell?.landmark?.type === 'depth-completion' || battleScale === 1) {
      return rng() < 0.35 ? ROOM_TYPES.CURSED_ENEMY : ROOM_TYPES.COMBAT;
    }
    return rollWeightedType(scaleBattleWeights([
      [ROOM_TYPES.COMBAT, 65],
      [ROOM_TYPES.CURSED_ENEMY, 35],
      [ROOM_TYPES.RESOURCE, 18],
      [ROOM_TYPES.SECRET, 12],
      [ROOM_TYPES.TREASURE, 10],
    ], battleScale), rng);
  }
  if (cell?.region === 'sublocation') {
    return rollWeightedType(
      scaleBattleWeights(getSublocationRoomWeights(cell, locationId), battleScale),
      rng
    );
  }
  return rollWeightedType(
    scaleBattleWeights(EXPEDITION_ROOM_WEIGHTS, battleScale),
    rng
  );
};

const seedExpeditionContentTypes = (layout, { rng = Math.random, locationId = null } = {}) => {
  let cells = layout.cells.map(cell =>
    cell.significant && !cell.previewRoomType && !cell.resolved
      ? { ...cell, previewRoomType: rollExpeditionRoomType(cell, rng, locationId || layout.locationId) }
      : cell
  );
  // New authored boards must not strand the player when all random rooms roll
  // non-combat. Two fights also allow key pity to finish before the last fight.
  // Existing Goblin layouts retain their original content-generation behaviour.
  if (layout.minimumKeyBattles) {
    const groups = ['approach', 'depth', ...Object.keys(layout.sublocationEntranceCellIds)];
    for (const group of groups) {
      const inGroup = cell => cell.region === group || (cell.region === 'sublocation' && cell.sublocationId === group);
      let missing = layout.minimumKeyBattles - cells.filter(cell => inGroup(cell) && ['COMBAT', 'CURSED_ENEMY'].includes(cell.previewRoomType)).length;
      cells = cells.map(cell => {
        if (missing > 0 && inGroup(cell) && cell.significant && !cell.forcedRoomType && !['COMBAT', 'CURSED_ENEMY'].includes(cell.previewRoomType)) {
          missing -= 1;
          return { ...cell, previewRoomType: ROOM_TYPES.COMBAT };
        }
        return cell;
      });
      if (missing > 0) throw new Error(`Insufficient key-bearing fights in ${layout.templateId}: ${group}`);
    }
  }
  return placeGuardedGoblinContent({ ...layout, cells });
};

const revealAround = (layout, { rng = Math.random } = {}) => {
  const adjacent = new Set(getAdjacentCellIds(layout, layout.currentCellId));
  const current = layout.cells.find(c => c.id === layout.currentCellId);
  return {
    ...layout,
    cells: layout.cells.map(cell => {
      const revealed = cell.revealed
        || cell.id === layout.currentCellId
        || (adjacent.has(cell.id) && !cell.locked)
        || (cell.walkable === false && current && getHexDistance(current, cell) <= 1);
      const visited = cell.visited || cell.id === layout.currentCellId;
      const needsPreview = revealed
        && cell.significant
        && !cell.previewRoomType
        && !cell.resolved;
      return {
        ...cell,
        visited,
        revealed,
        ...(needsPreview
          ? { previewRoomType: rollExpeditionRoomType(cell, rng, layout.locationId) }
          : {}),
      };
    }),
  };
};

const isHexV2Run = run =>
  Number(run?.state?.version) >= 2
  && run?.mainLayout?.topology === 'hex-board-v2';

export const createExpeditionMapRun = ({
  locationId,
  templateId,
  abyssLevel = 1,
  sublocations = null,
  curses = {},
  rng = Math.random,
} = {}) => {
  const resolvedSublocations = Array.isArray(sublocations)
    ? sublocations
    : getSublocationIdsForLocation(locationId);
  const state = createExpeditionMapState({
    locationId,
    abyssLevel,
    sublocations: resolvedSublocations,
    curses,
    rng,
  });
  const seededLayout = seedExpeditionContentTypes(
    generateMainExpeditionLayout(state, { rng, templateId }),
    { rng, locationId }
  );
  const mainLayout = revealAround(
    applyMapProgressLocks(seededLayout, state),
    { rng }
  );
  return {
    state,
    mainLayout,
    sublocationLayouts: {},
    activeSpace: 'main',
    pendingCellId: null,
    keyNotice: null,
  };
};

export const getActiveExpeditionLayout = run => {
  if (!run) return null;
  if (isHexV2Run(run)) return run.mainLayout;
  if (run.activeSpace === 'main') return run.mainLayout;
  return run?.sublocationLayouts?.[run?.state?.selectedSublocationId] || run.mainLayout;
};

const lockCommittedSublocations = (layout, state) =>
  applyMapProgressLocks(layout, state);

const COMBAT_ROOM_TYPES = new Set([ROOM_TYPES.COMBAT, ROOM_TYPES.CURSED_ENEMY]);

const keyZoneForCell = (cell, state) => {
  if (cell?.region === 'approach') return { zone: 'approach', keyType: 'sublocation' };
  if (cell?.region === 'sublocation' && cell.sublocationId === state?.selectedSublocationId) {
    return { zone: 'sublocation', keyType: 'depth' };
  }
  if (cell?.region === 'depth') return { zone: 'depth', keyType: 'boss' };
  return null;
};

const countZoneCombatCells = (layout, cell, state) => layout.cells.filter(entry => {
  if (!COMBAT_ROOM_TYPES.has(entry.previewRoomType)) return false;
  if (cell?.region === 'sublocation') {
    return entry.region === 'sublocation'
      && entry.sublocationId === state?.selectedSublocationId;
  }
  return entry.region === cell?.region;
}).length;

export const getExpeditionKeyDropChance = (battleNumber, totalBattles) => {
  const total = Math.max(0, Number(totalBattles) || 0);
  const battle = Math.max(0, Number(battleNumber) || 0);
  if (total <= 0 || battle <= 0) return 0;
  const firstEligible = Math.max(1, Math.ceil(total * 0.5));
  const guarantee = total <= 1
    ? 1
    : Math.max(firstEligible, Math.min(total - 1, Math.ceil(total * 0.8)));
  if (battle < firstEligible) return 0;
  if (battle >= guarantee) return 1;
  const span = Math.max(1, guarantee - firstEligible);
  const progress = (battle - firstEligible) / span;
  return 0.15 + progress * 0.7;
};

export const EXPEDITION_KEY_REWARD_NAMES = Object.freeze({
  sublocation: 'Ключ подлокации',
  depth: 'Ключ Глубины',
  boss: 'Ключ босса',
});

export const previewPendingExpeditionKeyRoll = (
  run,
  { rng = Math.random } = {}
) => {
  if (!run?.pendingCellId || !isHexV2Run(run)) return null;
  const cell = run.mainLayout.cells.find(entry => entry.id === run.pendingCellId);
  if (!COMBAT_ROOM_TYPES.has(cell?.previewRoomType)) return null;

  const descriptor = keyZoneForCell(cell, run.state);
  if (
    !descriptor
    || run.state?.keys?.[descriptor.keyType]?.consumed
    || hasExpeditionKey(run.state, descriptor.keyType)
  ) {
    return null;
  }

  const current = Math.max(0, Number(run.state?.keyProgress?.[descriptor.zone]) || 0);
  const battleNumber = current + 1;
  const totalBattles = countZoneCombatCells(run.mainLayout, cell, run.state);
  const chance = getExpeditionKeyDropChance(battleNumber, totalBattles);
  const dropped = chance >= 1 || rng() < chance;

  return {
    keyType: descriptor.keyType,
    zone: descriptor.zone,
    sourceCellId: cell.id,
    battleNumber,
    totalBattles,
    chance,
    dropped,
  };
};

export const applyPendingExpeditionKeyRoll = (run, roll) => {
  if (!run || !roll?.zone || !roll?.keyType || !roll?.sourceCellId) return run;
  if (run.pendingCellId !== roll.sourceCellId) return run;

  let state = {
    ...run.state,
    keyProgress: {
      ...run.state.keyProgress,
      [roll.zone]: Math.max(
        Number(run.state?.keyProgress?.[roll.zone]) || 0,
        Number(roll.battleNumber) || 0
      ),
    },
  };

  let keyNotice = run.keyNotice || null;
  if (
    roll.dropped
    && !state?.keys?.[roll.keyType]?.consumed
    && !hasExpeditionKey(state, roll.keyType)
  ) {
    state = grantExpeditionKey(state, roll.keyType, {
      sourceCellId: roll.sourceCellId,
      acquiredAtBattle: roll.battleNumber,
    }).state;
    keyNotice = {
      keyType: roll.keyType,
      sourceCellId: roll.sourceCellId,
      acquiredAtBattle: roll.battleNumber,
    };
  }

  return { ...run, state, keyNotice };
};


const getZoneCombatProgress = (run, zone, sublocationId = null) => {
  const combatCells = run.mainLayout.cells.filter(cell => {
    if (!COMBAT_ROOM_TYPES.has(cell.previewRoomType)) return false;
    if (zone === 'sublocation') {
      return cell.region === 'sublocation' && cell.sublocationId === sublocationId;
    }
    return cell.region === zone;
  });
  return {
    totalBattles: combatCells.length,
    completedBattles: combatCells.filter(cell => cell.resolved).length,
  };
};

const getGuaranteeBattle = totalBattles => {
  const total = Math.max(0, Number(totalBattles) || 0);
  for (let battle = 1; battle <= total; battle += 1) {
    if (getExpeditionKeyDropChance(battle, total) >= 1) return battle;
  }
  return total;
};

export const reconcileExpeditionKeyGuarantees = run => {
  if (!run || !isHexV2Run(run)) return run;
  const descriptors = [
    { zone: 'approach', keyType: 'sublocation', sublocationId: null },
    ...(run.state?.selectedSublocationId
      ? [{ zone: 'sublocation', keyType: 'depth', sublocationId: run.state.selectedSublocationId }]
      : []),
    ...(run.state?.progress?.depthUnlocked
      ? [{ zone: 'depth', keyType: 'boss', sublocationId: null }]
      : []),
  ];

  let next = run;
  let changed = false;

  descriptors.forEach(descriptor => {
    const progress = getZoneCombatProgress(next, descriptor.zone, descriptor.sublocationId);
    if (progress.totalBattles <= 0) return;

    const recorded = Math.max(0, Number(next.state?.keyProgress?.[descriptor.zone]) || 0);
    if (progress.completedBattles > recorded) {
      next = {
        ...next,
        state: {
          ...next.state,
          keyProgress: {
            ...next.state.keyProgress,
            [descriptor.zone]: progress.completedBattles,
          },
        },
      };
      changed = true;
    }

    if (
      next.state?.keys?.[descriptor.keyType]?.consumed
      || hasExpeditionKey(next.state, descriptor.keyType)
    ) {
      return;
    }

    const guaranteeBattle = getGuaranteeBattle(progress.totalBattles);
    if (progress.completedBattles < guaranteeBattle) return;

    const sourceCell = next.mainLayout.cells
      .filter(cell => {
        if (!COMBAT_ROOM_TYPES.has(cell.previewRoomType) || !cell.resolved) return false;
        if (descriptor.zone === 'sublocation') {
          return cell.region === 'sublocation'
            && cell.sublocationId === descriptor.sublocationId;
        }
        return cell.region === descriptor.zone;
      })
      .slice(-1)[0] || null;

    const granted = grantExpeditionKey(next.state, descriptor.keyType, {
      sourceCellId: sourceCell?.id || null,
      acquiredAtBattle: progress.completedBattles,
    });
    if (!granted.granted) return;

    next = {
      ...next,
      state: granted.state,
      keyNotice: {
        keyType: descriptor.keyType,
        sourceCellId: sourceCell?.id || null,
        acquiredAtBattle: progress.completedBattles,
      },
    };
    changed = true;
  });

  return changed ? next : run;
};

export const moveExpeditionRun = (run, cellId, { rng = Math.random } = {}) => {
  if (!run || run.pendingCellId) {
    return { run, moved: false, reason: 'content-pending' };
  }
  if (!isHexV2Run(run)) {
    return { run, moved: false, reason: 'legacy-map-restart-required' };
  }

  const targetBeforeMove = run.mainLayout.cells.find(entry => entry.id === cellId);
  if (
    targetBeforeMove?.landmark?.type === 'sublocation-entrance'
    && !run.state?.selectedSublocationId
    && !hasExpeditionKey(run.state, 'sublocation')
  ) {
    return { run, moved: false, reason: 'sublocation-key-required' };
  }

  const selectedDepthEntryId = run.mainLayout.depthEntryCellIds?.[run.state?.selectedSublocationId];
  const enteringDepth = cellId === selectedDepthEntryId && !run.state?.progress?.depthUnlocked;
  if (enteringDepth && !hasExpeditionKey(run.state, 'depth')) {
    return { run, moved: false, reason: 'depth-key-required' };
  }

  const enteringBoss = cellId === run.mainLayout.bossCellId && !run.state?.progress?.bossUnlocked;
  if (enteringBoss && !hasExpeditionKey(run.state, 'boss')) {
    return { run, moved: false, reason: 'boss-key-required' };
  }

  // Re-derive locks from authoritative run state before every move.
  const movementLayout = lockCommittedSublocations(run.mainLayout, run.state);
  const route = findKnownMapTravelPath(movementLayout, cellId);
  if (!route?.length) return { run, moved: false, reason: 'unreachable-or-unexplored' };

  // Transit across known resolved ground is atomic: never pass through an
  // unresolved combat, key gate, chest or altar. Persist every walked tile,
  // but enter the destination via the same single-step combat/event logic.
  let traveled = movementLayout;
  for (const intermediateId of route.slice(0, -1)) {
    const step = moveToCell(traveled, intermediateId);
    if (!step.moved) return { run, moved: false, reason: step.reason };
    traveled = step.layout;
  }
  const originCellId = traveled.currentCellId;
  const movement = moveToCell(traveled, cellId);
  if (!movement.moved) {
    return { run, moved: false, reason: movement.reason };
  }
  let next = {
    ...run,
    mainLayout: revealAround(movement.layout, { rng }),
  };
  let cell = next.mainLayout.cells.find(entry => entry.id === cellId);

  if (cell?.landmark?.type === 'sublocation-entrance') {
    const selection = selectSublocation(next.state, cell.landmark.sublocationId);
    if (!selection.accepted) {
      return { run, moved: false, reason: selection.reason };
    }
    next = {
      ...next,
      state: selection.state,
      mainLayout: lockCommittedSublocations(next.mainLayout, selection.state),
    };
    cell = next.mainLayout.cells.find(entry => entry.id === cellId);
  }

  if (enteringDepth) {
    const unlocked = unlockDepthWithKey(next.state, next.state.selectedSublocationId);
    if (!unlocked.accepted) return { run, moved: false, reason: unlocked.reason };
    next = {
      ...next,
      state: unlocked.state,
      mainLayout: revealAround(
        applyMapProgressLocks(next.mainLayout, unlocked.state),
        { rng }
      ),
    };
    cell = next.mainLayout.cells.find(entry => entry.id === cellId);
  }

  if (enteringBoss) {
    const unlocked = unlockBossWithKey(next.state);
    if (!unlocked.accepted) return { run, moved: false, reason: unlocked.reason };
    next = {
      ...next,
      state: unlocked.state,
      mainLayout: revealAround(
        applyMapProgressLocks(next.mainLayout, unlocked.state),
        { rng }
      ),
    };
    cell = next.mainLayout.cells.find(entry => entry.id === cellId);
  }

  if ((cell?.significant && !cell.resolved) || cell?.landmark?.type === 'boss') {
    next = {
      ...next,
      pendingCellId: cell.id,
      pendingOriginCellId: originCellId,
    };
  }

  return { run: next, moved: true, reason: null };
};

export const resolveCurrentExpeditionCell = (run, { rng = Math.random } = {}) => {
  if (!run?.pendingCellId) return run;
  const layout = getActiveExpeditionLayout(run);
  const resolvedCell = layout?.cells?.find(cell => cell.id === run.pendingCellId);
  if (!layout || !resolvedCell) return { ...run, pendingCellId: null };

  let next = {
    ...run,
    mainLayout: {
      ...run.mainLayout,
      cells: run.mainLayout.cells.map(cell =>
        cell.id === run.pendingCellId
          ? { ...cell, resolved: true, content: null }
          : cell
      ),
    },
    pendingCellId: null,
    pendingOriginCellId: null,
  };

  next = {
    ...next,
    mainLayout: revealAround(
      applyMapProgressLocks(next.mainLayout, next.state),
      { rng }
    ),
  };

  return reconcileExpeditionKeyGuarantees(next);
};


export const cancelPendingExpeditionCell = (run, { rng = Math.random } = {}) => {
  if (!run?.pendingCellId || !isHexV2Run(run)) return run;

  const explicitOrigin = run.pendingOriginCellId;
  const fallbackOrigin = getAdjacentCellIds(run.mainLayout, run.pendingCellId)
    .map(id => run.mainLayout.cells.find(cell => cell.id === id))
    .find(cell => cell?.visited && cell?.resolved && !cell?.locked)?.id
    || null;
  const originCellId = explicitOrigin || fallbackOrigin;
  if (!originCellId) return run;

  const originExists = run.mainLayout.cells.some(cell => cell.id === originCellId);
  if (!originExists) return run;

  const restoredLayout = {
    ...run.mainLayout,
    currentCellId: originCellId,
  };
  return {
    ...run,
    pendingCellId: null,
    pendingOriginCellId: null,
    mainLayout: revealAround(
      applyMapProgressLocks(restoredLayout, run.state),
      { rng }
    ),
  };
};

export const dismissExpeditionKeyNotice = run =>
  run?.keyNotice ? { ...run, keyNotice: null } : run;

export const setPendingExpeditionCellContent = (run, content) => {
  if (!run?.pendingCellId || !content) return run;
  if (!isHexV2Run(run)) {
    const layout = getActiveExpeditionLayout(run);
    if (!layout) return run;
    if (run.activeSpace === 'main') {
      return {
        ...run,
        mainLayout: {
          ...layout,
          cells: layout.cells.map(cell =>
            cell.id === run.pendingCellId ? { ...cell, content } : cell
          ),
        },
      };
    }
    return {
      ...run,
      sublocationLayouts: {
        ...run.sublocationLayouts,
        [run.state.selectedSublocationId]: {
          ...layout,
          cells: layout.cells.map(cell =>
            cell.id === run.pendingCellId ? { ...cell, content } : cell
          ),
        },
      },
    };
  }

  return {
    ...run,
    mainLayout: {
      ...run.mainLayout,
      cells: run.mainLayout.cells.map(cell =>
        cell.id === run.pendingCellId ? { ...cell, content } : cell
      ),
    },
  };
};

