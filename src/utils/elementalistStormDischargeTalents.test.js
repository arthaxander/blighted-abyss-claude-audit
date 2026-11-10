import { createAbilityByName } from '../data/abilityPresets';
import { TALENT_BY_ID } from '../data/classTalents.mjs';
import { addEffect, getEffectStackCount } from './effects';
import { initCombatSession, performPlayerAction } from './combatUtils';

const progression = talentId => ({ Mage: { talentSelections: { 'mage.thunder_discharge': talentId } } });

const mage = talentId => ({
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
  abilities: [createAbilityByName('Грозовой разряд')],
  equippedClassPassiveIds: [],
  classProgression: progression(talentId),
});

const enemy = (extra = {}) => ({
  id: 'enemy',
  name: 'Цель',
  hp: 1000,
  maxHp: 1000,
  attack: 1,
  magAtk: 0,
  physDef: 0,
  magicDef: 0,
  speed: 1,
  turnMeter: 500,
  critChance: 0,
  effects: [],
  abilities: [],
  ...extra,
});

const setup = (talentId, target = enemy(), rng = () => 0.99) => {
  const session = initCombatSession(mage(talentId), [target], { rng });
  const caster = session.state.players[0];
  const foe = session.state.enemies[0];
  session.state.initiative.playerReady = true;
  caster.turnMeter = 1000;
  foe.turnMeter = 500;
  return { session, caster, foe };
};

const cast = state => {
  performPlayerAction(state.session, 'Грозовой разряд', 0);
  return state;
};

describe('Elementalist Storm Discharge talents', () => {
  test('Conductor applies Conductivity before damage without enabling its own 180% condition', () => {
    const state = setup('mage.thunder_discharge.conductor');

    cast(state);

    expect(state.foe.hp).toBe(825); // 140 direct + 35 Conductivity.
    expect(state.foe.turnMeter).toBe(500);
    expect(state.foe.effects.find(effect => effect.id === 'conductivity'))
      .toMatchObject({ remainingTurns: 2 });
  });

  test('Conductor preserves the empowered hit when the target was already prepared', () => {
    const state = setup('mage.thunder_discharge.conductor');
    addEffect(state.foe, { id: 'charge' }, jest.fn(), state.caster, { session: state.session });

    cast(state);

    expect(state.foe.hp).toBe(775); // 180 direct + 45 Conductivity.
    expect(state.foe.turnMeter).toBe(300);
  });

  test('Overload uses 120% MagAtk when its added Charge completes the trio', () => {
    const state = setup('mage.thunder_discharge.overload');
    addEffect(state.foe, { id: 'charge' }, jest.fn(), state.caster, { session: state.session });
    addEffect(state.foe, { id: 'charge' }, jest.fn(), state.caster, { session: state.session });

    cast(state);

    expect(state.foe.hp).toBe(700); // 180 direct + 120 empowered Charge discharge.
    expect(getEffectStackCount(state.foe, 'charge')).toBe(0);
    expect(state.foe.effects.some(effect => effect.id === 'shock')).toBe(true);
  });

  test('Overload only adds one Charge when it does not complete the trio', () => {
    const state = setup('mage.thunder_discharge.overload');
    addEffect(state.foe, { id: 'charge' }, jest.fn(), state.caster, { session: state.session });

    cast(state);

    expect(state.foe.hp).toBe(820);
    expect(getEffectStackCount(state.foe, 'charge')).toBe(2);
  });

  test('ordinary Charge discharge remains at 80% MagAtk', () => {
    const state = setup(null);
    addEffect(state.foe, { id: 'charge' }, jest.fn(), state.caster, { session: state.session });
    addEffect(state.foe, { id: 'charge' }, jest.fn(), state.caster, { session: state.session });
    addEffect(state.foe, { id: 'charge' }, jest.fn(), state.caster, { session: state.session });

    expect(state.foe.hp).toBe(920);
    expect(getEffectStackCount(state.foe, 'charge')).toBe(0);
  });

  test.each([
    'mage.thunder_discharge.conductor',
    'mage.thunder_discharge.overload',
  ])('%s does not apply its pre/post-hit talent effect on a miss', talentId => {
    const state = setup(talentId, enemy({ statAdditives: { dodgeBonus: 1 } }));

    cast(state);

    expect(state.foe.hp).toBe(1000);
    expect(state.foe.effects.some(effect => effect.id === 'conductivity')).toBe(false);
    expect(getEffectStackCount(state.foe, 'charge')).toBe(0);
  });

  test('both Storm Discharge talents are combat-ready', () => {
    expect(TALENT_BY_ID['mage.thunder_discharge.overload']?.combatReady).toBe(true);
    expect(TALENT_BY_ID['mage.thunder_discharge.conductor']?.combatReady).toBe(true);
  });
});
