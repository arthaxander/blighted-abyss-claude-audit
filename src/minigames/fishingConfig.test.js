import {
  buildFishingConfig, createFishingState, FISH_PHASE, FISHING_CONFIG, getFishPhaseDuration,
  directionFromAngle, evaluateDirectionalDrag, resolveFishingDifficulty, updateFishingState,
} from './fishingConfig';

const config = buildFishingConfig({}, { ...FISHING_CONFIG, directionalSurgeChance: 0 });

test('CALM pulling gains progress and moderate tension while release recovers with bounded values', () => {
  const initial = createFishingState(config, () => 0.5);
  const pulled = updateFishingState(100, { ...initial, playerPulling: true }, config, () => 0.5);
  expect(pulled.catchProgress).toBeGreaterThan(initial.catchProgress);
  expect(pulled.tension).toBeCloseTo(initial.tension + 0.7);
  const released = updateFishingState(100, { ...pulled, playerPulling: false }, config, () => 0.5);
  expect(released.catchProgress).toBeLessThan(pulled.catchProgress);
  expect(released.tension).toBeLessThan(pulled.tension);
  const floor = updateFishingState(100, { ...initial, catchProgress: 0, tension: 0 }, config);
  expect(floor.catchProgress).toBe(0);
  expect(floor.tension).toBe(0);
});

test('directional drag is normalized, distance/tolerance gated, and independent of absolute coordinates', () => {
  const required = directionFromAngle(0);
  const correct = evaluateDirectionalDrag({ x: 10, y: 20 }, { x: 60, y: 30 }, required, config);
  const translated = evaluateDirectionalDrag({ x: 410, y: 720 }, { x: 460, y: 730 }, required, config);
  expect(correct.followed).toBe(true);
  expect(translated.direction).toEqual(correct.direction);
  expect(evaluateDirectionalDrag({ x: 0, y: 0 }, { x: 30, y: 0 }, required, config).followed).toBe(false);
  expect(evaluateDirectionalDrag({ x: 0, y: 0 }, { x: -60, y: 0 }, required, config).followed).toBe(false);
});

test('some but not every warning selects a deterministic normalized directional surge', () => {
  const directionalConfig = { ...config, directionalSurgeChance: 0.45 };
  const enterWarning = random => updateFishingState(100, {
    ...createFishingState(config), phaseElapsedMs: 0, phaseDurationMs: 100,
  }, directionalConfig, random);
  const directional = enterWarning(() => 0);
  const ordinary = enterWarning(() => 0.9);
  expect(directional.surgeDirectional).toBe(true);
  expect(directional.surgeDirection).toEqual({ x: 1, y: 0 });
  expect(Math.hypot(directional.surgeDirection.x, directional.surgeDirection.y)).toBeCloseTo(1);
  expect(ordinary.surgeDirectional).toBe(false);
  expect(ordinary.surgeDirection).toBeNull();
});

test('a directional gesture grants no progress or tension bonus', () => {
  const base = { ...createFishingState(config), fishPhase: FISH_PHASE.SURGE, surgeDirectional: true,
    surgeDirection: { x: 1, y: 0 }, playerPulling: true };
  const uncontrolled = updateFishingState(100, base, config);
  const controlled = updateFishingState(100, { ...base, directionalFollowed: true }, config);
  expect(controlled.tension).toBe(uncontrolled.tension);
  expect(controlled.catchProgress).toBe(uncontrolled.catchProgress);
});

test('SURGE pulling gains tension substantially faster than CALM', () => {
  const initial = createFishingState(config, () => 0.5);
  const calm = updateFishingState(100, { ...initial, playerPulling: true }, config);
  const surge = updateFishingState(100, { ...initial, fishPhase: FISH_PHASE.SURGE, playerPulling: true }, config);
  expect(surge.tension - initial.tension).toBeGreaterThan((calm.tension - initial.tension) * 3);
});

test('timestamp phase evolution always telegraphs SURGE with randomized configured durations', () => {
  let state = { ...createFishingState(config, () => 0), playerPulling: true };
  const advancePhase = (current, random) => {
    const target = current.phaseDurationMs;
    let elapsed = 0;
    let next = current;
    while (elapsed < target) {
      const step = Math.min(config.maxSimulationDeltaMs, target - elapsed);
      next = updateFishingState(step, next, config, random);
      elapsed += step;
    }
    return next;
  };
  state = advancePhase(state, () => 0);
  expect(state.fishPhase).toBe(FISH_PHASE.SURGE_WARNING);
  expect(state.phaseDurationMs).toBe(getFishPhaseDuration(FISH_PHASE.SURGE_WARNING, config, () => 0));
  state = advancePhase(state, () => 1);
  expect(state.fishPhase).toBe(FISH_PHASE.SURGE);
  expect(getFishPhaseDuration(FISH_PHASE.CALM, config, () => 0)).not.toBe(getFishPhaseDuration(FISH_PHASE.CALM, config, () => 1));
});

