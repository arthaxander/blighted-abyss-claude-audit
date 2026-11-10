export const FISH_PHASE = Object.freeze({
  CALM: 'CALM',
  SURGE_WARNING: 'SURGE_WARNING',
  SURGE: 'SURGE',
});

export const FISHING_CONFIG = Object.freeze({
  catchProgressStart: 0,
  tensionStart: 40,
  catchGoal: 100,
  breakTension: 100,
  calmPullProgressPerSec: 9,
  calmPullTensionPerSec: 7,
  surgePullProgressPerSec: 2.5,
  surgePullTensionPerSec: 30,
  releasedProgressLossPerSec: 3,
  releasedTensionRecoveryPerSec: 24,
  calmDurationMinMs: 1_800,
  calmDurationMaxMs: 2_800,
  warningDurationMinMs: 500,
  warningDurationMaxMs: 700,
  surgeDurationMinMs: 800,
  surgeDurationMaxMs: 1_200,
  directionalSurgeChance: 0.45,
  directionalDragMinDistance: 44,
  directionalToleranceDeg: 46,
  directionalReactionMs: 750,
  directionalMissTension: 20,
  maxSimulationDeltaMs: 100,
  startingDelayMs: 260,
  resultFadeInMs: 200,
  resultHoldMs: 700,
  resultFadeOutMs: 450,
});

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const resolveFishingDifficulty = (difficulty = 1, controlBonus = 0, calmDurationBonusMs = 0) => {
  const level = clamp(Math.round(difficulty) || 1, 1, 3);
  const control = clamp(Number(controlBonus) || 0, 0, 0.25);
  const difficultyStep = level - 1;
  return {
    difficulty: level,
    tensionGainMultiplier: (1 + difficultyStep * 0.12) * (1 - control),
    pullEfficiencyMultiplier: 1 + control * 0.5,
    calmDurationMultiplier: 1 - difficultyStep * 0.1,
    calmDurationBonusMs: clamp(Number(calmDurationBonusMs) || 0, 0, 250),
    warningDurationMultiplier: 1 - difficultyStep * 0.08,
    surgeDurationMultiplier: 1 + difficultyStep * 0.06,
  };
};

const rangeValue = (min, max, random) => min + (max - min) * clamp(random(), 0, 1);

export const getFishPhaseDuration = (phase, config, random = Math.random) => {
  if (phase === FISH_PHASE.SURGE_WARNING) {
    return rangeValue(config.warningDurationMinMs, config.warningDurationMaxMs, random)
      * config.warningDurationMultiplier;
  }
  if (phase === FISH_PHASE.SURGE) {
    return rangeValue(config.surgeDurationMinMs, config.surgeDurationMaxMs, random)
      * config.surgeDurationMultiplier;
  }
  return rangeValue(config.calmDurationMinMs, config.calmDurationMaxMs, random)
    * config.calmDurationMultiplier + config.calmDurationBonusMs;
};

export const nextFishPhase = phase => {
  if (phase === FISH_PHASE.CALM) return FISH_PHASE.SURGE_WARNING;
  if (phase === FISH_PHASE.SURGE_WARNING) return FISH_PHASE.SURGE;
  return FISH_PHASE.CALM;
};

export const createFishingState = (config, random = Math.random) => ({
  catchProgress: config.catchProgressStart,
  tension: config.tensionStart,
  playerPulling: false,
  fishPhase: FISH_PHASE.CALM,
  phaseElapsedMs: 0,
  phaseDurationMs: getFishPhaseDuration(FISH_PHASE.CALM, config, random),
  result: null,
  surgeDirectional: false,
  surgeDirection: null,
  directionalFollowed: false,
  directionalResolved: false,
  failureReason: null,
});

export const directionFromAngle = angle => ({ x: Math.cos(angle), y: Math.sin(angle) });

