import { createProductionFreshCharacter } from './characterFactory';
import { resolveSimulationPlayerProfile, SIMULATION_CONTROL_PROFILES } from './simulationPlayerProfiles';
import { getRelicBonuses } from '../data/relics';

describe('Combat Simulator v2 player profiles', () => {
  test.each(['Defender', 'Archer', 'Mage'])('%s progressed controls are legal and deterministic', classId => {
    ['established', 'prepared'].forEach(profile => {
      const first = resolveSimulationPlayerProfile({ classId, profile });
      expect(first).toEqual(resolveSimulationPlayerProfile({ classId, profile }));
      expect(first.snapshot).toMatchObject({ profileId: profile, classId, equipment: SIMULATION_CONTROL_PROFILES[classId][profile].equipment });
      expect(first.snapshot.classProgression.classLevel).toBe(profile === 'established' ? 4 : 9);
      expect(first.snapshot.passiveIds).toEqual(SIMULATION_CONTROL_PROFILES[classId][profile].passiveIds);
      expect(first.snapshot.inventoryLayout).toHaveProperty('safe');
      expect(first.snapshot.attainability).toContain('pre-boss');
      expect(first.snapshot.consumables).toEqual(SIMULATION_CONTROL_PROFILES[classId][profile].consumables);
    });
  });

  test('fresh is the default and production_fresh remains a compatibility alias', () => {
    expect(resolveSimulationPlayerProfile({ classId: 'Archer' }).snapshot.profileId).toBe('fresh');
    expect(resolveSimulationPlayerProfile({ classId: 'Archer', profile: 'production_fresh' }).snapshot).toEqual(resolveSimulationPlayerProfile({ classId: 'Archer', profile: 'fresh' }).snapshot);
  });
  test.each(['Defender', 'Archer', 'Mage'])('production_fresh %s uses the production constructor exactly once', classId => {
    const production = createProductionFreshCharacter({ classId });
    const resolved = resolveSimulationPlayerProfile({ classId });
    expect(resolved.player.baseStats).toEqual(production.baseStats);
    expect(resolved.player.equipment).toEqual(production.equipment);
    expect(resolved.player.maxHp).toBe(production.maxHp);
    expect(resolved.player.attack).toBe(production.attack);
    expect(resolved.player.relics).toEqual(production.relics);
    expect(resolved.snapshot.activeAbilityIds).toEqual(production.abilities.filter(ability => ability.name !== 'Атака').map(ability => ability.artId));
    expect(resolved.snapshot.consumables).toEqual([{ id: 'Малое зелье здоровья', quantity: 2 }]);
  });

  test('legal relic levels use canonical state and bonuses without double-applying stats', () => {
    const one = resolveSimulationPlayerProfile({ classId: 'Archer', relicLevel: 1 });
    const seven = resolveSimulationPlayerProfile({ classId: 'Archer', relicLevel: 7 });
    expect(one.snapshot.relic).toMatchObject({ id: 'recruit_seal', level: 1, xp: 0, bonuses: getRelicBonuses('recruit_seal', 1) });
    expect(seven.snapshot.relic.level).toBe(7);
    expect(seven.player.attack).toBe(one.player.attack); // combat initialization, not profile construction, applies the level-7 +5.
    expect(() => resolveSimulationPlayerProfile({ relicLevel: 16 })).toThrow(/0 to 15/);
  });

  test('custom stable-ID builds are exact and invalid builds fail loudly', () => {
    const custom = resolveSimulationPlayerProfile({ classId: 'Archer', build: 'scenario_a', activeIds: ['serrated_arrow', 'fire_arrow'] });
    expect(custom.snapshot.activeAbilityIds).toEqual(['serrated_arrow', 'fire_arrow']);
    expect(() => resolveSimulationPlayerProfile({ classId: 'Archer', build: 'bad', activeIds: ['fireball'] })).toThrow(/not unlocked/);
    expect(() => resolveSimulationPlayerProfile({ classId: 'Archer', build: 'bad', activeIds: ['missing'] })).toThrow(/Unknown stable ability/);
    expect(() => resolveSimulationPlayerProfile({ consumables: [{ id: 'Простая ткань', quantity: 1 }] })).toThrow(/combat consumable|combat-usable/);
  });
});
