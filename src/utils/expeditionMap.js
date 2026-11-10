import { getRemainingCurseProgress } from '../data/curses';

export const EXPEDITION_MAP_VERSION = 2;
export const EXPEDITION_MAP_PHASES = Object.freeze({
  APPROACH: 'approach',
  SUBLOCATION: 'sublocation',
  DEPTH: 'depth',
  BOSS: 'boss',
});

export const ALTAR_COUNT_BY_ABYSS_LEVEL = Object.freeze({
  1: Object.freeze({ min: 1, max: 1 }),
  2: Object.freeze({ min: 2, max: 2 }),
  3: Object.freeze({ min: 2, max: 3 }),
  4: Object.freeze({ min: 2, max: 3 }),
  5: Object.freeze({ min: 3, max: 4 }),
});

export const splitAltarBudgetAcrossRoute = total => {
  const normalized = Math.max(0, Math.floor(Number(total) || 0));
  const base = Math.floor(normalized / 3);
  const remainder = normalized % 3;
  return {
    total: normalized,
    approach: base + (remainder >= 1 ? 1 : 0),
    sublocation: base + (remainder >= 2 ? 1 : 0),
    depth: base,
  };
};

export const resolveAltarBudget = ({
  abyssLevel = 1,
  curses = {},
  rng = Math.random,
} = {}) => {
  const level = Math.max(1, Number(abyssLevel) || 1);
  const remaining = getRemainingCurseProgress(curses);
  if (remaining <= 0) return splitAltarBudgetAcrossRoute(0);
  if (level >= 6) return splitAltarBudgetAcrossRoute(remaining);
  const range = ALTAR_COUNT_BY_ABYSS_LEVEL[level] || ALTAR_COUNT_BY_ABYSS_LEVEL[5];
  const rolled = randomIntInclusive(range.min, range.max, rng);
  return splitAltarBudgetAcrossRoute(Math.min(rolled, remaining));
};

export const EXPEDITION_MAP_DEFAULTS = Object.freeze({
  approachCells: Object.freeze({ min: 15, max: 15 }),
  sublocationCells: Object.freeze({ min: 14, max: 14 }),
  depthCells: Object.freeze({ min: 14, max: 14 }),
  bossCells: 1,
  availableSublocations: 3,
  possibleSublocations: 4,
  sublocationAccessesPerRun: 1,
  abyssPressureStartsAtLevel: 6,
});

const asPositiveInteger = (value, fallback) =>
  Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback;

const randomIntInclusive = (min, max, rng = Math.random) =>
  Math.ceil(Math.min(min, max))
  + Math.floor(rng() * (Math.floor(Math.max(min, max)) - Math.ceil(Math.min(min, max)) + 1));

const uniqueIds = entries => [
  ...new Set((entries || []).map(entry => typeof entry === 'string' ? entry : entry?.id).filter(Boolean)),
];

export const pickRunSublocations = (
  sublocations,
  rng = Math.random,
  count = EXPEDITION_MAP_DEFAULTS.availableSublocations
) => {
  const ids = uniqueIds(sublocations);
  if (ids.length !== EXPEDITION_MAP_DEFAULTS.possibleSublocations) {
    throw new Error('Expedition map v2 expects exactly '
      + EXPEDITION_MAP_DEFAULTS.possibleSublocations + ' possible sublocations');
  }
  const targetCount = Math.min(asPositiveInteger(count, 3), ids.length);
  const pool = [...ids];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
  }
  return pool.slice(0, targetCount);
};

const resolvePhaseTargets = (rng, ranges = {}) => ({
  approach: randomIntInclusive(
    ranges.approachCells?.min ?? EXPEDITION_MAP_DEFAULTS.approachCells.min,
    ranges.approachCells?.max ?? EXPEDITION_MAP_DEFAULTS.approachCells.max,
    rng
  ),
  sublocation: randomIntInclusive(
    ranges.sublocationCells?.min ?? EXPEDITION_MAP_DEFAULTS.sublocationCells.min,
    ranges.sublocationCells?.max ?? EXPEDITION_MAP_DEFAULTS.sublocationCells.max,
    rng
  ),
  depth: randomIntInclusive(
    ranges.depthCells?.min ?? EXPEDITION_MAP_DEFAULTS.depthCells.min,
    ranges.depthCells?.max ?? EXPEDITION_MAP_DEFAULTS.depthCells.max,
    rng
  ),
  boss: EXPEDITION_MAP_DEFAULTS.bossCells,
});

