import { createAbilityByName } from '../data/abilityPresets';
import { TALENT_BY_ID } from '../data/classTalents.mjs';
import { addEffect, getEffectStackCount } from './effects';
import { applyDamage, initCombatSession, performPlayerAction } from './combatUtils';

const progression = talentId => ({ Mage: { talentSelections: { 'mage.summon_elemental': talentId } } });

const mage = talentId => ({
  id: 'hero',
  name: 'Элементалист',
  class: 'Mage',
  displayClass: 'Элементалист',
  hp: 200,
  maxHp: 200,
  attack: 40,
  magAtk: 100,
  physDef: 30,
  magicDef: 50,
  speed: 120,
  critChance: 0,
  effects: [],
  abilities: [createAbilityByName('Призыв элементаля')],
  equippedClassPassiveIds: [],
  classProgression: progression(talentId),
  shield: 0,
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

const summonIce = () => {
  const session = initCombatSession(
    mage('mage.summon_elemental.ice'),
    [enemy('a'), enemy('b')],
    { rng: () => 0.99 }
  );
  const owner = session.state.players[0];
  session.state.initiative.playerReady = true;
  owner.turnMeter = 1000;
  performPlayerAction(session, 'Призыв элементаля', 0);
  return { session, owner, ally: session.state.players[1] };
};

describe('Ice Elemental talent', () => {
  test('summons the defensive Ice Elemental statline at 50% turn meter', () => {
    const { ally } = summonIce();

    expect(ally).toMatchObject({
      name: 'Ледяной элементаль',
      summonKind: 'ice_elemental',
      summonVariant: 'ice',
      elementalistElemental: true,
      maxHp: 140,
      hp: 140,
      attack: 8,
      magAtk: 55,
      physDef: 24,
      magicDef: 40,
      speed: 90,
      turnMeter: 500,
    });
  });

  test('Ice Bolt deals 70% MagAtk and adds one Ice Shard after a successful hit', () => {
    const { ally, session } = summonIce();
    const ability = ally.abilities.find(entry => entry.name === 'Ледяной снаряд');
    const target = session.state.enemies[0];

    expect(ability.basic).toBe(true);
    expect(ability.damage({ attacker: ally })).toBe(39);

    ability.allyAfterDirectDamage({
      attacker: ally,
      target,
      session,
      log: jest.fn(),
      deliberateAction: { successfulDirectHit: true },
    });

    expect(getEffectStackCount(target, 'ice_shards')).toBe(1);
  });

  test('Frost Grasp deals 90% MagAtk and applies Strong Slow for 2 turns', () => {
    const { ally, session } = summonIce();
    const ability = ally.abilities.find(entry => entry.name === 'Морозная хватка');
    const target = session.state.enemies[0];

    expect(ability.cooldown).toBe(3);
    expect(ability.damage({ attacker: ally })).toBe(50);

    ability.allyAfterDirectDamage({
      attacker: ally,
      target,
      session,
      log: jest.fn(),
      deliberateAction: { successfulDirectHit: true },
    });

    expect(target.effects.find(effect => effect.id === 'speed_penalty_major'))
      .toMatchObject({ remainingTurns: 2 });
    expect(target.effects.some(effect => effect.id === 'freeze')).toBe(false);
  });

  test('Frost Grasp freezes an already slowed target for 1 turn', () => {
    const { ally, session } = summonIce();
    const ability = ally.abilities.find(entry => entry.name === 'Морозная хватка');
    const target = session.state.enemies[0];
    addEffect(target, { id: 'speed_penalty_minor', duration: 2 }, jest.fn(), ally, { session });

    ability.allyAfterDirectDamage({
      attacker: ally,
      target,
      session,
      log: jest.fn(),
      deliberateAction: { successfulDirectHit: true },
    });

    expect(target.effects.find(effect => effect.id === 'freeze'))
      .toMatchObject({ remainingTurns: 1 });
  });

  test('Frost Grasp converts blocked Freeze into one Ice Shard', () => {
    const { ally, session } = summonIce();
    const ability = ally.abilities.find(entry => entry.name === 'Морозная хватка');
    const target = session.state.enemies[0];
    addEffect(target, { id: 'speed_penalty_minor', duration: 2 }, jest.fn(), ally, { session });
    target.controlImmune = true;

    ability.allyAfterDirectDamage({
      attacker: ally,
      target,
      session,
      log: jest.fn(),
      deliberateAction: { successfulDirectHit: true },
    });

    expect(target.effects.some(effect => effect.id === 'freeze')).toBe(false);
    expect(getEffectStackCount(target, 'ice_shards')).toBe(1);
  });

  test('Frozen Legacy grants owner a 20% max-HP Shield for 2 turns exactly once on death', () => {
    const { ally, owner, session } = summonIce();

    applyDamage(ally, 9999, 'pure', {
      source: session.state.enemies[0],
      session,
      bypassShield: true,
    });

    expect(ally.hp).toBe(0);
    expect(owner.shield).toBe(40);
    expect(owner.effects.find(effect => effect.id === 'shield'))
      .toMatchObject({ remainingTurns: 2 });

    applyDamage(ally, 9999, 'pure', {
      source: session.state.enemies[0],
      session,
      bypassShield: true,
    });
    expect(owner.shield).toBe(40);
  });

  test('summon template preserves the Ice Elemental ability presets', () => {
    const { ally } = summonIce();

    expect(ally._summonTemplate?.abilityNames).toEqual([
      'Ледяной снаряд',
      'Морозная хватка',
      'Ледяное наследие',
    ]);
  });

  test('Ice is combat-ready and completes the summon talent set', () => {
    expect(TALENT_BY_ID['mage.summon_elemental.greater_fire']?.combatReady).toBe(true);
    expect(TALENT_BY_ID['mage.summon_elemental.lightning']?.combatReady).toBe(true);
    expect(TALENT_BY_ID['mage.summon_elemental.ice']?.combatReady).toBe(true);
  });
});
