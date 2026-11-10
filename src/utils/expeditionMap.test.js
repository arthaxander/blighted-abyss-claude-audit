import {
  EXPEDITION_MAP_DEFAULTS,
  canEnterSublocation,
  completeDepth,
  completeSublocation,
  grantExpeditionKey,
  createExpeditionMapState,
  isAbyssPressureEnabledForMap,
  pickRunSublocations,
  selectSublocation,
  unlockBoss,
  unlockBossWithKey,
  unlockDepthWithKey,
  resolveAltarBudget,
} from './expeditionMap';

const SUBLOCATIONS = ['a', 'b', 'c', 'd'];
const createState = (abyssLevel = 1) => createExpeditionMapState({
  locationId: 'test',
  abyssLevel,
  sublocations: SUBLOCATIONS,
  rng: () => 0.5,
});

describe('expedition map v2 rules', () => {
  test('offers exactly three of four possible sublocations', () => {
    expect(new Set(pickRunSublocations(SUBLOCATIONS, () => 0.42)).size).toBe(3);
  });

  test('uses the agreed 15 + 14 + 14 + 1 meaningful counts', () => {
    const state = createState();
    expect(state.phaseTargets).toEqual({
      approach: 15,
      sublocation: 14,
      depth: 14,
      boss: 1,
    });
  });

  test('altar budgets follow the agreed floor progression and level six catches up', () => {
    expect(resolveAltarBudget({ abyssLevel: 1, rng: () => 0 })).toMatchObject({ total: 1 });
    expect(resolveAltarBudget({ abyssLevel: 2, rng: () => 0 })).toMatchObject({ total: 2 });
    expect(resolveAltarBudget({ abyssLevel: 3, rng: () => 0 })).toMatchObject({ total: 2 });
    expect(resolveAltarBudget({ abyssLevel: 3, rng: () => 0.999 })).toMatchObject({ total: 3 });
    expect(resolveAltarBudget({ abyssLevel: 4, rng: () => 0.999 })).toMatchObject({ total: 3 });
    expect(resolveAltarBudget({ abyssLevel: 5, rng: () => 0 })).toMatchObject({ total: 3 });
    expect(resolveAltarBudget({ abyssLevel: 5, rng: () => 0.999 })).toMatchObject({ total: 4 });
    expect(resolveAltarBudget({
      abyssLevel: 6,
      curses: {
        corruption: { tier: 5 },
        distortion: { tier: 2 },
        withering: { tier: 2 },
        undeath: { tier: 1 },
        decay: { tier: 1 },
      },
    })).toMatchObject({ total: 2 });
  });

  test('a run-local key opens exactly one of the three sublocations', () => {
    let state = createState();
    const [first, second, third] = state.availableSublocationIds;
    expect(canEnterSublocation(state, first)).toBe(false);
    state = grantExpeditionKey(state, 'sublocation', { sourceCellId: 'fight-4' }).state;
    expect(canEnterSublocation(state, first)).toBe(true);
    expect(canEnterSublocation(state, second)).toBe(true);
    expect(canEnterSublocation(state, third)).toBe(true);

    const entered = selectSublocation(state, first);
    expect(entered.accepted).toBe(true);
    expect(entered.state.keys.sublocation).toMatchObject({ owned: false, consumed: true });
    expect(canEnterSublocation(entered.state, first)).toBe(true);
    expect(canEnterSublocation(entered.state, second)).toBe(false);
    expect(canEnterSublocation(entered.state, third)).toBe(false);
  });

  test('does not enable Abyss Pressure before level six', () => {
    for (let level = 1; level <= 5; level += 1) {
      const state = createState(level);
      expect(isAbyssPressureEnabledForMap(state)).toBe(false);
      expect(state.movementRules.movementBudget).toBeNull();
    }
    expect(isAbyssPressureEnabledForMap(
      createState(EXPEDITION_MAP_DEFAULTS.abyssPressureStartsAtLevel)
    )).toBe(true);
  });

  test('depth and boss gates each consume their own run-local key', () => {
    let state = createState();
    state = grantExpeditionKey(state, 'sublocation').state;
    state = selectSublocation(state, state.availableSublocationIds[0]).state;

    expect(unlockDepthWithKey(state).accepted).toBe(false);
    state = grantExpeditionKey(state, 'depth').state;
    const depth = unlockDepthWithKey(state);
    expect(depth.accepted).toBe(true);
    expect(depth.state.progress.depthUnlocked).toBe(true);
    expect(depth.state.keys.depth).toMatchObject({ owned: false, consumed: true });

    expect(unlockBossWithKey(depth.state).accepted).toBe(false);
    state = grantExpeditionKey(depth.state, 'boss').state;
    const boss = unlockBossWithKey(state);
    expect(boss.accepted).toBe(true);
    expect(boss.state.progress.depthCompleted).toBe(true);
    expect(boss.state.progress.bossUnlocked).toBe(true);
    expect(boss.state.keys.boss).toMatchObject({ owned: false, consumed: true });
  });

  test('depth policy permits Strong or solo Cursed only with untuned Abyss Power', () => {
    expect(createState().encounterRules.depth).toMatchObject({
      ordinaryAllowed: false,
      strongAllowed: true,
      cursedAllowed: true,
      cursedSolo: true,
      abyssPowerEnabled: true,
      abyssPowerTuning: null,
    });
  });
});
