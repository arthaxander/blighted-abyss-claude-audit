import { reviveAbility } from '../components/CombatScreen';
import { ABILITY_LIBRARY, createAbilityByName } from '../data/abilityPresets';
import { buildPlayerSnapshot, hydratePlayerSnapshot } from './playerState';

describe('runtime ability preset identity', () => {
  test('keeps Defender Iron Counter distinct from the enemy counter preset', () => {
    const defenderCounter = createAbilityByName('Железный контрудар');
    const enemyCounter = createAbilityByName('Контратака');

    expect(defenderCounter).toMatchObject({
      presetKey: 'Железный контрудар',
      name: 'Контратака',
      classTags: ['defender'],
      abilityRole: 'counter',
    });
    expect(defenderCounter.apply).toBe(ABILITY_LIBRARY['Железный контрудар'].apply);

    expect(enemyCounter).toMatchObject({
      presetKey: 'Контратака',
      name: 'Контратака',
    });
    expect(enemyCounter.classTags).toBeUndefined();
    expect(enemyCounter.apply).toBe(ABILITY_LIBRARY['Контратака'].apply);
    expect(enemyCounter.apply).not.toBe(defenderCounter.apply);
  });

  test('revives serialized abilities by presetKey while supporting legacy name-only data', () => {
    const serialized = JSON.parse(JSON.stringify(createAbilityByName('Железный контрудар')));
    expect(serialized).toMatchObject({
      presetKey: 'Железный контрудар',
      name: 'Контратака',
    });

    const revived = reviveAbility(serialized);
    expect(revived.presetKey).toBe('Железный контрудар');
    expect(revived.name).toBe('Контратака');
    expect(revived.apply).toBe(ABILITY_LIBRARY['Железный контрудар'].apply);
    expect(revived.apply).not.toBe(ABILITY_LIBRARY['Контратака'].apply);

    const legacy = reviveAbility({ name: 'Огненный шар', currentCooldown: 1 });
    expect(legacy.presetKey).toBe('Огненный шар');
    expect(legacy.currentCooldown).toBe(1);
    expect(legacy.damage).toBe(ABILITY_LIBRARY['Огненный шар'].damage);
  });

  test('uses presetKey for player snapshots and still hydrates legacy abilityNames', () => {
    const player = {
      name: 'Защитник',
      class: 'defender',
      attack: 10,
      baseAtk: 10,
      abilities: [createAbilityByName('Железный контрудар')],
      inventory: [],
      equipment: {},
    };

    const snapshot = buildPlayerSnapshot(player);
    expect(snapshot.abilityNames).toEqual(['Железный контрудар']);

    const hydrated = hydratePlayerSnapshot(snapshot);
    expect(hydrated.abilityNames).toEqual(['Железный контрудар']);
    expect(hydrated.abilities[0]).toMatchObject({
      presetKey: 'Железный контрудар',
      name: 'Контратака',
    });
    expect(hydrated.abilities[0].apply).toBe(ABILITY_LIBRARY['Железный контрудар'].apply);

    const legacyHydrated = hydratePlayerSnapshot({
      ...snapshot,
      abilityNames: ['Огненный шар'],
    });
    expect(legacyHydrated.abilities[0].presetKey).toBe('Огненный шар');
    expect(legacyHydrated.abilities[0].damage).toBe(ABILITY_LIBRARY['Огненный шар'].damage);
  });

  test('preserves an unknown requested key on the existing generic fallback', () => {
    const fallback = createAbilityByName('Несуществующая способность', 17);
    expect(fallback).toEqual({
      presetKey: 'Несуществующая способность',
      name: 'Несуществующая способность',
      damage: 17,
      cooldown: 0,
      type: 'physical',
    });
  });
});
