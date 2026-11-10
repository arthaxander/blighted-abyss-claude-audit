import {
  GOBLIN_SUBLOCATION_IDS,
  GOBLIN_SUBLOCATIONS,
  applySublocationEnemyModifiers,
  getSublocationDefinition,
} from './expeditionSublocations';

describe('Goblin expedition sublocations', () => {
  test('defines four distinct themed choices with different cursed weights', () => {
    expect(GOBLIN_SUBLOCATIONS).toHaveLength(4);
    expect(new Set(GOBLIN_SUBLOCATIONS.map(entry => entry.id)).size).toBe(4);
    expect(getSublocationDefinition('Гоблинские Норы', GOBLIN_SUBLOCATION_IDS.RAT_RIDERS))
      .toMatchObject({ name: 'Крысиные проходы', cursedChance: 0.15 });
    expect(getSublocationDefinition('Гоблинские Норы', GOBLIN_SUBLOCATION_IDS.CURSED_RUBBLE))
      .toMatchObject({ name: 'Проклятые завалы', cursedChance: 0.4 });
  });

  test('Rat Riders speed rule gives rat enemies the larger bonus', () => {
    const [rat, goblin] = applySublocationEnemyModifiers(
      'Гоблинские Норы',
      GOBLIN_SUBLOCATION_IDS.RAT_RIDERS,
      [
        { name: 'Крысиный всадник', speed: 100 },
        { name: 'Гоблин-палач', speed: 100 },
      ]
    );
    expect(rat.speed).toBe(120);
    expect(goblin.speed).toBe(110);
  });
});
