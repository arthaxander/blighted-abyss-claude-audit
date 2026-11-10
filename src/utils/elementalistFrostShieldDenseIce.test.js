import { createAbilityByName } from '../data/abilityPresets';
import { TALENT_BY_ID } from '../data/classTalents.mjs';
import { addEffect } from './effects';
import { applyDamage, initCombatSession, performPlayerAction } from './combatUtils';

const progression = talentId => ({ Mage: { talentSelections: { 'mage.frost_shield': talentId } } });

const mage = talentId => ({
  id: 'hero',
  name: 'Элементалист',
  class: 'Mage',
  displayClass: 'Элементалист',
  hp: 500,
  maxHp: 500,
  attack: 20,
  magAtk: 100,
  physDef: 0,
  magicDef: 0,
  speed: 120,
  critChance: 0,
  effects: [],
  shield: 0,
  abilities: [createAbilityByName('Морозный щит')],
  equippedClassPassiveIds: [],
  classProgression: progression(talentId),
});

const enemy = () => ({
  id: 'enemy',
  name: 'Враг',
  hp: 1000,
  maxHp: 1000,
  attack: 100,
  magAtk: 0,
  physDef: 0,
  magicDef: 0,
  speed: 1,
  critChance: 0,
  effects: [],
  shield: 0,
  abilities: [],
});

const setup = ({ extraShield = 0 } = {}) => {
  const session = initCombatSession(
    mage('mage.frost_shield.dense_ice'),
    [enemy()],
    { rng: () => 0.99 }
  );
  const caster = session.state.players[0];
  const attacker = session.state.enemies[0];

  if (extraShield > 0) {
    addEffect(
      caster,
      { id: 'shield', duration: 3, value: extraShield },
      jest.fn(),
      caster,
      { session, forceIndependentInstance: true }
    );
  }

  session.state.initiative.playerReady = true;
  caster.turnMeter = 1000;
  performPlayerAction(session, 'Морозный щит', 0);
  return { session, caster, attacker };
};

describe('Frost Shield Dense Ice talent', () => {
  test('reduces direct durability loss of Frost Shield by 25%', () => {
    const { session, caster, attacker } = setup();

    expect(caster.shield).toBe(125);

    applyDamage(caster, 100, 'physical', {
      source: attacker,
      session,
      directAttack: true,
    });

    expect(caster.hp).toBe(500);
    expect(caster.shield).toBe(50);
    expect(caster.lastShieldDamage).toBe(75);
  });

  test('does not reduce same-hit HP overflow when the hit exceeds the original Shield stock', () => {
    const { session, caster, attacker } = setup();

    applyDamage(caster, 200, 'physical', {
      source: attacker,
      session,
      directAttack: true,
    });

    expect(caster.hp).toBe(425);
    expect(caster.shield).toBe(31);
    expect(caster.lastShieldDamage).toBe(94);
  });

  test('does not reduce indirect damage to Frost Shield', () => {
    const { session, caster, attacker } = setup();

    applyDamage(caster, 100, 'physical', {
      source: attacker,
      session,
      directAttack: false,
      fromEffect: 'test_periodic',
    });

    expect(caster.hp).toBe(500);
    expect(caster.shield).toBe(25);
    expect(caster.lastShieldDamage).toBe(100);
  });

  test('protects only Frost Shield stock when another Shield is also active', () => {
    const { session, caster, attacker } = setup({ extraShield: 40 });
    const frostEffect = caster.effects.find(effect => effect.id === 'shield' && effect.extra?.frostRetaliation);
    const normalEffect = caster.effects.find(effect => effect.id === 'shield' && !effect.extra?.frostRetaliation);

    expect(caster.shield).toBe(165);
    expect(normalEffect?.appliedShield).toBe(40);
    expect(frostEffect?.appliedShield).toBe(125);

    applyDamage(caster, 100, 'physical', {
      source: attacker,
      session,
      directAttack: true,
    });

    expect(normalEffect?.appliedShield).toBe(0);
    expect(frostEffect?.appliedShield).toBe(80);
    expect(caster.shield).toBe(80);
  });

  test('Dense Ice is combat-ready', () => {
    expect(TALENT_BY_ID['mage.frost_shield.dense_ice']?.combatReady).toBe(true);
  });
});
