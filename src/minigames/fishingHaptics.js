import { FISH_PHASE } from './fishingConfig';

export const SURGE_HAPTIC_INTERVAL_MS = 650;

// Return null outside an ordinary surge so the next held surge warns immediately.
export const nextSurgeHapticTime = (state, timestamp, lastPulse, hidden = false) => {
  if (hidden || state.result || !state.playerPulling || state.surgeDirectional
    || (state.fishPhase !== FISH_PHASE.SURGE_WARNING && state.fishPhase !== FISH_PHASE.SURGE)) return null;
  return lastPulse === null || timestamp - lastPulse >= SURGE_HAPTIC_INTERVAL_MS ? timestamp : lastPulse;
};
