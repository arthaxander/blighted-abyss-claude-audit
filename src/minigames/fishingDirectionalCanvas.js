const imageReady = image => Boolean(image?.complete && image.naturalWidth);

const drawTexture = (context, image, x, y, width, height, alpha) => {
  if (!imageReady(image) || width <= 0 || height <= 0 || alpha <= 0) return;
  context.save();
  context.globalAlpha = alpha;
  context.drawImage(image, x, y, width, height);
  context.restore();
};

export const getCalmRippleStyle = (timeMs = 0, directionalActive = false) => {
  if (directionalActive) return { opacity: 0, scale: 1, rotation: 0, outerOpacity: 0, outerScale: 1, outerRotation: 0 };
  const phase = timeMs / 1_650;
  return {
    opacity: 0.28 + Math.sin(phase) * 0.035,
    scale: 1 + Math.sin(phase) * 0.045,
    rotation: Math.sin(phase * 0.63) * 0.045,
    outerOpacity: 0.13 + Math.sin(phase + 1.8) * 0.025,
    outerScale: 1.1 + Math.sin(phase + 1.8) * 0.055,
    outerRotation: -Math.sin(phase * 0.51 + 0.7) * 0.06,
  };
};

export const CALM_RIPPLE_TEXTURE_ANIMATION = Object.freeze({
  cycleMs: 1_900,
  count: 2,
  startSize: 42,
  endSize: 124,
  verticalScale: 0.72,
  maxOpacity: 0.105,
});

export const getCalmRippleTexturePasses = (timeMs = 0, calm = true) => {
  if (!calm) return [];
  return Array.from({ length: CALM_RIPPLE_TEXTURE_ANIMATION.count }, (_, index) => {
    const progress = ((timeMs / CALM_RIPPLE_TEXTURE_ANIMATION.cycleMs) + index / CALM_RIPPLE_TEXTURE_ANIMATION.count) % 1;
    const easedProgress = 1 - ((1 - progress) ** 2);
    return {
      size: CALM_RIPPLE_TEXTURE_ANIMATION.startSize
        + (CALM_RIPPLE_TEXTURE_ANIMATION.endSize - CALM_RIPPLE_TEXTURE_ANIMATION.startSize) * easedProgress,
      opacity: Math.sin(progress * Math.PI) * CALM_RIPPLE_TEXTURE_ANIMATION.maxOpacity,
      rotation: (index ? -1 : 1) * (0.035 + progress * 0.025),
    };
  });
};

export const BOW_WAVE_GEOMETRY = Object.freeze({
  innerWidth: 164, innerHeight: 112, innerOffset: 38, innerOpacity: 0.32,
  outerWidth: 196, outerHeight: 136, outerOffset: 50, outerOpacity: 0.17,
});

export const GUIDE_ARROW_GEOMETRY = Object.freeze({
  innerReach: 58, outerReach: 68, innerHalfSpan: 37, outerHalfSpan: 45, innerWidth: 3.2, outerWidth: 2,
});

export const WAKE_RENDER_GEOMETRY = Object.freeze({
  baseWidth: 64, maxExtraWidth: 28, widthGrowth: 0.15, opacityMultiplier: 1.1,
});

const drawBaseRipple = (context, image, position, timeMs, directionalActive) => {
  if (!position) return;
  const style = getCalmRippleStyle(timeMs, directionalActive);
  if (style.opacity <= 0) return;
  context.save();
  context.translate(position.x, position.y);
  context.rotate(style.rotation);
  drawTexture(context, image, -34 * style.scale, -34 * style.scale, 68 * style.scale, 68 * style.scale, style.opacity);
  context.rotate(style.outerRotation - style.rotation);
  drawTexture(context, image, -38 * style.outerScale, -38 * style.outerScale, 76 * style.outerScale, 76 * style.outerScale, style.outerOpacity);
  context.restore();
};

const drawCalmRipplePasses = (context, image, position, timeMs, calm) => {
  if (!position) return;
  getCalmRippleTexturePasses(timeMs, calm).forEach(({ size, opacity, rotation }) => {
    if (opacity <= 0) return;
    context.save();
    context.translate(position.x, position.y);
    context.rotate(rotation);
    const height = size * CALM_RIPPLE_TEXTURE_ANIMATION.verticalScale;
    drawTexture(context, image, -size / 2, -height / 2, size, height, opacity);
    context.restore();
  });
};

