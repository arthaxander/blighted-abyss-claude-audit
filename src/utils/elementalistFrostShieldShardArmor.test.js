import { createAbilityByName } from '../data/abilityPresets';
import { TALENT_BY_ID } from '../data/classTalents.mjs';
import { getEffectStackCount } from './effects';
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
  classProgression: talentId ? progression(talentId) : undefined,
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

const setup = talentId => {
  const foe = enemy();
  const session = initCombatSession(mage(talentId), [foe], { rng: () => 0.99 });
  const caster = session.state.players[0];
  const attacker = session.state.enemies[0];
  session.state.initiative.playerReady = true;
  caster.turnMeter = 1000;
  performPlayerAction(session, 'Морозный щит', 0);
  return { session, caster, attacker };
};

describe('Frost Shield Shard Armor talent', () => {
  test('adds one Ice Shard to an attacker when Frost Shield survives the direct hit', () => {
    const { session, caster, attacker } = setup('mage.frost_shield.shard_armor');

    expect(caster.shield).toBe(125);

    applyDamage(caster, 50, 'physical', {
      source: attacker,
      session,
      directAttack: true,
    });

    expect(caster.shield).toBe(75);
    expect(getEffectStackCount(attacker, 'ice_shards')).toBe(1);
    expect(attacker.effects.some(effect => effect.id === 'speed_penalty_minor')).toBe(true);
  });

  test('adds two Ice Shards instead when the direct hit destroys the Shield', () => {
    const { session, caster, attacker } = setup('mage.frost_shield.shard_armor');

    applyDamage(caster, 200, 'physical', {
      source: attacker,
      session,
      directAttack: true,
    });

    expect(caster.shield).toBe(0);
    expect(caster.hp).toBe(425);
    expect(getEffectStackCount(attacker, 'ice_shards')).toBe(2);
  });

  test('base Frost Shield keeps its retaliation without adding Ice Shards', () => {
    const { session, caster, attacker } = setup(null);

    applyDamage(caster, 50, 'physical', {
      source: attacker,
      session,
      directAttack: true,
    });

    expect(getEffectStackCount(attacker, 'ice_shards')).toBe(0);
    expect(attacker.effects.some(effect => effect.id === 'speed_penalty_minor')).toBe(true);
  });

  test('Shard Armor does not react to indirect damage', () => {
    const { session, caster, attacker } = setup('mage.frost_shield.shard_armor');

    applyDamage(caster, 50, 'physical', {
      source: attacker,
      session,
      directAttack: false,
      fromEffect: 'test_dot',
    });

    expect(getEffectStackCount(attacker, 'ice_shards')).toBe(0);
  });

  test('Shard Armor remains combat-ready', () => {
    expect(TALENT_BY_ID['mage.frost_shield.shard_armor']?.combatReady).toBe(true);
  });
});
