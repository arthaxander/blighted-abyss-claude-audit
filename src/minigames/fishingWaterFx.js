import { FISH_PHASE, clamp } from './fishingConfig';
import { getFishSafeBounds } from './fishingFishPosition';

export const WARNING_TRAJECTORY_SHARE = 0.4;
export const WAKE_TRAVEL_SHARE = 0.72;
export const WAKE_FADE_MS = 220;
export const SURGE_STREAK_MS = 240;

export const getResponsiveDirectionalTravel = sceneWidth => clamp(sceneWidth * 0.34, 120, 180);

export const getDirectionalTravelProgress = (state) => {
  if (!state?.surgeDirectional) return 0;
  const phaseProgress = clamp(state.phaseElapsedMs / Math.max(1, state.phaseDurationMs), 0, 1);
  if (state.fishPhase === FISH_PHASE.SURGE_WARNING) return phaseProgress * WARNING_TRAJECTORY_SHARE;
  if (state.fishPhase === FISH_PHASE.SURGE) {
    return WARNING_TRAJECTORY_SHARE + phaseProgress * (1 - WARNING_TRAJECTORY_SHARE);
  }
  return 0;
};

// Reflect outward directions before presenting the gesture, leaving room for a visible surge.
export const resolveVisibleSurgeDirection = ({ sceneWidth, sceneHeight, anchor, direction }) => {
  const bounds = getFishSafeBounds({ width: sceneWidth, height: sceneHeight });
  const x = clamp(anchor.x * sceneWidth, bounds.minX, bounds.maxX);
  const y = clamp(anchor.y * sceneHeight, bounds.minY, bounds.maxY);
  const margin = Math.min(90, (bounds.maxX - bounds.minX) / 3, (bounds.maxY - bounds.minY) / 3);
  let dx = direction.x;
  let dy = direction.y;
  if ((dx > 0 && bounds.maxX - x < margin) || (dx < 0 && x - bounds.minX < margin)) dx = -dx;
  if ((dy > 0 && bounds.maxY - y < margin) || (dy < 0 && y - bounds.minY < margin)) dy = -dy;
  return { x: dx, y: dy };
};

// The ray is shortened only when its requested endpoint would leave the renderable scene.
export const getDirectionalTrajectory = ({ sceneWidth, sceneHeight, anchor, direction }) => {
  const width = Math.max(1, sceneWidth);
  const height = Math.max(1, sceneHeight);
  const bounds = getFishSafeBounds({ width, height });
  const start = {
    x: clamp(anchor.x * width, bounds.minX, bounds.maxX),
    y: clamp(anchor.y * height, bounds.minY, bounds.maxY),
  };
  const requestedTravel = getResponsiveDirectionalTravel(width);
  const candidates = [requestedTravel];
  if (direction.x > 0) candidates.push((bounds.maxX - start.x) / direction.x);
  if (direction.x < 0) candidates.push((bounds.minX - start.x) / direction.x);
  if (direction.y > 0) candidates.push((bounds.maxY - start.y) / direction.y);
  if (direction.y < 0) candidates.push((bounds.minY - start.y) / direction.y);
  const travel = Math.max(0, Math.min(...candidates.filter(Number.isFinite)));
  return {
    start,
    requestedTravel,
    travel,
    endpoint: { x: start.x + direction.x * travel, y: start.y + direction.y * travel },
    angle: Math.atan2(direction.y, direction.x) * 180 / Math.PI,
  };
};

export const getDirectionalFx = (state, trajectory, fadeRemainingMs = WAKE_FADE_MS) => {
  const active = Boolean(state?.surgeDirectional && state.surgeDirection
    && (state.fishPhase === FISH_PHASE.SURGE_WARNING || state.fishPhase === FISH_PHASE.SURGE));
  const progress = active ? getDirectionalTravelProgress(state) : 1;
  const fade = active ? 1 : clamp(fadeRemainingMs / WAKE_FADE_MS, 0, 1);
  const wakeLength = trajectory.travel * WAKE_TRAVEL_SHARE * progress;
  const streakProgress = state?.fishPhase === FISH_PHASE.SURGE
    ? clamp(state.phaseElapsedMs / SURGE_STREAK_MS, 0, 1) : 1;
  return {
    active,
    progress,
    headX: state?.surgeDirection?.x * trajectory.travel * progress || 0,
    headY: state?.surgeDirection?.y * trajectory.travel * progress || 0,
    wakeVisible: active || fade > 0,
    wakeLength,
    wakeOpacity: 0.44 * fade,
    dragOpacity: 0.13 * fade,
    streakVisible: active && state.fishPhase === FISH_PHASE.SURGE && state.phaseElapsedMs <= SURGE_STREAK_MS,
    streakOpacity: 0.58 * (1 - streakProgress),
  };
};

