import { FISH_PHASE } from './fishingConfig';
import { nextSurgeHapticTime } from './fishingHaptics';

const held = { playerPulling: true, surgeDirectional: false, fishPhase: FISH_PHASE.SURGE_WARNING };
test('warns immediately and repeats at a gentle cadence through the ordinary surge', () => {
  expect(nextSurgeHapticTime(held, 100, null)).toBe(100);
  expect(nextSurgeHapticTime(held, 749, 100)).toBe(100);
  expect(nextSurgeHapticTime({ ...held, fishPhase: FISH_PHASE.SURGE }, 750, 100)).toBe(750);
});
test.each([
  { playerPulling: false },
  { surgeDirectional: true },
  { fishPhase: FISH_PHASE.CALM },
  { result: 'FAILURE' },
  { result: 'SUCCESS' },
])('stops for %j', change => {
  expect(nextSurgeHapticTime({ ...held, ...change }, 800, 100)).toBeNull();
});
test('silences hidden pages and restarts immediately after a new hold', () => {
  expect(nextSurgeHapticTime(held, 800, 100, true)).toBeNull();
  const released = nextSurgeHapticTime({ ...held, playerPulling: false }, 200, 100);
  expect(nextSurgeHapticTime(held, 250, released)).toBe(250);
});
