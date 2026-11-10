import React from 'react';
import { getPendingLootArtUrls } from '../utils/lootArtPreload';
import ArtLoadingOverlay, { useArtLoadGate } from './ArtLoadingOverlay';

// The reward list is small, but image files can be large. Keep the reward
// screen out of view until this specific drop's icons have been decoded.
// If a request fails, allow the player through after the bounded timeout.
export default function LootArtworkGate({ pendingLoot, children }) {
  const art = getPendingLootArtUrls(pendingLoot);
  const ready = useArtLoadGate(art, 3600);
  return ready ? children : <ArtLoadingOverlay visible label="Подготавливаем добычу…" />;
}
