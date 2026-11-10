import { createAbilityByName } from '../data/abilityPresets';
import { TALENT_BY_ID } from '../data/classTalents.mjs';
import { getEffectStackCount } from './effects';
import { initCombatSession, performPlayerAction } from './combatUtils';

const progression = talentId => ({ Mage: { talentSelections: { 'mage.elemental_echo': talentId } } });

const mage = (talentId, school, extra = {}) => ({
  id: 'hero',
  name: 'Элементалист',
  class: 'Mage',
  displayClass: 'Элементалист',
  hp: 200,
  maxHp: 200,
  attack: 8,
  magAtk: 100,
  physDef: 0,
  magicDef: 0,
  speed: 125,
  critChance: 0,
  effects: [],
  abilities: [createAbilityByName('Стихийное эхо')],
  equippedClassPassiveIds: [],
  classProgression: progression(talentId),
  _lastElementalSchool: school,
  ...extra,
});

const enemy = id => ({
  id,
  name: id,
  hp: 1000,
  maxHp: 1000,
  attack: 1,
  magAtk: 0,
  physDef: 0,
  magicDef: 0,
  speed: 1,
  critChance: 0,
  effects: [],
  abilities: [],
});

const cast = (talentId, school, count = 3, extraPlayer = {}) => {
  const session = initCombatSession(
    mage(talentId, school, extraPlayer),
    Array.from({ length: count }, (_, index) => enemy(String(index + 1))),
    { rng: () => 0.99 }
  );
  const caster = session.state.players[0];
  caster._lastElementalSchool = school;
  session.state.initiative.playerReady = true;
  caster.turnMeter = 1000;
  performPlayerAction(session, 'Стихийное эхо', 0);
  return session;
};

describe('Elementalist Elemental Echo talents', () => {
  test.each([
    ['fire', 'burn'],
    ['ice', 'freeze'],
    ['lightning', 'shock'],
  ])('Echo Roll deals 50%% same-school damage to other enemies for %s without copying the main status', (school, mainStatus) => {
    const session = cast('mage.elemental_echo.echo_roll', school);
    const [primary, second, third] = session.state.enemies;

    expect(primary.hp).toBe(870);
    expect(second.hp).toBe(950);
    expect(third.hp).toBe(950);
    expect(primary.effects.some(effect => effect.id === mainStatus)).toBe(true);
    expect(second.effects.some(effect => effect.id === mainStatus)).toBe(false);
    expect(third.effects.some(effect => effect.id === mainStatus)).toBe(false);
  });

  test('Echo Roll secondary hits do not become extra Elemental Resonance targets', () => {
    const session = cast('mage.elemental_echo.echo_roll', 'fire', 3, {
      equippedClassPassiveIds: ['elemental_resonance'],
    });
    const [primary, second, third] = session.state.enemies;

    expect(getEffectStackCount(primary, 'charring')).toBe(1);
    expect(getEffectStackCount(second, 'charring')).toBe(0);
    expect(getEffectStackCount(third, 'charring')).toBe(0);
  });

  test.each([
    ['fire', 'charring'],
    ['ice', 'ice_shards'],
    ['lightning', 'charge'],
  ])('Saturated Echo adds two %s resource effects to the primary target', (school, resourceId) => {
    const session = cast('mage.elemental_echo.saturated_echo', school, 1);
    const target = session.state.enemies[0];

    expect(target.hp).toBe(870);
    expect(getEffectStackCount(target, resourceId)).toBe(2);
  });

  test('Echo talents do nothing when the primary hit misses', () => {
    const session = initCombatSession(
      mage('mage.elemental_echo.echo_roll', 'fire'),
      [{ ...enemy('primary'), statAdditives: { dodgeBonus: 1 } }, enemy('secondary')],
      { rng: () => 0.99 }
    );
    const caster = session.state.players[0];
    caster._lastElementalSchool = 'fire';
    session.state.initiative.playerReady = true;
    caster.turnMeter = 1000;

    performPlayerAction(session, 'Стихийное эхо', 0);

    expect(session.state.enemies.map(target => target.hp)).toEqual([1000, 1000]);
  });

  test('both Elemental Echo talents are combat-ready', () => {
    expect(TALENT_BY_ID['mage.elemental_echo.echo_roll']?.combatReady).toBe(true);
    expect(TALENT_BY_ID['mage.elemental_echo.saturated_echo']?.combatReady).toBe(true);
  });
});
