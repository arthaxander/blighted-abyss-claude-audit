import { createAbilityByName } from '../data/abilityPresets';
import { TALENT_BY_ID } from '../data/classTalents.mjs';
import { getEffectStackCount } from './effects';
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

const summonLightning = () => {
  const session = initCombatSession(
    mage('mage.summon_elemental.lightning'),
    [enemy('a'), enemy('b')],
    { rng: () => 0.99 }
  );
  const owner = session.state.players[0];
  session.state.initiative.playerReady = true;
  owner.turnMeter = 1000;
  performPlayerAction(session, 'Призыв элементаля', 0);
  return { session, owner, ally: session.state.players[1] };
};

describe('Lightning Elemental talent', () => {
  test('summons the agreed Lightning Elemental statline at 50% turn meter', () => {
    const { ally } = summonLightning();

    expect(ally).toMatchObject({
      name: 'Молниевый элементаль',
      summonKind: 'lightning_elemental',
      summonVariant: 'lightning',
      elementalistElemental: true,
      maxHp: 100,
      hp: 100,
      attack: 8,
      magAtk: 65,
      physDef: 15,
      magicDef: 30,
      speed: 126,
      turnMeter: 500,
    });
  });

  test('basic Discharge deals 80% MagAtk and adds one Charge after a successful hit', () => {
    const { ally, session } = summonLightning();
    const ability = ally.abilities.find(entry => entry.name === 'Разряд');
    const target = session.state.enemies[0];

    expect(ability.basic).toBe(true);
    expect(ability.damage({ attacker: ally })).toBe(52);

    ability.allyAfterDirectDamage({
      attacker: ally,
      target,
      session,
      log: jest.fn(),
      deliberateAction: { successfulDirectHit: true },
    });

    expect(getEffectStackCount(target, 'charge')).toBe(1);
  });

  test('basic Discharge does not add Charge without a successful hit', () => {
    const { ally, session } = summonLightning();
    const ability = ally.abilities.find(entry => entry.name === 'Разряд');
    const target = session.state.enemies[0];

    ability.allyAfterDirectDamage({
      attacker: ally,
      target,
      session,
      log: jest.fn(),
      deliberateAction: { successfulDirectHit: false },
    });

    expect(getEffectStackCount(target, 'charge')).toBe(0);
  });

  test('Storm Pulse deals 100% MagAtk, applies Conductivity for 2 turns and grants owner 20% turn meter', () => {
    const { ally, owner, session } = summonLightning();
    const ability = ally.abilities.find(entry => entry.name === 'Грозовой импульс');
    const target = session.state.enemies[0];
    owner.turnMeter = 300;

    expect(ability.cooldown).toBe(3);
    expect(ability.damage({ attacker: ally })).toBe(65);

    ability.allyAfterDirectDamage({
      attacker: ally,
      target,
      session,
      log: jest.fn(),
      deliberateAction: { successfulDirectHit: true },
    });

    expect(target.effects.find(effect => effect.id === 'conductivity')).toMatchObject({ remainingTurns: 2 });
    expect(owner.turnMeter).toBe(500);
  });

  test('Storm Pulse still grants its 20% tempo when the direct hit is lethal', () => {
    const { ally, owner, session } = summonLightning();
    const ability = ally.abilities.find(entry => entry.name === 'Грозовой импульс');
    const target = session.state.enemies[0];
    owner.turnMeter = 100;
    target.hp = 0;

    ability.allyAfterDirectDamage({
      attacker: ally,
      target,
      session,
      log: jest.fn(),
      deliberateAction: { successfulDirectHit: true },
    });

    expect(owner.turnMeter).toBe(300);
    expect(target.effects.some(effect => effect.id === 'conductivity')).toBe(false);
  });

  test('Last Impulse grants owner 30% full turn meter exactly once on real death', () => {
    const { ally, owner, session } = summonLightning();
    owner.turnMeter = 100;

    applyDamage(ally, 9999, 'pure', {
      source: session.state.enemies[0],
      session,
      bypassShield: true,
    });
    expect(ally.hp).toBe(0);
    expect(owner.turnMeter).toBe(400);

    applyDamage(ally, 9999, 'pure', {
      source: session.state.enemies[0],
      session,
      bypassShield: true,
    });
    expect(owner.turnMeter).toBe(400);
  });

  test('summon template preserves the Lightning Elemental ability presets', () => {
    const { ally } = summonLightning();

    expect(ally._summonTemplate?.abilityNames).toEqual([
      'Разряд молниевого элементаля',
      'Грозовой импульс',
      'Последний импульс',
    ]);
  });

  test('a living Lightning Elemental blocks another elemental summon', () => {
    const { session, owner } = summonLightning();
    const summonAbility = owner.abilities.find(entry => entry.name === 'Призыв элементаля');

    expect(summonAbility.canUse({ attacker: owner, session })).toBe(false);
  });

  test('Lightning remains combat-ready in the completed summon talent set', () => {
    expect(TALENT_BY_ID['mage.summon_elemental.lightning']?.combatReady).toBe(true);
    expect(TALENT_BY_ID['mage.summon_elemental.ice']?.combatReady).toBe(true);
  });
});
