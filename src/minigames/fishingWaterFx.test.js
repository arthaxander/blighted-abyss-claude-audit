import { FISHING_CONFIG, FISH_PHASE } from './fishingConfig';
import fs from 'fs';
import path from 'path';
import {
  getDirectionalFx, getDirectionalTrajectory, getDirectionalTravelProgress,
  getResponsiveDirectionalTravel, resolveVisibleSurgeDirection, SURGE_STREAK_MS, WAKE_FADE_MS,
} from './fishingWaterFx';
import { getFishSafeBounds } from './fishingFishPosition';

const directional = {
  surgeDirectional: true, surgeDirection: { x: 1, y: 0 },
  fishPhase: FISH_PHASE.SURGE_WARNING, phaseElapsedMs: 500, phaseDurationMs: 1000,
};
const trajectory = getDirectionalTrajectory({
  sceneWidth: 400, sceneHeight: 700, anchor: { x: 0.43, y: 0.3 }, direction: directional.surgeDirection,
});

test('responsive travel clamps to 120–180 CSS pixels', () => {
  expect(getResponsiveDirectionalTravel(240)).toBe(120);
  expect(getResponsiveDirectionalTravel(400)).toBe(136);
  expect(getResponsiveDirectionalTravel(900)).toBe(180);
});

test('trajectory endpoint is clamped inside the safe area without shrinking ordinary travel', () => {
  const bounds = getFishSafeBounds({ width: 400, height: 700 });
  expect(trajectory.travel).toBe(136);
  expect(trajectory.endpoint.x).toBeLessThanOrEqual(bounds.maxX);
  const edge = getDirectionalTrajectory({
    sceneWidth: 400, sceneHeight: 700, anchor: { x: 0.98, y: 0.5 }, direction: { x: 1, y: 0 },
  });
  expect(edge.endpoint.x).toBe(bounds.maxX);
  expect(edge.travel).toBeLessThan(edge.requestedTravel);
  const towardHud = getDirectionalTrajectory({
    sceneWidth: 400, sceneHeight: 700, anchor: { x: 0.5, y: 0.85 }, direction: { x: 0, y: 1 },
  });
  expect(towardHud.endpoint.y).toBe(bounds.maxY);
});

test('warning and surge share one continuous 40/60 trajectory', () => {
  expect(getDirectionalTravelProgress(directional)).toBeCloseTo(0.2);
  expect(getDirectionalTravelProgress({ ...directional, phaseElapsedMs: 1000 })).toBeCloseTo(0.4);
  expect(getDirectionalTravelProgress({ ...directional, fishPhase: FISH_PHASE.SURGE, phaseElapsedMs: 0 })).toBeCloseTo(0.4);
  expect(getDirectionalTravelProgress({ ...directional, fishPhase: FISH_PHASE.SURGE, phaseElapsedMs: 500 })).toBeCloseTo(0.7);
});

test('wake grows during directional phases and fades for 220ms afterwards', () => {
  const warningFx = getDirectionalFx(directional, trajectory);
  const laterFx = getDirectionalFx({ ...directional, phaseElapsedMs: 900 }, trajectory);
  expect(laterFx.wakeLength).toBeGreaterThan(warningFx.wakeLength);
  expect(warningFx.wakeVisible).toBe(true);
  expect(getDirectionalFx({ ...directional, surgeDirectional: false }, trajectory, WAKE_FADE_MS / 2).wakeOpacity)
    .toBeCloseTo(0.22);
  expect(getDirectionalFx({ ...directional, surgeDirectional: false }, trajectory, 0).wakeVisible).toBe(false);
});

test('drag distortion follows wake and surge streak is a short active-surge impulse', () => {
  const start = getDirectionalFx({ ...directional, fishPhase: FISH_PHASE.SURGE, phaseElapsedMs: 0 }, trajectory);
  expect(start.dragOpacity).toBeGreaterThan(0);
  expect(start.streakVisible).toBe(true);
  expect(getDirectionalFx({ ...directional, fishPhase: FISH_PHASE.SURGE, phaseElapsedMs: SURGE_STREAK_MS + 1 }, trajectory).streakVisible)
    .toBe(false);
});

test('non-directional water creates no directional wake and gameplay parameters stay fixed', () => {
  expect(getDirectionalFx({ ...directional, surgeDirectional: false }, trajectory, 0).wakeVisible).toBe(false);
  expect(FISHING_CONFIG).toEqual(expect.objectContaining({
    directionalSurgeChance: 0.45,
    directionalDragMinDistance: 44,
    directionalToleranceDeg: 46,
    directionalReactionMs: 750,
    directionalMissTension: 20,
  }));
});

test('directional renderer is a single stable canvas without compositor-heavy directional CSS', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'src/components/FishingRoomModal.css'), 'utf8');
  const canvasRule = css.slice(css.indexOf('.fishing__directional-canvas'), css.indexOf('}', css.indexOf('.fishing__directional-canvas')) + 1);
  expect(canvasRule).toContain('position:absolute');
  expect(canvasRule).toContain('inset:0');
  expect(canvasRule).not.toContain('mask-image');
  expect(canvasRule).not.toContain('mix-blend-mode');
  expect(canvasRule).not.toContain('filter:blur');
  expect(css).not.toContain('.fishing__directional-water');
});



test('outward gestures are reflected before display and have visible travel', () => {
  const args = { sceneWidth: 390, sceneHeight: 700, anchor: { x: 0.9, y: 0.4 } };
  const direction = resolveVisibleSurgeDirection({ ...args, direction: { x: 1, y: 0 } });
  expect(direction.x).toBe(-1);
  expect(getDirectionalTrajectory({ ...args, direction }).travel).toBeGreaterThan(100);
});

test('trajectory exposes the clamped origin for both line and water rendering', () => {
  const trajectory = getDirectionalTrajectory({ sceneWidth: 800, sceneHeight: 360,
    anchor: { x: 0.46, y: 1 }, direction: { x: 0, y: -1 } });
  expect(trajectory.start.y).toBe(260);
  expect(trajectory.endpoint.y).toBe(180);
});

