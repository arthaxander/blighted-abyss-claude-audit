import {
  ABYSS_POWER_DESCRIPTION,
  ABYSS_POWER_TUNING,
  applyAbyssPowerToEnemy,
  createAbyssPowerDescriptor,
} from './abyssPower';

describe('Abyss Power', () => {
  test('raises durability and offense without changing speed', () => {
    const enemy = applyAbyssPowerToEnemy({
      name: 'Гоблин-арбалетчик',
      hp: 48,
      maxHp: 48,
      attack: 7,
      magAtk: 2,
      physDef: 6,
      magicDef: 4,
      speed: 100,
    });

    expect(enemy).toMatchObject({
      hp: 60,
      maxHp: 60,
      attack: 8,
      baseAtk: 8,
      magAtk: 3,
      physDef: 7,
      magicDef: 5,
      speed: 100,
      abyssPowerApplied: true,
    });
  });

  test('descriptor explains the actual tuning used by Depth fights', () => {
    const descriptor = createAbyssPowerDescriptor();
    expect(descriptor.tuning).toBe(ABYSS_POWER_TUNING);
    expect(descriptor.description).toBe(ABYSS_POWER_DESCRIPTION);
    expect(descriptor.label).toBe('[Мощь Бездны]');
  });
});
