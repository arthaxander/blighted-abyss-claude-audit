import { TALENT_BY_ID } from '../data/classTalents.mjs';
import { addEffect } from './effects';
import { applyDamage, initCombatSession, performPlayerAction } from './combatUtils';
import { createAbilityByName } from '../data/abilityPresets';

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
  classProgression: talentId ? progression(talentId) : undefined,
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

const summon = talentId => {
  const session = initCombatSession(mage(talentId), [enemy('a'), enemy('b')], { rng: () => 0.99 });
  const owner = session.state.players[0];
  session.state.initiative.playerReady = true;
  owner.turnMeter = 1000;
  performPlayerAction(session, 'Призыв элементаля', 0);
  return { session, owner, ally: session.state.players[1] };
};

describe('Greater Fire Elemental talent', () => {
  test('summons the agreed stronger Fire Elemental statline at 50% turn meter', () => {
    const { ally } = summon('mage.summon_elemental.greater_fire');

    expect(ally).toMatchObject({
      name: 'Великий огненный элементаль',
      summonKind: 'fire_elemental',
      summonVariant: 'greater_fire',
      maxHp: 120,
      hp: 120,
      attack: 8,
      magAtk: 75,
      physDef: 15,
      magicDef: 30,
      speed: 108,
      turnMeter: 500,
    });
  });

  test('keeps Fire Bolt at 100% and upgrades Ignite with one Charring', () => {
    const { ally, session } = summon('mage.summon_elemental.greater_fire');
    const bolt = ally.abilities.find(ability => ability.name === 'Огненный сгусток');
    const ignite = ally.abilities.find(ability => ability.name === 'Разжечь');
    const target = session.state.enemies[0];

    expect(bolt.damage({ attacker: ally })).toBe(75);
    expect(ignite.cooldown).toBe(3);
    expect(ignite.damage({ attacker: ally })).toBe(83);

    ignite.effect.forEach(effect => addEffect(target, effect, jest.fn(), ally, { session }));

    expect(target.effects.find(effect => effect.id === 'burn')).toMatchObject({ remainingTurns: 2 });
    expect(target.effects.find(effect => effect.id === 'charring')).toMatchObject({ remainingTurns: 3 });
  });

  test('death explosion deals 100% of the Greater Fire Elementals own MagAtk to every living enemy', () => {
    const { ally, session } = summon('mage.summon_elemental.greater_fire');

    applyDamage(ally, 9999, 'pure', {
      source: session.state.enemies[0],
      session,
      bypassShield: true,
    });

    expect(ally.hp).toBe(0);
    expect(session.state.enemies.map(target => target.hp)).toEqual([925, 925]);
  });

  test('ordinary Fire Elemental remains unchanged without the talent', () => {
    const { ally } = summon(null);

    expect(ally).toMatchObject({
      name: 'Огненный элементаль',
      summonVariant: 'base_fire',
      maxHp: 100,
      magAtk: 60,
      physDef: 15,
      magicDef: 30,
      speed: 108,
      turnMeter: 500,
    });
    expect(ally.abilities.find(ability => ability.name === 'Разжечь')?.presetKey).toBe('Разжечь');
    expect(ally.abilities.find(ability => ability.name === 'Пылающее ядро')?.presetKey).toBe('Пылающее ядро');
  });

  test('summon template preserves Greater Fire internal ability presets for future copies', () => {
    const { ally } = summon('mage.summon_elemental.greater_fire');

    expect(ally._summonTemplate?.abilityNames).toEqual([
      'Огненный сгусток',
      'Разжечь великого элементаля',
      'Великое пылающее ядро',
    ]);
  });

  test('Greater Fire remains combat-ready in the completed summon talent set', () => {
    expect(TALENT_BY_ID['mage.summon_elemental.greater_fire']?.combatReady).toBe(true);
    expect(TALENT_BY_ID['mage.summon_elemental.lightning']?.combatReady).toBe(true);
    expect(TALENT_BY_ID['mage.summon_elemental.ice']?.combatReady).toBe(true);
  });
});
