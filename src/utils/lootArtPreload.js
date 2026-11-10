import { findItemData } from '../data/items';
import { resolveItemArt } from '../data/itemArt';
import { preloadImages } from '../data/combatAssets';

// Resolve exactly the same item definitions as PendingLootContent. Neither
// neighboring location art nor the entire Guild inventory needs to be fetched.
export const getPendingLootArtUrls = pendingLoot => [...new Set(
  (pendingLoot?.items || [])
    .map(item => resolveItemArt(findItemData(item?.itemId) || item))
    .filter(Boolean)
)];

export const warmPendingLootArt = pendingLoot =>
  preloadImages(getPendingLootArtUrls(pendingLoot), 3600);
