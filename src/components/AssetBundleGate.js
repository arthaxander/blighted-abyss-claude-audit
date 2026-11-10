import React, { useEffect, useState } from 'react';
import { preloadImage, areImagesPreloaded } from '../data/combatAssets';
import { getImageBundle } from '../data/imageBundles';
import ArtLoadingOverlay from './ArtLoadingOverlay';

// Browser cache and our per-session preload cache are shared between locations.
// One failed asset must not trigger a 20-second loading screen on every return.
const CONCURRENT_IMAGES = 6;
const PER_IMAGE_TIMEOUT_MS = 9000;
const MAX_WAIT_MS = 20000;
const SKIP_AVAILABLE_MS = 8000;
const settledBundles = new Set();

export default function AssetBundleGate({ bundleId, children }) {
  const urls = getImageBundle(bundleId);
  const alreadyReady = settledBundles.has(bundleId) || areImagesPreloaded(urls);
  const [state, setState] = useState(() => ({
    bundleId, done: alreadyReady, completed: alreadyReady ? urls.length : 0,
    total: urls.length, canSkip: false,
  }));

  useEffect(() => {
    if (alreadyReady) {
      setState({ bundleId, done: true, completed: urls.length, total: urls.length, canSkip: false });
      return undefined;
    }
    let cancelled = false;
    let cursor = 0;
    let completed = 0;
    setState({ bundleId, done: false, completed: 0, total: urls.length, canSkip: false });

    const onComplete = () => {
      if (cancelled) return;
      completed += 1;
      setState(current => current.bundleId === bundleId
        ? { ...current, completed }
        : current);
    };
    const worker = async () => {
      while (!cancelled && cursor < urls.length) {
        const url = urls[cursor++];
        try { await preloadImage(url, PER_IMAGE_TIMEOUT_MS); }
        catch { /* A broken asset should not prevent entry into the game. */ }
        onComplete();
      }
    };

    const skipTimer = setTimeout(() => {
      if (!cancelled) setState(current => ({ ...current, canSkip: true }));
    }, SKIP_AVAILABLE_MS);
    const finish = () => {
      if (cancelled) return;
      settledBundles.add(bundleId);
      setState(current => current.bundleId === bundleId ? { ...current, done: true } : current);
    };
    const maxTimer = setTimeout(finish, MAX_WAIT_MS);
    Promise.all(Array.from({ length: Math.min(CONCURRENT_IMAGES, urls.length) }, worker))
      .then(finish);
    return () => {
      cancelled = true;
      clearTimeout(skipTimer);
      clearTimeout(maxTimer);
    };
  }, [bundleId, urls, alreadyReady]); // URL arrays are static per bundle.

  const done = state.bundleId === bundleId && (state.done || alreadyReady);
  const progress = state.bundleId === bundleId ? state : { completed: 0, total: urls.length };
  return <>
    {done ? children : null}
    <ArtLoadingOverlay
      visible={!done}
      label={bundleId === 'guild' ? 'Подготавливаем Гильдию…' : 'Подготавливаем локацию Бездны…'}
      progress={progress}
      onContinue={state.canSkip ? () => {
        settledBundles.add(bundleId);
        setState(current => ({ ...current, done: true }));
      } : null}
    />
  </>;
}
