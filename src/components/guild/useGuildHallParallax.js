import { useEffect, useRef } from 'react';
import { getClientPreferences, hasOrientationPermission, subscribeToClientPreferences } from '../../utils/clientPreferences';

export const MAX_PARALLAX_X = 7;
export const MAX_PARALLAX_Y = 5;
const MAX_TILT = 25;
const SMOOTHING = 0.16;
const NEUTRAL_TRANSFORM = 'translate3d(0px, 0px, 0) scale(1.04)';
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const telegramRadiansToDegrees = value => (Number(value) || 0) * (180 / Math.PI);

export const orientationToTranslation = (beta = 0, gamma = 0, angle = 0) => {
  const safeBeta = clamp(Number.isFinite(beta) ? beta : 0, -MAX_TILT, MAX_TILT);
  const safeGamma = clamp(Number.isFinite(gamma) ? gamma : 0, -MAX_TILT, MAX_TILT);
  const normalizedAngle = ((angle % 360) + 360) % 360;
  let horizontal = safeGamma;
  let vertical = safeBeta;
  if (normalizedAngle === 90) [horizontal, vertical] = [safeBeta, -safeGamma];
  else if (normalizedAngle === 270) [horizontal, vertical] = [-safeBeta, safeGamma];
  else if (normalizedAngle === 180) [horizontal, vertical] = [-safeGamma, -safeBeta];
  return {
    x: clamp((horizontal / MAX_TILT) * MAX_PARALLAX_X, -MAX_PARALLAX_X, MAX_PARALLAX_X),
    y: clamp((vertical / MAX_TILT) * MAX_PARALLAX_Y, -MAX_PARALLAX_Y, MAX_PARALLAX_Y),
  };
};

export const useGuildHallParallax = layerRef => {
  const frameRef = useRef(null);
  const currentRef = useRef({ x: 0, y: 0 });
  const baselineRef = useRef(null);
  useEffect(() => {
    const media = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : { matches: false, addEventListener: () => {}, removeEventListener: () => {} };
    let sourceCleanup = () => {};
    let generation = 0;
    const reset = () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      currentRef.current = { x: 0, y: 0 };
      baselineRef.current = null;
      if (layerRef.current) layerRef.current.style.transform = NEUTRAL_TRANSFORM;
    };
    const stop = () => { generation += 1; sourceCleanup(); sourceCleanup = () => {}; reset(); };
    const consume = (beta, gamma) => {
      const angle = window.screen?.orientation?.angle ?? window.orientation ?? 0;
      if (!baselineRef.current || baselineRef.current.angle !== angle) baselineRef.current = { beta, gamma, angle };
      const target = orientationToTranslation(beta - baselineRef.current.beta, gamma - baselineRef.current.gamma, angle);
      currentRef.current = {
        x: currentRef.current.x + (target.x - currentRef.current.x) * SMOOTHING,
        y: currentRef.current.y + (target.y - currentRef.current.y) * SMOOTHING,
      };
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        const { x, y } = currentRef.current;
        if (layerRef.current) layerRef.current.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(1.04)`;
      });
    };
    const startBrowser = expectedGeneration => {
      if (expectedGeneration !== generation) return;
      const OrientationEvent = window.DeviceOrientationEvent;
      const needsPermission = typeof OrientationEvent?.requestPermission === 'function';
      if (!OrientationEvent || (needsPermission && !hasOrientationPermission())) return;
      const onOrientation = event => consume(Number(event.beta) || 0, Number(event.gamma) || 0);
      window.addEventListener('deviceorientation', onOrientation, { passive: true });
      sourceCleanup = () => window.removeEventListener('deviceorientation', onOrientation);
    };
    const start = () => {
      stop();
      if (!getClientPreferences().depthEffectEnabled || media.matches || document.hidden) return;
      const expectedGeneration = generation;
      const webApp = window.Telegram?.WebApp;
      const nativeOrientation = webApp?.DeviceOrientation;
      if (!nativeOrientation || typeof nativeOrientation.start !== 'function' || typeof webApp.onEvent !== 'function') {
        startBrowser(expectedGeneration); return;
      }
      let nativeActive = true;
      let fellBack = false;
      const onNativeOrientation = event => {
        const values = event || nativeOrientation;
        consume(telegramRadiansToDegrees(values.beta), telegramRadiansToDegrees(values.gamma));
      };
      const fallback = () => {
        if (fellBack || expectedGeneration !== generation) return;
        fellBack = true;
        webApp.offEvent?.('deviceOrientationChanged', onNativeOrientation);
        webApp.offEvent?.('deviceOrientationFailed', fallback);
        nativeActive = false;
        try { nativeOrientation.stop?.(); } catch (_) { /* optional Telegram sensor */ }
        sourceCleanup = () => {};
        startBrowser(expectedGeneration);
      };
      webApp.onEvent('deviceOrientationChanged', onNativeOrientation);
      webApp.onEvent('deviceOrientationFailed', fallback);
      sourceCleanup = () => {
        webApp.offEvent?.('deviceOrientationChanged', onNativeOrientation);
        webApp.offEvent?.('deviceOrientationFailed', fallback);
        if (nativeActive) { try { nativeOrientation.stop?.(); } catch (_) { /* optional Telegram sensor */ } }
      };
      try {
        nativeOrientation.start({ refresh_rate: 50, need_absolute: false }, success => { if (success === false) fallback(); });
      } catch (_) { fallback(); }
    };
    const unsubscribe = subscribeToClientPreferences(start);
    document.addEventListener('visibilitychange', start);
    media.addEventListener?.('change', start);
    start();
    return () => { stop(); unsubscribe(); document.removeEventListener('visibilitychange', start); media.removeEventListener?.('change', start); };
  }, [layerRef]);
};