export const createExpeditionMapState = ({
  locationId,
  abyssLevel = 1,
  sublocations,
  curses = {},
  rng = Math.random,
  ranges,
} = {}) => {
  if (!locationId) throw new Error('Expedition map requires locationId');
  const normalizedAbyssLevel = asPositiveInteger(abyssLevel, 1);
  const availableSublocationIds = pickRunSublocations(sublocations, rng);
  const altarBudget = resolveAltarBudget({
    abyssLevel: normalizedAbyssLevel,
    curses,
    rng,
  });
  return {
    version: EXPEDITION_MAP_VERSION,
    locationId,
    abyssLevel: normalizedAbyssLevel,
    phaseTargets: resolvePhaseTargets(rng, ranges),
    availableSublocationIds,
    altarBudget,
    selectedSublocationId: null,
    completedSublocationId: null,
    keys: {
      sublocation: { owned: false, consumed: false, sourceCellId: null, acquiredAtBattle: null },
      depth: { owned: false, consumed: false, sourceCellId: null, acquiredAtBattle: null },
      boss: { owned: false, consumed: false, sourceCellId: null, acquiredAtBattle: null },
    },
    keyProgress: {
      approach: 0,
      sublocation: 0,
      depth: 0,
    },
    // Compatibility mirror for older UI/state readers. New runs use keys.sublocation.
    sublocationAccess: {
      total: 1,
      remaining: 0,
      granted: false,
      sourceCellId: null,
      persistsAfterLocationExit: false,
    },
    progress: {
      currentPhase: EXPEDITION_MAP_PHASES.APPROACH,
      depthUnlocked: false,
      depthCompleted: false,
      bossUnlocked: false,
    },
    movementRules: {
      backtrackingAllowed: true,
      movementBudget: null,
      abyssPressureEnabled: normalizedAbyssLevel >= EXPEDITION_MAP_DEFAULTS.abyssPressureStartsAtLevel,
    },
    encounterRules: {
      approach: {
        ordinaryAllowed: true,
        strongAllowed: true,
        cursedAllowed: true,
        cursedSolo: true,
        abyssPowerEnabled: false,
      },
      sublocation: {
        ordinaryAllowed: false,
        strongAllowed: true,
        cursedAllowed: true,
        cursedSolo: true,
        abyssPowerEnabled: false,
      },
      depth: {
        ordinaryAllowed: false,
        strongAllowed: true,
        cursedAllowed: true,
        cursedSolo: true,
        abyssPowerEnabled: true,
        abyssPowerTuning: null,
      },
      boss: {
        ordinaryAllowed: false,
        strongAllowed: false,
        cursedAllowed: false,
        cursedSolo: false,
        abyssPowerEnabled: false,
      },
    },
  };
};

export const hasExpeditionKey = (state, keyType) =>
  Boolean(state?.keys?.[keyType]?.owned && !state?.keys?.[keyType]?.consumed);

export const grantExpeditionKey = (
  state,
  keyType,
  { sourceCellId = null, acquiredAtBattle = null } = {}
) => {
  if (!state?.keys?.[keyType] || hasExpeditionKey(state, keyType) || state.keys[keyType].consumed) {
    return { state, granted: false };
  }
  const nextKey = {
    ...state.keys[keyType],
    owned: true,
    consumed: false,
    sourceCellId,
    acquiredAtBattle,
  };
  return {
    granted: true,
    state: {
      ...state,
      keys: { ...state.keys, [keyType]: nextKey },
      ...(keyType === 'sublocation'
        ? {
            sublocationAccess: {
              ...state.sublocationAccess,
              remaining: 1,
              granted: true,
              sourceCellId,
            },
          }
        : {}),
    },
  };
};