test('difficulty predictably shortens calm/warning and strengthens/lengthens surge', () => {
  const easy = resolveFishingDifficulty(1);
  const hard = resolveFishingDifficulty(3);
  expect(hard.calmDurationMultiplier).toBeLessThan(easy.calmDurationMultiplier);
  expect(hard.warningDurationMultiplier).toBeLessThan(easy.warningDurationMultiplier);
  expect(hard.surgeDurationMultiplier).toBeGreaterThan(easy.surgeDurationMultiplier);
  expect(hard.tensionGainMultiplier).toBeGreaterThan(easy.tensionGainMultiplier);
});

test('success, failure, tie priority, and large-frame cap are authoritative', () => {
  expect(updateFishingState(100, { ...createFishingState(config), catchProgress: 99.9, playerPulling: true }, config).result).toBe('success');
  expect(updateFishingState(100, { ...createFishingState(config), tension: 99.9, fishPhase: FISH_PHASE.SURGE, playerPulling: true }, config).result).toBe('failure');
  const tie = updateFishingState(100, { ...createFishingState(config), catchProgress: 99.9, tension: 99.9, fishPhase: FISH_PHASE.SURGE, playerPulling: true }, config);
  expect(tie.result).toBe('failure');
  const resumed = updateFishingState(60_000, { ...createFishingState(config), playerPulling: true }, config);
  expect(resumed.tension).toBeLessThan(FISHING_CONFIG.tensionStart + 4);
});

test('difficulty 1 scripted hold/release success spans several fish cycles', () => {
  let state = createFishingState(config, () => 0.5);
  let elapsedMs = 0;
  let surgeEntries = 0;
  let previousPhase = state.fishPhase;
  while (!state.result && elapsedMs < 30_000) {
    state = updateFishingState(100, { ...state, playerPulling: state.tension < 25 || (state.tension < 80 && state.fishPhase !== FISH_PHASE.SURGE) }, config, () => 0.5);
    if (state.fishPhase === FISH_PHASE.SURGE && previousPhase !== FISH_PHASE.SURGE) surgeEntries += 1;
    previousPhase = state.fishPhase;
    elapsedMs += 100;
  }
  expect(state.result).toBe('success');
  expect(elapsedMs).toBeGreaterThanOrEqual(15_000);
  expect(elapsedMs).toBeLessThanOrEqual(20_000);
  expect(surgeEntries).toBeGreaterThanOrEqual(3);
});



const warning = (overrides = {}) => ({ ...createFishingState(config, () => 0.5),
  fishPhase: FISH_PHASE.SURGE_WARNING, phaseDurationMs: config.directionalReactionMs,
  phaseElapsedMs: config.directionalReactionMs - 100, surgeDirectional: true,
  surgeDirection: { x: 1, y: 0 }, tension: 40, ...overrides });

test('missed gesture is penalized once after the window, even while released', () => {
  const before = updateFishingState(50, warning(), config);
  expect(before.directionalResolved).toBe(false);
  expect(before.tension).toBeCloseTo(38.8);
  const missed = updateFishingState(50, before, config);
  expect(missed.directionalResolved).toBe(true);
  expect(missed.tension).toBeCloseTo(57.6);
  const later = updateFishingState(100, missed, config);
  expect(later.tension).toBeCloseTo(55.2);
});

test('corrected gesture before the deadline avoids penalty with no reward', () => {
  const followed = updateFishingState(100, warning({ directionalFollowed: true }), config);
  expect(followed.tension).toBeCloseTo(37.6);
  expect(followed.catchProgress).toBe(0);
  expect(followed.directionalResolved).toBe(true);
});

test('a missed gesture can break the line', () => {
  const next = updateFishingState(100, warning({ tension: 90, playerPulling: true }), config);
  expect(next.result).toBe('failure');
  expect(next.failureReason).toBe('break');
});

test('slack cannot be rescued by a simultaneous missed-gesture penalty', () => {
  const next = updateFishingState(100, warning({ tension: 1 }), config);
  expect(next.result).toBe('failure');
  expect(next.failureReason).toBe('slack');
});

test('zero and full tension beat a simultaneous catch, and terminal states stay terminal', () => {
  for (const tension of [0, 100]) {
    const state = { ...createFishingState(config), catchProgress: 100, tension };
    const next = updateFishingState(1, state, { ...config, releasedTensionRecoveryPerSec: 0 });
    expect(next.result).toBe('failure');
    expect(updateFishingState(100, next, config)).toBe(next);
  }
});

test('directional reaction window is equally long at every difficulty', () => {
  for (const difficulty of [1, 2, 3]) {
    const cfg = buildFishingConfig({ difficulty }, { ...FISHING_CONFIG, directionalSurgeChance: 1 });
    const next = updateFishingState(50, { ...createFishingState(cfg), phaseDurationMs: 50, playerPulling: true }, cfg, () => 0);
    expect(next.phaseDurationMs).toBe(750);
  }
});
