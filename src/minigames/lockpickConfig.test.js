import {
  angularDistance, chooseTargetAngle, findHittableTarget, getTargetWidthAtTime, isAngleInSector,
  LOCKPICK_CONFIG, pointerAngleAt, pointerSpeedAt, removeExpiredTargets, reversePointerAt, spawnIntervalMs,
  stopAndRecoverPointerAt,
} from './lockpickConfig';

test('angular hit detection and timestamp rotation wrap through zero in both directions', () => {
  expect(angularDistance(355, 5)).toBe(10);
  expect(isAngleInSector(355, 5, 20)).toBe(true);
  expect(isAngleInSector(354.9, 5, 20)).toBe(false);
  const common = { baseAngle: 10, startedAt: 100, now: 700, rotationDurationMs: 2400 };
  expect(pointerAngleAt({ ...common, direction: 1 })).toBe(100);
  expect(pointerAngleAt({ ...common, direction: -1 })).toBe(280);
  expect(pointerAngleAt({ baseAngle: 350, startedAt: 0, now: 100, direction: 1, rotationDurationMs: 3600 })).toBe(0);
});

test('reversal rebases at the authoritative angle and remains continuous in both directions', () => {
  const clockwise = { baseAngle: 350, startedAt: 100, direction: 1, deadline: 9999, nextSpawnAt: 700 };
  const firstHitAt = 200;
  const beforeFirstHit = pointerAngleAt({ ...clockwise, now: firstHitAt, rotationDurationMs: 3600 });
  const counterClockwise = reversePointerAt(clockwise, firstHitAt, 3600);

  expect(counterClockwise).toMatchObject({
    baseAngle: beforeFirstHit, startedAt: firstHitAt, direction: -1, deadline: 9999, nextSpawnAt: 700,
  });
  expect(pointerAngleAt({ ...counterClockwise, now: firstHitAt, rotationDurationMs: 3600 })).toBe(beforeFirstHit);
  expect(pointerAngleAt({ ...counterClockwise, now: firstHitAt + 10, rotationDurationMs: 3600 }))
    .toBeCloseTo(359);

  const secondHitAt = 300;
  const beforeSecondHit = pointerAngleAt({ ...counterClockwise, now: secondHitAt, rotationDurationMs: 3600 });
  const clockwiseAgain = reversePointerAt(counterClockwise, secondHitAt, 3600);
  expect(clockwiseAgain.direction).toBe(1);
  expect(pointerAngleAt({ ...clockwiseAgain, now: secondHitAt, rotationDurationMs: 3600 })).toBe(beforeSecondHit);
});

test('counter-clockwise movement wraps through zero after reversal', () => {
  const reversed = reversePointerAt({ baseAngle: 10, startedAt: 0, direction: 1 }, 0, 3600);
  expect(pointerAngleAt({ ...reversed, now: 110, rotationDurationMs: 3600 })).toBe(359);
});

test('miss rebases at the authoritative angle, stops, and smoothly recovers without teleporting', () => {
  const normal = { baseAngle: 20, startedAt: 0, direction: 1, deadline: 20_000, nextSpawnAt: 650 };
  const missAt = 500;
  const angleAtMiss = pointerAngleAt({ ...normal, now: missAt, rotationDurationMs: 1000 });
  const recovering = stopAndRecoverPointerAt(normal, missAt, 1000, {
    missPointerStopMs: 120, missPointerRecoveryMs: 280, missPointerInitialSpeed: 0.375,
  });

  expect(recovering).toMatchObject({
    baseAngle: angleAtMiss, startedAt: missAt, direction: 1, deadline: 20_000, nextSpawnAt: 650,
  });
  expect(pointerAngleAt({ ...recovering, now: missAt, rotationDurationMs: 1000 })).toBe(angleAtMiss);
  expect(pointerAngleAt({ ...recovering, now: missAt + 119, rotationDurationMs: 1000 })).toBe(angleAtMiss);
  expect(pointerSpeedAt({ ...recovering, now: missAt + 120 })).toBeCloseTo(0.375);
  expect(pointerSpeedAt({ ...recovering, now: missAt + 260 })).toBeGreaterThan(0.375);
  expect(pointerSpeedAt({ ...recovering, now: missAt + 400 })).toBe(1);

  [[missAt + 119, missAt + 120], [missAt + 120, missAt + 121],
    [missAt + 399, missAt + 400], [missAt + 400, missAt + 401]].forEach(([beforeTime, afterTime]) => {
    const before = pointerAngleAt({ ...recovering, now: beforeTime, rotationDurationMs: 1000 });
    const after = pointerAngleAt({ ...recovering, now: afterTime, rotationDurationMs: 1000 });
    expect(angularDistance(before, after)).toBeLessThan(1);
  });
});

test('hit reverses direction and cancels an in-progress miss speed profile continuously', () => {
  const recovering = stopAndRecoverPointerAt(
    { baseAngle: 0, startedAt: 0, direction: -1 }, 100, 1000,
    { missPointerStopMs: 120, missPointerRecoveryMs: 280, missPointerInitialSpeed: 0.375 },
  );
  const hitAt = 250;
  const before = pointerAngleAt({ ...recovering, now: hitAt, rotationDurationMs: 1000 });
  const reversed = reversePointerAt(recovering, hitAt, 1000);
  expect(reversed.direction).toBe(1);
  expect(pointerAngleAt({ ...reversed, now: hitAt, rotationDurationMs: 1000 })).toBe(before);
  expect(pointerSpeedAt({ ...reversed, now: hitAt })).toBe(1);
});

