export const LOCKPICK_CONFIG = Object.freeze({
  requiredHits: 4,
  timeLimitMs: 20_000,
  missTimePenaltyMs: 2_000,
  rotationDurationMs: 2_550,
  initialTargetWidthDeg: 40,
  targetLifetimeMs: 2_200,
  missPointerStopMs: 120,
  missPointerRecoveryMs: 280,
  missPointerInitialSpeed: 0.375,
  maxActiveTargets: 3,
  targetSpawnIntervalMinMs: 550,
  targetSpawnIntervalMaxMs: 750,
  minTargetGapDegrees: 20,
  spawnPointerExclusionDegrees: 24,
  targetFadeInMs: 120,
  targetFadeOutMs: 150,
  spawnPositionAttempts: 24,
  startingDelayMs: 260,
  resultFadeInMs: 200,
  resultHoldMs: 700,
  resultFadeOutMs: 450,
});

export const normalizeAngle = angle => ((angle % 360) + 360) % 360;

export const angularDistance = (a, b) => {
  const distance = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return Math.min(distance, 360 - distance);
};

export const isAngleInSector = (angle, center, width) => angularDistance(angle, center) <= width / 2;

export const getTargetWidthAtTime = (target, timestamp, config = LOCKPICK_CONFIG) => {
  const lifetime = target.expiresAt - target.spawnTime;
  if (timestamp >= target.expiresAt || lifetime <= 0) return 0;
  const lifeProgress = Math.min(1, Math.max(0, (timestamp - target.spawnTime) / lifetime));
  return config.initialTargetWidthDeg * (1 - lifeProgress);
};

const recoveryDistanceMs = (elapsed, duration, initialSpeed) => {
  const progress = Math.min(1, Math.max(0, elapsed / duration));
  // Integral of an ease-out quadratic speed curve: initialSpeed -> 1.
  return duration * (
    initialSpeed * progress
    + (1 - initialSpeed) * (progress ** 2 - progress ** 3 / 3)
  );
};

export const pointerTravelMsAt = ({
  startedAt, now, stopDurationMs = 0, recoveryDurationMs = 0, recoveryInitialSpeed = 1,
}) => {
  const elapsed = Math.max(0, now - startedAt);
  if (elapsed <= stopDurationMs) return 0;
  const recoveryElapsed = elapsed - stopDurationMs;
  if (recoveryDurationMs <= 0) return recoveryElapsed;
  const recoveryTravel = recoveryDistanceMs(recoveryElapsed, recoveryDurationMs, recoveryInitialSpeed);
  return recoveryElapsed <= recoveryDurationMs
    ? recoveryTravel
    : recoveryDistanceMs(recoveryDurationMs, recoveryDurationMs, recoveryInitialSpeed)
      + recoveryElapsed - recoveryDurationMs;
};

export const pointerSpeedAt = ({
  startedAt, now, stopDurationMs = 0, recoveryDurationMs = 0, recoveryInitialSpeed = 1,
}) => {
  const elapsed = Math.max(0, now - startedAt);
  if (elapsed < stopDurationMs) return 0;
  if (recoveryDurationMs <= 0 || elapsed >= stopDurationMs + recoveryDurationMs) return 1;
  const progress = (elapsed - stopDurationMs) / recoveryDurationMs;
  return recoveryInitialSpeed + (1 - recoveryInitialSpeed) * (1 - (1 - progress) ** 2);
};

export const pointerAngleAt = model => (
  normalizeAngle(model.baseAngle + model.direction
    * (pointerTravelMsAt(model) / model.rotationDurationMs) * 360)
);

export const stopAndRecoverPointerAt = (model, timestamp, rotationDurationMs, config = LOCKPICK_CONFIG) => ({
  ...model,
  baseAngle: pointerAngleAt({ ...model, now: timestamp, rotationDurationMs }),
  startedAt: timestamp,
  stopDurationMs: config.missPointerStopMs,
  recoveryDurationMs: config.missPointerRecoveryMs,
  recoveryInitialSpeed: config.missPointerInitialSpeed,
});

export const reversePointerAt = (model, timestamp, rotationDurationMs) => ({
  ...model,
  baseAngle: pointerAngleAt({ ...model, now: timestamp, rotationDurationMs }),
  startedAt: timestamp,
  direction: model.direction * -1,
  stopDurationMs: 0,
  recoveryDurationMs: 0,
  recoveryInitialSpeed: 1,
});

export const removeExpiredTargets = (targets, timestamp) => targets.filter(target => (
  target.state === 'active' && timestamp < target.expiresAt
));

export const findHittableTarget = (targets, angle, timestamp, config = LOCKPICK_CONFIG) => targets.find(target => (
  target.state === 'active'
  && timestamp < target.expiresAt
  && isAngleInSector(angle, target.angle, getTargetWidthAtTime(target, timestamp, config))
));

export const chooseTargetAngle = ({
  activeTargets, pointerAngle, arcDegrees, minGapDegrees, pointerExclusionDegrees,
  random = Math.random, maxAttempts = LOCKPICK_CONFIG.spawnPositionAttempts,
}) => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = normalizeAngle(random() * 360);
    if (angularDistance(candidate, pointerAngle) < pointerExclusionDegrees + arcDegrees / 2) continue;
    const conflicts = activeTargets.some(target => (
      angularDistance(candidate, target.angle) < arcDegrees / 2 + target.widthDegrees / 2 + minGapDegrees
    ));
    if (!conflicts) return candidate;
  }
  return null;
};

export const spawnIntervalMs = (config, random = Math.random) => (
  config.targetSpawnIntervalMinMs
  + random() * (config.targetSpawnIntervalMaxMs - config.targetSpawnIntervalMinMs)
);
