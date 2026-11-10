import {
  createGoblinNestsEncounter, createMushroomCavesEncounter, createDeserterCampEncounter,
  createWitheringForestEncounter, createRestlessRuinsEncounter, createMinesOfDecayEncounter,
  createEncounterPair, applyDeserterAlertModifier, isCursedRoomEnemy,
  GOBLIN_LOCATION, FUNGAL_LOCATION, DESERTER_LOCATION, WITHERING_FOREST_LOCATION, RESTLESS_RUINS_LOCATION,
} from './enemyPools';
import { isStrongEnemy } from './levelOneProgression';
import { LEVEL_TWO_LOOT_LOCATIONS } from '../data/levelTwoLootOwnership';

const generators = {
  [GOBLIN_LOCATION]: createGoblinNestsEncounter,
  [FUNGAL_LOCATION]: createMushroomCavesEncounter,
  [DESERTER_LOCATION]: createDeserterCampEncounter,
  [WITHERING_FOREST_LOCATION]: createWitheringForestEncounter,
  [RESTLESS_RUINS_LOCATION]: createRestlessRuinsEncounter,
  [LEVEL_TWO_LOOT_LOCATIONS.MINES_OF_DECAY]: createMinesOfDecayEncounter,
};
export const createTrapAmbush = (enemies, location, completedCombatRooms = 0, rng = Math.random) => {
  const pool = enemies.filter(enemy => enemy && enemy.location === location && !enemy.boss
    && !enemy.summonOnly && !isCursedRoomEnemy(enemy) && !isStrongEnemy(enemy));
  let encounter = generators[location]?.(pool, rng, { completedCombatRooms, requireStrong: false })
    || { enemies: createEncounterPair(pool, rng, { location }) };
  if (location === DESERTER_LOCATION) {
    encounter = applyDeserterAlertModifier({ ...encounter, pool, completedCombatRooms, rng });
  }
  const roster = encounter.enemies || [];
  const removeIndex = Math.min(roster.length - 1, Math.floor(rng() * roster.length));
  return roster.filter((_, index) => roster.length === 1 || index !== removeIndex).map(enemy => ({
    ...enemy,
    // Initiative applies this once after location start effects (1000 = full meter).
    startingTurnMeterBonus: (Number(enemy.startingTurnMeterBonus) || 0) + 400,
    _startingTurnMeterApplied: false,
  }));
};
export const getTrapMetal = (location, abyssLevel = 1) =>
  Number(abyssLevel) >= 2 || Object.values(LEVEL_TWO_LOOT_LOCATIONS).includes(location)
    ? 'Сумрачный сплав' : 'Металлические обломки';