test('target width shrinks linearly from configured width to zero at authoritative expiry', () => {
  const target = { spawnTime: 1000, expiresAt: 2700 };
  expect(LOCKPICK_CONFIG.initialTargetWidthDeg).toBe(40);
  expect(getTargetWidthAtTime(target, 900)).toBe(40);
  expect(getTargetWidthAtTime(target, 1000)).toBe(40);
  expect(getTargetWidthAtTime(target, 1425)).toBe(30);
  expect(getTargetWidthAtTime(target, 1850)).toBe(20);
  expect(getTargetWidthAtTime(target, 2699)).toBeLessThan(0.03);
  expect(getTargetWidthAtTime(target, 2700)).toBe(0);
  expect(getTargetWidthAtTime(target, 3000)).toBe(0);
  const samples = [1000, 1200, 1600, 2200, 2699].map(time => getTargetWidthAtTime(target, time));
  expect(samples.every((width, index) => index === 0 || width < samples[index - 1])).toBe(true);
});

test('canonical target is 40 degrees at spawn, 20 halfway, and unhittable at 2200ms', () => {
  const target = { id: 1, angle: 0, state: 'active', spawnTime: 100, expiresAt: 2300 };
  expect(getTargetWidthAtTime(target, 100)).toBe(40);
  expect(getTargetWidthAtTime(target, 1200)).toBe(20);
  expect(getTargetWidthAtTime(target, 2300)).toBe(0);
  expect(findHittableTarget([target], 0, 2299, LOCKPICK_CONFIG)).toBe(target);
  expect(findHittableTarget([target], 0, 2300, LOCKPICK_CONFIG)).toBeUndefined();
});

test('canonical target lifetime is exactly 2200ms and independent of rotation duration', () => {
  expect(LOCKPICK_CONFIG.targetLifetimeMs).toBe(2200);
  expect(LOCKPICK_CONFIG.rotationDurationMs).toBe(2550);
});

test('targets expire independently without producing another gameplay outcome', () => {
  const targets = [
    { id: 1, state: 'active', expiresAt: 100 },
    { id: 2, state: 'active', expiresAt: 200 },
  ];
  expect(removeExpiredTargets(targets, 100)).toEqual([targets[1]]);
  expect(removeExpiredTargets(targets, 199)).toEqual([targets[1]]);
});

test('hit lookup checks all targets, wraps zero, and returns at most one', () => {
  const config = { initialTargetWidthDeg: 40 };
  const targets = [
    { id: 1, angle: 180, state: 'active', spawnTime: 0, expiresAt: 500 },
    { id: 2, angle: 5, state: 'active', spawnTime: 0, expiresAt: 500 },
    { id: 3, angle: 5, state: 'active', spawnTime: 0, expiresAt: 500 },
  ];
  expect(findHittableTarget(targets, 355, 100, config)).toBe(targets[1]);
  expect(findHittableTarget(targets, 180, 500, config)).toBeUndefined();
});

test('hit detection uses independently shrinking widths and still wraps around zero', () => {
  const config = { initialTargetWidthDeg: 40 };
  const fresh = { id: 1, angle: 5, state: 'active', spawnTime: 400, expiresAt: 1400 };
  const old = { id: 2, angle: 180, state: 'active', spawnTime: 0, expiresAt: 1000 };
  expect(getTargetWidthAtTime(fresh, 500, config)).toBe(36);
  expect(getTargetWidthAtTime(old, 500, config)).toBe(20);
  expect(findHittableTarget([fresh], 349, 500, config)).toBe(fresh);
  expect(findHittableTarget([fresh], 349, 900, config)).toBeUndefined();
});

test('spawn enforces edge gap and pointer exclusion', () => {
  const values = [0, 100 / 360, 200 / 360];
  const angle = chooseTargetAngle({
    activeTargets: [{ angle: 100, widthDegrees: 40 }], pointerAngle: 0, arcDegrees: 40,
    minGapDegrees: 20, pointerExclusionDegrees: 20, random: () => values.shift(), maxAttempts: 3,
  });
  expect(angle).toBeCloseTo(200);
  expect(angularDistance(angle, 100) - 40).toBeGreaterThanOrEqual(20);
});

test('spawn gives up after a finite attempt budget and cadence is deterministic', () => {
  const random = jest.fn(() => 0);
  expect(chooseTargetAngle({
    activeTargets: [], pointerAngle: 0, arcDegrees: 40, minGapDegrees: 20,
    pointerExclusionDegrees: 30, random, maxAttempts: 4,
  })).toBeNull();
  expect(random).toHaveBeenCalledTimes(4);
  expect(spawnIntervalMs({ targetSpawnIntervalMinMs: 550, targetSpawnIntervalMaxMs: 750 }, () => 0.5)).toBe(650);
});