export const evaluateDirectionalDrag = (start, current, requiredDirection, config = FISHING_CONFIG) => {
  if (!start || !current || !requiredDirection) return { distance: 0, direction: null, angleDifferenceDeg: null, followed: false };
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const distance = Math.hypot(dx, dy);
  if (!distance) return { distance, direction: null, angleDifferenceDeg: null, followed: false };
  const direction = { x: dx / distance, y: dy / distance };
  const dot = clamp(direction.x * requiredDirection.x + direction.y * requiredDirection.y, -1, 1);
  const angleDifferenceDeg = Math.acos(dot) * 180 / Math.PI;
  return { distance, direction, angleDifferenceDeg, followed: distance >= config.directionalDragMinDistance && angleDifferenceDeg <= config.directionalToleranceDeg };
};

export const updateFishingState = (deltaMs, state, config, random = Math.random) => {
  if (state.result) return state;
  let remaining = clamp(deltaMs, 0, config.maxSimulationDeltaMs);
  let next = { ...state };
  const checkResult = () => {
    next.failureReason = next.tension <= 0 ? 'slack' : next.tension >= config.breakTension ? 'break' : null;
    next.result = next.failureReason ? 'failure' : next.catchProgress >= config.catchGoal ? 'success' : null;
  };
  // Integrate each phase separately so a slow frame cannot charge the old phase's rate.
  while (remaining > 0 && !next.result) {
    const step = Math.min(remaining, Math.max(0, next.phaseDurationMs - next.phaseElapsedMs));
    const seconds = step / 1000;
    const surge = next.fishPhase === FISH_PHASE.SURGE;
    const tensionRate = surge && !next.surgeDirectional ? config.surgePullTensionPerSec : config.calmPullTensionPerSec;
    const progressRate = surge ? config.surgePullProgressPerSec : config.calmPullProgressPerSec;
    next.catchProgress = clamp(next.catchProgress + (next.playerPulling
      ? progressRate * config.pullEfficiencyMultiplier : -config.releasedProgressLossPerSec) * seconds, 0, config.catchGoal);
    next.tension = clamp(next.tension + (next.playerPulling
      ? tensionRate * config.tensionGainMultiplier : -config.releasedTensionRecoveryPerSec) * seconds, 0, config.breakTension);
    next.phaseElapsedMs += step;
    remaining -= step;
    const wentSlack = next.tension <= 0;
    // Resolve the gesture once, even if the player released the screen.
    if (next.phaseElapsedMs >= next.phaseDurationMs
      && next.fishPhase === FISH_PHASE.SURGE_WARNING && next.surgeDirectional && !next.directionalResolved) {
      next.directionalResolved = true;
      if (!next.directionalFollowed) next.tension = clamp(next.tension + config.directionalMissTension, 0, config.breakTension);
    }
    // Both line limits take priority over a simultaneous catch.
    // A penalty must not rescue a line which already went slack during this step.
    if (wentSlack) next.tension = 0;
    checkResult();
    if (next.result) break;
    if (next.phaseElapsedMs >= next.phaseDurationMs) {
      next.phaseElapsedMs = 0;
      next.fishPhase = nextFishPhase(next.fishPhase);
      next.phaseDurationMs = Math.max(1, getFishPhaseDuration(next.fishPhase, config, random));
      if (next.fishPhase === FISH_PHASE.SURGE_WARNING) {
        next.surgeDirectional = random() < config.directionalSurgeChance;
        next.surgeDirection = next.surgeDirectional ? directionFromAngle(random() * Math.PI * 2) : null;
        next.directionalFollowed = false;
        next.directionalResolved = false;
        if (next.surgeDirectional) next.phaseDurationMs = Math.max(1, config.directionalReactionMs);
      } else if (next.fishPhase === FISH_PHASE.CALM) {
        next.surgeDirectional = false;
        next.surgeDirection = null;
        next.directionalFollowed = false;
        next.directionalResolved = false;
      }
    }
  }
  return next;
};

export const buildFishingConfig = ({ difficulty = 1, controlBonus = 0, calmDurationBonusMs = 0 } = {}, base = FISHING_CONFIG) => ({
  ...base,
  ...resolveFishingDifficulty(difficulty, controlBonus, calmDurationBonusMs),
});

