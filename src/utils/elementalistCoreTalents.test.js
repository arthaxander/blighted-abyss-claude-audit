import { createAbilityByName } from '../data/abilityPresets';
import { TALENT_BY_ID } from '../data/classTalents.mjs';
import { addEffect, getEffectStackCount } from './effects';
import { initCombatSession, performPlayerAction } from './combatUtils';

const progression = (abilityId, talentId) => ({ Mage: { talentSelections: { [abilityId]: talentId } } });
const mage = (abilityName, abilityId, talentId, extra = {}) => ({
  id: 'hero', name: 'Элементалист', class: 'Mage', displayClass: 'Элементалист',
  hp: 200, maxHp: 200, attack: 8, magAtk: 100, physDef: 0, magicDef: 0,
  speed: 125, critChance: 0, effects: [], abilities: [createAbilityByName(abilityName)],
  equippedClassPassiveIds: [],
  classProgression: talentId ? progression(abilityId, talentId) : undefined,
  ...extra,
});
const enemy = (id = 'enemy', extra = {}) => ({
  id, name: id, hp: 1000, maxHp: 1000, attack: 1, magAtk: 0,
  physDef: 0, magicDef: 0, speed: 1, critChance: 0, effects: [], abilities: [],
  ...extra,
});
const use = (hero, enemies, rng = () => 0.99) => {
  const session = initCombatSession(hero, enemies, { rng });
  session.state.initiative.playerReady = true;
  session.state.players[0].turnMeter = 1000;
  performPlayerAction(session, hero.abilities[0].name, 0);
  return session;
};

describe('Elementalist Fireball talents', () => {
  test('Charring Fire adds one Charring and refreshes the capped stack instead of creating a fourth', () => {
    const hero = mage('Огненный шар', 'mage.fireball', 'mage.fireball.charring_fire');
    const session = initCombatSession(hero, [enemy()], { rng: () => 0.99 });
    const target = session.state.enemies[0];
    for (let index = 0; index < 2; index += 1) addEffect(target, { id: 'charring', duration: 3 }, jest.fn(), hero, { session });
    session.state.initiative.playerReady = true;
    session.state.players[0].turnMeter = 1000;

    performPlayerAction(session, 'Огненный шар', 0);

    expect(getEffectStackCount(target, 'charring')).toBe(3);
  });

  test('Charring Fire extends Burn by one when the target already had three Charring stacks', () => {
    const hero = mage('Огненный шар', 'mage.fireball', 'mage.fireball.charring_fire');
    const session = initCombatSession(hero, [enemy()], { rng: () => 0.99 });
    const caster = session.state.players[0];
    const target = session.state.enemies[0];
    for (let index = 0; index < 3; index += 1) addEffect(target, { id: 'charring', duration: 2 }, jest.fn(), caster, { session });
    addEffect(target, { id: 'burn', duration: 2 }, jest.fn(), caster, { session });
    session.state.initiative.playerReady = true;
    caster.turnMeter = 1000;

    performPlayerAction(session, 'Огненный шар', 0);

    expect(getEffectStackCount(target, 'charring')).toBe(3);
    expect(target.effects.find(effect => effect.id === 'burn')?.remainingTurns).toBe(3);
    expect(target.effects.filter(effect => effect.id === 'charring').every(effect => effect.remainingTurns >= 3)).toBe(true);
  });

  test('Flash performs one extra Burn tick without consuming its duration', () => {
    const hero = mage('Огненный шар', 'mage.fireball', 'mage.fireball.flash');
    const session = initCombatSession(hero, [enemy()], { rng: () => 0.99 });
    const caster = session.state.players[0];
    const target = session.state.enemies[0];
    addEffect(target, { id: 'burn', duration: 2 }, jest.fn(), caster, { session });
    session.state.initiative.playerReady = true;
    caster.turnMeter = 1000;
    const before = target.hp;

    performPlayerAction(session, 'Огненный шар', 0);

    expect(before - target.hp).toBe(220); // 140 direct + (50 MagAtk + 3% max HP) Burn tick.
    expect(target.effects.find(effect => effect.id === 'burn')?.remainingTurns).toBe(2);
  });
});