const drawBowWave = (context, image, active, fade) => {
  if (!active) return;
  // Compact disturbance at the head; the stationary trail carries the motion.
  drawTexture(context, image, -24, -18, 48, 36, 0.4 * fade);
};

const drawCoverImage = (context, image, width, height) => {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
};

// The location mask is an opaque RGB luminance PNG. Convert brightness to alpha once;
// destination-in would otherwise see its uniformly opaque source alpha on Android.
export const prepareHardWaterMask = (image, createCanvas = () => document.createElement('canvas')) => {
  if (!imageReady(image)) return null;
  const canvas = createCanvas();
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    pixels.data[index + 3] = Math.round(
      pixels.data[index] * 0.2126 + pixels.data[index + 1] * 0.7152 + pixels.data[index + 2] * 0.0722,
    );
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
};

export const drawFishingDirectionalFx = ({
  canvas, maskImage, textures = {}, sceneSize, origin, renderFishPosition, direction, fx, calm = true, trail = [], fishPhase, phaseProgress = 0,
  timeMs = performance.now(),
}) => {
  const context = canvas?.getContext?.('2d');
  if (!context) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const pixelWidth = Math.max(1, Math.round(sceneSize.width * ratio));
  const pixelHeight = Math.max(1, Math.round(sceneSize.height * ratio));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, sceneSize.width, sceneSize.height);

  // CALM is intentionally not an empty canvas: this follows persistent + surge + idle motion.
  drawBaseRipple(context, textures.ripple, renderFishPosition, timeMs, fx.active);
  drawCalmRipplePasses(context, textures.ripple, renderFishPosition, timeMs, calm && !fx.active);

  // Each wave remains where it was emitted, grows and fades independently.
  trail.forEach(point => {
    const age = Math.max(0, Math.min(1, (timeMs - point.born) / 650));
    const size = 25 + age * 48;
    drawTexture(context, textures.ripple, point.x - size / 2, point.y - size * 0.35,
      size, size * 0.7, (1 - age) * 0.2);
  });
  if (!fx.active && renderFishPosition && (fishPhase === 'SURGE_WARNING' || fishPhase === 'SURGE')) {
    const warning = fishPhase === 'SURGE_WARNING';
    const size = warning ? 65 + phaseProgress * 30 : 100 + phaseProgress * 45;
    drawTexture(context, textures.ripple, renderFishPosition.x - size / 2, renderFishPosition.y - size * 0.35,
      size, size * 0.7, warning ? 0.24 + phaseProgress * 0.15 : (1 - phaseProgress) * 0.55);
  }

  if (fx.wakeVisible) {
    const fade = Math.min(1, fx.wakeOpacity / 0.44);
    const head = { x: origin.x + fx.headX, y: origin.y + fx.headY };
    const wakeLength = Math.min(48, Math.max(20, fx.wakeLength));
    const wakeWidth = 26;
    context.save();
    context.translate(head.x, head.y);
    context.rotate(Math.atan2(direction.y, direction.x));
    drawTexture(context, textures.drag, -wakeLength * 0.9, -wakeWidth * 0.62, wakeLength * 1.05, wakeWidth * 1.24, fx.dragOpacity * 0.5);
    drawTexture(context, textures.wake, -wakeLength, -wakeWidth / 2, wakeLength + 10, wakeWidth,
      fx.wakeOpacity * 0.45);
    if (fx.streakVisible) {
      drawTexture(context, textures.streak, -Math.min(74, wakeLength * 0.85), -24, Math.min(92, wakeLength + 22), 48, fx.streakOpacity);
    }
    drawBowWave(context, textures.ripple, fx.active, fade);
    context.restore();
  }

  if (maskImage) {
    context.globalCompositeOperation = 'destination-in';
    drawCoverImage(context, maskImage, sceneSize.width, sceneSize.height);
    context.globalCompositeOperation = 'source-over';
  }
};

