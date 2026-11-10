import { clamp } from './fishingConfig';

export const createPersistentFishPosition = anchor => ({ x: anchor.x, y: anchor.y });

export const FISH_SAFE_AREA = Object.freeze({
  sideMinPx: 36,
  sideRatio: 0.1,
  topMinPx: 180,
  topRatio: 0.17,
  bottomMinPx: 100,
  bottomRatio: 0.15,
});

export const getFishSafeBounds = ({ width, height }) => {
  const side = Math.max(FISH_SAFE_AREA.sideMinPx, width * FISH_SAFE_AREA.sideRatio);
  const top = Math.max(FISH_SAFE_AREA.topMinPx, height * FISH_SAFE_AREA.topRatio);
  const bottom = Math.max(FISH_SAFE_AREA.bottomMinPx, height * FISH_SAFE_AREA.bottomRatio);
  const left = Math.max(side, Math.min(120, width * 0.4));
  return { minX: left, maxX: Math.max(side, width - side), minY: top, maxY: Math.max(top, height - bottom) };
};

// A single, low-frequency continuous clock avoids phase-reset jumps and beat-frequency jitter.
export const getIdleMotion = (timeMs = 0) => ({
  x: Math.sin(timeMs / 1_850) * 1.45,
  y: Math.cos(timeMs / 2_300) * 1.05,
});

export const getFishRenderPosition = ({ persistentFishPosition, sceneSize, surgeOffset = { x: 0, y: 0 }, idleMotion = { x: 0, y: 0 } }) => {
  const bounds = getFishSafeBounds(sceneSize);
  return {
    x: clamp(persistentFishPosition.x * sceneSize.width + surgeOffset.x + idleMotion.x, bounds.minX, bounds.maxX),
    y: clamp(persistentFishPosition.y * sceneSize.height + surgeOffset.y + idleMotion.y, bounds.minY, bounds.maxY),
  };
};

export const completeDirectionalSurge = (persistentFishPosition, trajectory, sceneSize) => {
  const bounds = getFishSafeBounds(sceneSize);
  return {
    x: clamp(trajectory.endpoint.x, bounds.minX, bounds.maxX) / Math.max(1, sceneSize.width),
    y: clamp(trajectory.endpoint.y, bounds.minY, bounds.maxY) / Math.max(1, sceneSize.height),
  };
};

