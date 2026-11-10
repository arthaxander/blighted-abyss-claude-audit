import { AVAILABLE_LOCATIONS, LEVEL_TWO_LOCATIONS } from '../data/locations';

const locations = [...AVAILABLE_LOCATIONS, ...LEVEL_TWO_LOCATIONS];
export const getAutobattleLocationId = location => locations.find(entry => entry.id === location || entry.name === location)?.id || null;
export const normalizeBossClears = clears => Array.isArray(clears)
  ? [...new Set(clears.map(getAutobattleLocationId).filter(Boolean))]
  : [];
export const recordBossClear = (clears, location) => normalizeBossClears([...normalizeBossClears(clears), location]);
export const isAutobattleUnlocked = (clears, location) => {
  const id = getAutobattleLocationId(location);
  return Boolean(id && normalizeBossClears(clears).includes(id));
};

// Legacy saves have no lifetime boss history. Only migrate an unambiguous,
// currently completed boss encounter; reaching a floor is not proof for a location.
export const hydrateBossClears = save => {
  const clears = normalizeBossClears(save?.clearedBossLocations);
  const player = save?.player;
  return player?.expeditionPhase === 'boss-defeated'
    ? recordBossClear(clears, player.currentLocation)
    : clears;
};
