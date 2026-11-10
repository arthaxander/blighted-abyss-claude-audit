import fs from 'fs';
import path from 'path';
import {
  BOW_WAVE_GEOMETRY, CALM_RIPPLE_TEXTURE_ANIMATION, drawFishingDirectionalFx,
  getCalmRippleStyle, getCalmRippleTexturePasses, GUIDE_ARROW_GEOMETRY,
  prepareHardWaterMask, WAKE_RENDER_GEOMETRY,
} from './fishingDirectionalCanvas';
import { GOBLINS_FISHING_VISUALS } from './fishingVisuals';

const readyImage = name => ({ name, complete: true, naturalWidth: 100, naturalHeight: 100 });
const makeContext = () => ({
  setTransform: jest.fn(), clearRect: jest.fn(), save: jest.fn(), restore: jest.fn(),
  translate: jest.fn(), rotate: jest.fn(), drawImage: jest.fn(), beginPath: jest.fn(),
  moveTo: jest.fn(), bezierCurveTo: jest.fn(), quadraticCurveTo: jest.fn(), stroke: jest.fn(),
  ellipse: jest.fn(),
  globalAlpha: 1, globalCompositeOperation: 'source-over', strokeStyle: '', lineWidth: 1,
});

test('CALM still draws textured base ripple at the current render fish position', () => {
  const context = makeContext();
  const ripple = readyImage('ripple');
  drawFishingDirectionalFx({
    canvas: { width: 0, height: 0, getContext: () => context }, sceneSize: { width: 390, height: 700 },
    textures: { ripple }, renderFishPosition: { x: 244, y: 318 }, origin: { x: 20, y: 30 },
    direction: { x: 1, y: 0 }, fx: { wakeVisible: false }, timeMs: 600,
  });
  expect(context.translate).toHaveBeenCalledWith(244, 318);
  expect(context.drawImage).toHaveBeenCalledWith(ripple, expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number));
  expect(context.drawImage).toHaveBeenCalledTimes(4);
  expect(context.ellipse).not.toHaveBeenCalled();
});

test('calm ripple breathes continuously instead of remaining a static stamp', () => {
  expect(getCalmRippleStyle(0)).not.toEqual(getCalmRippleStyle(900));
  expect(getCalmRippleStyle(900).opacity).toBeGreaterThan(0);
  expect(getCalmRippleStyle(900).scale).not.toBe(1);
  expect(getCalmRippleStyle(900).rotation).not.toBe(0);
});

test('calm texture passes expand and fade across their staggered animation cycle', () => {
  const early = getCalmRippleTexturePasses(700)[0];
  const late = getCalmRippleTexturePasses(1_400)[0];
  expect(CALM_RIPPLE_TEXTURE_ANIMATION).toEqual(expect.objectContaining({ cycleMs: 1_900, count: 2 }));
  expect(late.size).toBeGreaterThan(early.size);
  expect(late.opacity).toBeLessThan(early.opacity);
  expect(late.size).toBeLessThanOrEqual(CALM_RIPPLE_TEXTURE_ANIMATION.endSize);
});

test('expanding calm ripples reuse the ripple mask without procedural circle strokes', () => {
  expect(getCalmRippleTexturePasses(600, false)).toEqual([]);
  const context = makeContext();
  const ripple = readyImage('ripple');
  drawFishingDirectionalFx({
    canvas: { width: 0, height: 0, getContext: () => context }, sceneSize: { width: 390, height: 700 },
    textures: { ripple }, renderFishPosition: { x: 140, y: 200 }, origin: { x: 100, y: 200 },
    direction: { x: 1, y: 0 }, fx: { wakeVisible: false, active: false }, calm: true, timeMs: 600,
  });
  expect(context.drawImage.mock.calls.filter(([image]) => image === ripple)).toHaveLength(4);
  expect(context.ellipse).not.toHaveBeenCalled();
});

test('directional WARNING uses wake and drag textures behind its moving head', () => {
  const context = makeContext();
  const textures = { ripple: readyImage('ripple'), wake: readyImage('wake'), drag: readyImage('drag'), streak: readyImage('streak') };
  drawFishingDirectionalFx({
    canvas: { width: 0, height: 0, getContext: () => context }, sceneSize: { width: 390, height: 700 },
    textures, renderFishPosition: { x: 140, y: 200 }, origin: { x: 100, y: 200 }, direction: { x: 1, y: 0 },
    fx: { wakeVisible: true, active: true, headX: 40, headY: 0, wakeLength: 70, wakeOpacity: 0.44, dragOpacity: 0.13, streakVisible: false },
    timeMs: 0,
  });
  expect(context.drawImage.mock.calls.some(([image]) => image === textures.wake)).toBe(true);
  expect(context.drawImage.mock.calls.some(([image]) => image === textures.drag)).toBe(true);
  expect(context.drawImage.mock.calls.some(([image]) => image === textures.streak)).toBe(false);
  expect(context.bezierCurveTo).not.toHaveBeenCalled();
  expect(context.drawImage.mock.calls.filter(([image]) => image === textures.ripple)).toHaveLength(1);
  expect(BOW_WAVE_GEOMETRY.innerWidth).toBeGreaterThan(140);
  expect(BOW_WAVE_GEOMETRY.outerWidth).toBeGreaterThan(BOW_WAVE_GEOMETRY.innerWidth);
  expect(BOW_WAVE_GEOMETRY.outerHeight).toBeGreaterThan(BOW_WAVE_GEOMETRY.innerHeight);
  expect(GUIDE_ARROW_GEOMETRY).toEqual(expect.objectContaining({ innerReach: 58, outerReach: 68 }));
  expect(GUIDE_ARROW_GEOMETRY.innerReach).toBeLessThanOrEqual(62);
  expect(GUIDE_ARROW_GEOMETRY.outerReach).toBeLessThanOrEqual(73);
  expect(WAKE_RENDER_GEOMETRY).toEqual(expect.objectContaining({ baseWidth: 64, opacityMultiplier: 1.1 }));
});

test('opaque luminance hard mask is converted to alpha once before compositing', () => {
  const source = readyImage('hard mask');
  source.naturalWidth = 1;
  source.naturalHeight = 1;
  const pixels = { data: new Uint8ClampedArray([100, 200, 50, 255]) };
  const context = { drawImage: jest.fn(), getImageData: jest.fn(() => pixels), putImageData: jest.fn() };
  const canvas = { getContext: () => context };
  expect(prepareHardWaterMask(source, () => canvas)).toBe(canvas);
  expect(pixels.data[3]).toBe(168);
  expect(context.getImageData).toHaveBeenCalledTimes(1);

  const maskPath = path.join(process.cwd(), 'src/minigames/fishing/locations/goblins/fishing_goblins_water_mask.png');
  const png = fs.readFileSync(maskPath);
  expect(png[25]).toBe(2); // PNG color type 2: opaque RGB, so luminance conversion is required.
});

test('renderer is wired to all existing alpha texture assets without new binaries', () => {
  expect(GOBLINS_FISHING_VISUALS).toEqual(expect.objectContaining({
    rippleMask: expect.stringContaining('fishing_ripple_mask_alpha'),
    directionalWakeMask: expect.stringContaining('fishing_directional_wake_mask_alpha'),
    dragDistortionMask: expect.stringContaining('fishing_drag_distortion_mask_alpha'),
    surgeStreakMask: expect.stringContaining('fishing_surge_streak_mask_alpha'),
  }));
});

