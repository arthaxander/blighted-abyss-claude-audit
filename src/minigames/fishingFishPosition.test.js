import {
  completeDirectionalSurge, createPersistentFishPosition, FISH_SAFE_AREA, getFishRenderPosition,
  getFishSafeBounds, getIdleMotion,
} from './fishingFishPosition';

test('a completed directional surge persists its endpoint and the next surge starts there', () => {
  const size = { width: 400, height: 700 };
  const start = createPersistentFishPosition({ x: 0.4, y: 0.3 });
  const atEnd = completeDirectionalSurge(start, { endpoint: { x: 296, y: 210 } }, size);
  expect(atEnd).toEqual({ x: 0.74, y: 0.3 });
  expect(getFishRenderPosition({ persistentFishPosition: atEnd, sceneSize: size })).toEqual({ x: 296, y: 210 });
  expect(getFishRenderPosition({ persistentFishPosition: atEnd, sceneSize: size, surgeOffset: { x: 20, y: 0 } }).x).toBe(316);
});

test('calm idle motion stays local to the persistent position', () => {
  const idle = getIdleMotion(900);
  expect(Math.abs(idle.x)).toBeLessThanOrEqual(1.45);
  expect(Math.abs(idle.y)).toBeLessThanOrEqual(1.05);
  const { x, y } = getFishRenderPosition({ persistentFishPosition: { x: 0.74, y: 0.3 }, sceneSize: { width: 400, height: 700 }, idleMotion: idle });
  expect(Math.abs(x - 296)).toBeLessThanOrEqual(1.45);
  expect(Math.abs(y - 210)).toBeLessThanOrEqual(1.05);
});

test('idle breathing is continuous across gameplay phase-reset boundaries', () => {
  const before = getIdleMotion(12_000);
  const after = getIdleMotion(12_016);
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(0.03);
});

test('render and persistent endpoints respect centralized safe bounds and left arc and lower instruction reserve', () => {
  const size = { width: 400, height: 700 };
  const bounds = getFishSafeBounds(size);
  expect(bounds.maxY).toBe(700 - Math.max(FISH_SAFE_AREA.bottomMinPx, 700 * FISH_SAFE_AREA.bottomRatio));
  expect(bounds.minX).toBe(120);
  expect(bounds.maxY).toBeGreaterThan(550);
  expect(getFishRenderPosition({ persistentFishPosition: { x: 1, y: 1 }, sceneSize: size,
    surgeOffset: { x: 80, y: 80 }, idleMotion: { x: 2, y: 2 } })).toEqual({ x: bounds.maxX, y: bounds.maxY });
  expect(completeDirectionalSurge({ x: 0.5, y: 0.5 }, { endpoint: { x: -20, y: 690 } }, size))
    .toEqual({ x: bounds.minX / size.width, y: bounds.maxY / size.height });
});

