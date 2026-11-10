import { GOBLINS_FISHING_VISUALS, resolveFishingVisuals } from './fishingVisuals';
import { createFishingChallenge, getFishingPoolForLocation } from '../data/fishing';

test('locations without a visual pack use goblins without replacing gameplay location or pool', () => {
  expect(resolveFishingVisuals('Грибные Пещеры')).toBe(GOBLINS_FISHING_VISUALS);
  expect(getFishingPoolForLocation('Грибные Пещеры').common[0].name).toBe('Светокаповая минога');
  const challenge = createFishingChallenge('Грибные Пещеры');
  expect(challenge.location).toBe('Грибные Пещеры');
  expect([...getFishingPoolForLocation('Грибные Пещеры').common, ...getFishingPoolForLocation('Грибные Пещеры').unique]
    .map(fish => fish.name)).toContain(challenge.fish.name);
});

test('visual pack exposes existing hard, soft, depth, and shared FX assets', () => {
  expect(GOBLINS_FISHING_VISUALS).toEqual(expect.objectContaining({
    hardMask: expect.stringContaining('fishing_goblins_water_mask'),
    softMask: expect.stringContaining('fishing_goblins_water_mask_soft'),
    depthMap: expect.stringContaining('fishing_goblins_water_depth'),
    rippleMask: expect.stringContaining('fishing_ripple_mask'),
    shimmerMask: expect.stringContaining('fishing_shimmer_mask'),
    distortionMask: expect.stringContaining('fishing_distortion_mask'),
    directionalWakeMask: expect.stringContaining('fishing_directional_wake_mask_alpha'),
    dragDistortionMask: expect.stringContaining('fishing_drag_distortion_mask_alpha'),
    surgeStreakMask: expect.stringContaining('fishing_surge_streak_mask_alpha'),
  }));
  expect(GOBLINS_FISHING_VISUALS.rippleMask).toContain('fishing_ripple_mask_alpha');
});