describe('Elementalist Ice Spear talents', () => {
  test('Deep Freeze applies Strong Slow for two turns after a successful hit', () => {
    const session = use(
      mage('Ледяное копьё', 'mage.ice_spear', 'mage.ice_spear.deep_freeze'),
      [enemy()]
    );
    expect(session.state.enemies[0].effects.find(effect => effect.id === 'speed_penalty_major'))
      .toMatchObject({ remainingTurns: 2 });
  });

  test('Shatter doubles only the Ice Shard proc broken by Ice Spear', () => {
    const hero = mage('Ледяное копьё', 'mage.ice_spear', 'mage.ice_spear.shatter');
    const session = initCombatSession(hero, [enemy()], { rng: () => 0.99 });
    const caster = session.state.players[0];
    const target = session.state.enemies[0];
    addEffect(target, { id: 'ice_shards' }, jest.fn(), caster, { session });
    session.state.initiative.playerReady = true;
    caster.turnMeter = 1000;
    const before = target.hp;

    performPlayerAction(session, 'Ледяное копьё', 0);

    expect(before - target.hp).toBe(160); // 120 direct + doubled one-stack shard: 2 * 20.
    expect(getEffectStackCount(target, 'ice_shards')).toBe(0);
  });

  test('Ice Spear without Shatter keeps the normal shard proc', () => {
    const hero = mage('Ледяное копьё', 'mage.ice_spear', null);
    const session = initCombatSession(hero, [enemy()], { rng: () => 0.99 });
    const caster = session.state.players[0];
    const target = session.state.enemies[0];
    addEffect(target, { id: 'ice_shards' }, jest.fn(), caster, { session });
    session.state.initiative.playerReady = true;
    caster.turnMeter = 1000;
    const before = target.hp;

    performPlayerAction(session, 'Ледяное копьё', 0);

    expect(before - target.hp).toBe(140);
  });
});

describe('Elementalist Blizzard talents', () => {
  test('Ice Front removes 15% full turn meter from every hit enemy', () => {
    const session = initCombatSession(
      mage('Буран', 'mage.blizzard', 'mage.blizzard.ice_front'),
      [enemy('a'), enemy('b'), enemy('c')],
      { rng: () => 0.99 }
    );
    session.state.enemies.forEach(target => { target.turnMeter = 500; });
    session.state.initiative.playerReady = true;
    session.state.players[0].turnMeter = 1000;

    performPlayerAction(session, 'Буран', 0);

    expect(session.state.enemies.map(target => target.turnMeter)).toEqual([350, 350, 350]);
  });

  test('Shard Storm adds two Ice Shards to every surviving hit enemy after damage', () => {
    const session = use(
      mage('Буран', 'mage.blizzard', 'mage.blizzard.shard_storm'),
      [enemy('a'), enemy('b'), enemy('c')]
    );
    expect(session.state.enemies.map(target => getEffectStackCount(target, 'ice_shards'))).toEqual([2, 2, 2]);
  });
});

describe('Elementalist combat-ready talent catalogue', () => {
  test('keeps the first six implemented Elementalist talent IDs combat-ready', () => {
    const ready = Object.values(TALENT_BY_ID)
      .filter(talent => talent.combatReady && talent.id.startsWith('mage.'))
      .map(talent => talent.id);
    expect(ready).toEqual(expect.arrayContaining([
      'mage.blizzard.ice_front',
      'mage.blizzard.shard_storm',
      'mage.fireball.charring_fire',
      'mage.fireball.flash',
      'mage.ice_spear.deep_freeze',
      'mage.ice_spear.shatter',
    ]));
  });
});
