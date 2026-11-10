import goblinsBackground from './fishing/locations/goblins/fishing_goblins_water.png';
import goblinsHardMask from './fishing/locations/goblins/fishing_goblins_water_mask.png';
import goblinsSoftMask from './fishing/locations/goblins/fishing_goblins_water_mask_soft.png';
import goblinsDepthMap from './fishing/locations/goblins/fishing_goblins_water_depth.png';
import rippleMask from './fishing/shared/fishing_ripple_mask_alpha.png';
import shimmerMask from './fishing/shared/fishing_shimmer_mask.png';
import distortionMask from './fishing/shared/fishing_distortion_mask.png';
import directionalWakeMask from './fishing/shared/fishing_directional_wake_mask_alpha.png';
import dragDistortionMask from './fishing/shared/fishing_drag_distortion_mask_alpha.png';
import surgeStreakMask from './fishing/shared/fishing_surge_streak_mask_alpha.png';

export const GOBLINS_FISHING_VISUALS = Object.freeze({
  id: 'goblins',
  background: goblinsBackground,
  hardMask: goblinsHardMask,
  softMask: goblinsSoftMask,
  depthMap: goblinsDepthMap,
  rippleMask,
  shimmerMask,
  distortionMask,
  directionalWakeMask,
  dragDistortionMask,
  surgeStreakMask,
  fishAnchors: Object.freeze([
    Object.freeze({ x: 0.43, y: 0.3 }),
    Object.freeze({ x: 0.58, y: 0.48 }),
    Object.freeze({ x: 0.46, y: 0.67 }),
  ]),
});

const LOCATION_VISUALS = Object.freeze({
  'Гоблинские Норы': GOBLINS_FISHING_VISUALS,
});

export const resolveFishingVisuals = location => LOCATION_VISUALS[location] || GOBLINS_FISHING_VISUALS;