export const consumeExpeditionKey = (state, keyType) => {
  if (!hasExpeditionKey(state, keyType)) return { state, consumed: false };
  return {
    consumed: true,
    state: {
      ...state,
      keys: {
        ...state.keys,
        [keyType]: {
          ...state.keys[keyType],
          owned: false,
          consumed: true,
        },
      },
      ...(keyType === 'sublocation'
        ? {
            sublocationAccess: {
              ...state.sublocationAccess,
              remaining: 0,
            },
          }
        : {}),
    },
  };
};

export const canEnterSublocation = (state, id) => Boolean(
  state
  && id
  && state.availableSublocationIds?.includes(id)
  && (state.selectedSublocationId
    ? state.selectedSublocationId === id
    : hasExpeditionKey(state, 'sublocation'))
);

export const grantSublocationAccess = (state, sourceCellId) =>
  grantExpeditionKey(state, 'sublocation', { sourceCellId });

export const selectSublocation = (state, id) => {
  if (!canEnterSublocation(state, id)) {
    return { state, accepted: false, reason: 'sublocation-key-required' };
  }
  if (state.selectedSublocationId === id) {
    return { state, accepted: true, reason: 'already-selected' };
  }
  const consumed = consumeExpeditionKey(state, 'sublocation');
  if (!consumed.consumed) {
    return { state, accepted: false, reason: 'sublocation-key-required' };
  }
  return {
    accepted: true,
    reason: null,
    state: {
      ...consumed.state,
      selectedSublocationId: id,
      progress: {
        ...consumed.state.progress,
        currentPhase: EXPEDITION_MAP_PHASES.SUBLOCATION,
      },
    },
  };
};

export const completeSublocation = (state, id = state?.selectedSublocationId) => {
  if (!state?.selectedSublocationId || id !== state.selectedSublocationId) {
    return { state, accepted: false, reason: 'sublocation-not-selected' };
  }
  if (state.completedSublocationId) {
    return { state, accepted: false, reason: 'sublocation-already-completed' };
  }
  return {
    accepted: true,
    reason: null,
    state: {
      ...state,
      completedSublocationId: id,
      progress: {
        ...state.progress,
        currentPhase: EXPEDITION_MAP_PHASES.DEPTH,
        depthUnlocked: true,
      },
    },
  };
};

export const completeDepth = state =>
  !state?.progress?.depthUnlocked
    ? { state, accepted: false, reason: 'depth-locked' }
    : {
        accepted: true,
        reason: null,
        state: {
          ...state,
          progress: { ...state.progress, depthCompleted: true },
        },
      };

export const unlockBoss = state =>
  !state?.progress?.depthCompleted
    ? { state, accepted: false, reason: 'depth-incomplete' }
    : {
        accepted: true,
        reason: null,
        state: {
          ...state,
          progress: {
            ...state.progress,
            currentPhase: EXPEDITION_MAP_PHASES.BOSS,
            bossUnlocked: true,
          },
        },
      };

export const unlockDepthWithKey = (state, id = state?.selectedSublocationId) => {
  if (!hasExpeditionKey(state, 'depth')) {
    return { state, accepted: false, reason: 'depth-key-required' };
  }
  const consumed = consumeExpeditionKey(state, 'depth');
  const completed = completeSublocation(consumed.state, id);
  return completed.accepted
    ? { ...completed, keyConsumed: true }
    : { state, accepted: false, reason: completed.reason };
};

export const unlockBossWithKey = state => {
  if (!state?.progress?.depthUnlocked) {
    return { state, accepted: false, reason: 'depth-locked' };
  }
  if (!hasExpeditionKey(state, 'boss')) {
    return { state, accepted: false, reason: 'boss-key-required' };
  }
  const consumed = consumeExpeditionKey(state, 'boss');
  const depthDone = completeDepth(consumed.state);
  if (!depthDone.accepted) return depthDone;
  const boss = unlockBoss(depthDone.state);
  return boss.accepted ? { ...boss, keyConsumed: true } : boss;
};

export const isAbyssPressureEnabledForMap = state =>
  Boolean(state?.movementRules?.abyssPressureEnabled);
