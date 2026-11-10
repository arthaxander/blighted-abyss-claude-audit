import React, { useEffect, useState } from 'react';
import { areImagesPreloaded, preloadImages } from '../data/combatAssets';
import './ArtLoadingOverlay.css';

// Wait only for the images used in the current scene. Never block a run
// indefinitely on one broken image or a weak mobile connection.
export const useArtLoadGate = (urls, timeoutMs = 2400) => {
  const signature = [...new Set((urls || []).filter(Boolean))].join('\n');
  const [settledKey, setSettledKey] = useState(null);
  const ready = !signature || settledKey === signature ||
    areImagesPreloaded(signature.split('\n'));

  useEffect(() => {
    if (!signature || areImagesPreloaded(signature.split('\n'))) return undefined;
    let cancelled = false;
    preloadImages(signature.split('\n'), timeoutMs).then(() => {
      if (!cancelled) setSettledKey(signature);
    });
    return () => { cancelled = true; };
  }, [signature, timeoutMs]);

  return ready;
};

export default function ArtLoadingOverlay({ visible, label = 'Подготавливаем изображения…', progress = null, onContinue = null }) {
  if (!visible) return null;
  return <div className="art-loading-overlay" role="status" aria-live="polite" aria-label={label}>
    <div className="art-loading-overlay__content">
      <span className="art-loading-overlay__sigil" aria-hidden="true">✦</span>
      <span>{label}</span>
      {progress?.total ? <span className="art-loading-overlay__progress" aria-hidden="true">{progress.completed} / {progress.total}</span> : null}
      {onContinue ? <button type="button" className="art-loading-overlay__continue" onClick={onContinue}>Продолжить без ожидания</button> : null}
    </div>
  </div>;
}
