export const LEVEL_ONE_TUNINGS = Object.freeze({
  production_7_14: Object.freeze({
    id: 'production_7_14', strongEnemyUnlock: 7, bossUnlock: 14,
    cursedEncounterUnlock: 5, cursedChoiceWindowUnlock: 4,
    roomPhaseMid: 5, roomPhaseLate: 10,
  }),
  legacy_5_10: Object.freeze({
    id: 'legacy_5_10', strongEnemyUnlock: 5, bossUnlock: 10,
    cursedEncounterUnlock: 5, cursedChoiceWindowUnlock: 4,
    roomPhaseMid: 5, roomPhaseLate: 10,
  }),
});

export const PRODUCTION_LEVEL_ONE_TUNING = LEVEL_ONE_TUNINGS.production_7_14;

export const resolveSimulationTuning = (id = PRODUCTION_LEVEL_ONE_TUNING.id) => {
  const tuning = LEVEL_ONE_TUNINGS[id];
  if (!tuning) throw new Error(`Unknown simulation tuning: ${id}`);
  return tuning;
};

// Authored progression marker authority. Names and translations are deliberately irrelevant.
export const isStrongEnemy = enemy => enemy?.encounterPhase === 'late';
export const isStrongPoolAvailable = (completedCombatRooms, tuning = PRODUCTION_LEVEL_ONE_TUNING) =>
  Number(completedCombatRooms) >= tuning.strongEnemyUnlock;
