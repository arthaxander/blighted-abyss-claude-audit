import { createAbilityByName } from '../data/abilityPresets';
import { ELEMENTALIST_PASSIVES } from '../data/classProgression';
import { effects as effectDefinitions } from '../data/effects';
import { EFFECT_LIBRARY, addEffect } from './effects';
import {
  advanceElementalResonance,
  ELEMENTAL_RESONANCE_SPLASH_ABILITY_IDS,
  getElementalResonanceDamageBonus,
  getElementalResonanceSplashRatio,
  initCombatSession,
  isElementalResonanceSplashAbility,
  performPlayerAction,
  processEnemyAI,
  resetOverheatStreakAfterCompletedEnemyTurn,
  triggerLightningSpeedFromShockSkip,
} from './combatUtils';

const enemy = (name, hp = 1000) => ({ name, hp, maxHp: hp, attack: 1, speed: 10, magicDef: 0, physDef: 0, effects: [], abilities: [] });
const forcePlayerTurn = (session, abilityName, target = 0) => {
  const ability = session.state.players[0].abilities.find(entry => entry.name === abilityName);
  if (ability) ability.currentCooldown = 0;
  session.state.initiative.playerReady = true;
  session.state.turnState = { started: false, itemUsed: false };
  return performPlayerAction(session, abilityName, target);
};

const elementalistSession = ({ passives = [], abilities = [], enemies = [enemy('A')] } = {}) => initCombatSession({
  name: 'Элементалист', class: 'Elementalist', hp: 100, maxHp: 100, magAtk: 100, speed: 100,
  critChance: 0, abilities, equippedClassPassiveIds: passives,
}, enemies);

describe('Elementalist redesigned passives', () => {
  test('canonical roster keeps stable save IDs in the new presentation order', () => {
    expect(ELEMENTALIST_PASSIVES.map(passive => [passive.id, passive.name])).toEqual([
      ['lightning_speed', 'Скорость молнии'],
      ['overheat', 'Перегрев'],
      ['elemental_shell', 'Стихийная оболочка'],
      ['elemental_resonance', 'Стихийный резонанс'],
    ]);
  });

  test('Lightning Speed triggers only from an actual Shock skip and reuses canonical minor Haste', () => {
    const session = elementalistSession({ passives: ['lightning_speed'], abilities: [{ name: 'Ожидание', cooldown: 0, damage: 0, targeting: 'self' }] });
    const hero = session.state.players[0];
    hero.turnMeter = 0;
    triggerLightningSpeedFromShockSkip(hero, session);
    expect(hero.turnMeter).toBe(200);
    expect(hero.effects.filter(effect => effect.id === 'speed_boost_minor')).toHaveLength(1);
    expect(EFFECT_LIBRARY.speed_boost_minor).toMatchObject({ name: 'Ускорение', defaultDuration: 3, statMultipliers: { speed: 1.15 } });
    expect(EFFECT_LIBRARY.lightning_speed_haste).toBeUndefined();
  });

  test('ordinary completed enemy actions do not trigger Lightning Speed', () => {
    const session = elementalistSession({ passives: ['lightning_speed'] });
    session.state.players[0].turnMeter = 0;
    session.state.enemies[0].turnMeter = 1000;
    processEnemyAI(session);
    expect(session.state.players[0].turnMeter).toBe(0);
    expect(session.state.players[0].effects.some(effect => effect.id === 'speed_boost_minor')).toBe(false);
  });

  test('the authoritative enemy-turn Shock skip path triggers independently for each skip, but Stun does not', () => {
    const random = jest.spyOn(Math, 'random').mockReturnValue(0);
    const session = elementalistSession({ passives: ['lightning_speed'] });
    const hero = session.state.players[0];
    const foe = session.state.enemies[0];
    hero.turnMeter = 0;
    foe.turnMeter = 1000;
    addEffect(foe, { id: 'shock', duration: 2 }, () => {}, hero, { session });
    processEnemyAI(session);
    expect(hero.effects.some(effect => effect.id === 'speed_boost_minor')).toBe(true);

    hero.effects = [];
    hero.turnMeter = 0;
    foe.effects = [];
    foe.stunned = true;
    foe.turnMeter = 1000;
    processEnemyAI(session);
    expect(hero.effects.some(effect => effect.id === 'speed_boost_minor')).toBe(false);

    hero.turnMeter = 700;
    triggerLightningSpeedFromShockSkip(hero, session);
    triggerLightningSpeedFromShockSkip(hero, session);
    expect(hero.turnMeter).toBe(1000);
    random.mockRestore();
  });

  test('Overheat grants 50% TM once and procs only on turn two of a long streak', () => {
    const session = elementalistSession({ passives: ['overheat', 'elemental_resonance'], abilities: [{ name: 'Ожидание', cooldown: 0, damage: 0, targeting: 'self' }], enemies: [enemy('A'), enemy('B'), enemy('Dead', 0)] });
    const hero = session.state.players[0];
    // Elemental Resonance grants 50% and the level-one Recruit Seal grants the canonical 10% combat opener.
    expect(hero.turnMeter).toBe(600);
    [1, 2, 3, 4].forEach(() => forcePlayerTurn(session, 'Ожидание'));
    expect(session.state.enemies.slice(0, 2).map(unit => unit.hp)).toEqual([980, 980]);
    session.state.enemies.slice(0, 2).forEach(unit => expect(unit.effects.some(effect => effect.id === 'burn')).toBe(true));
    expect(session.state.enemies[2].effects).toEqual([]);
    expect(hero.turnMeter).toBe(600);
    expect(hero._elementalResonance).toBeUndefined();
  });

  test('a completed enemy action resets Overheat while a Shock skip does not', () => {
    const session = elementalistSession({ passives: ['overheat'], abilities: [{ name: 'Ожидание', cooldown: 0, damage: 0, targeting: 'self' }] });
    forcePlayerTurn(session, 'Ожидание');
    const foe = session.state.enemies[0];
    foe.turnMeter = 1000;
    session.state.players[0].turnMeter = 0;
    addEffect(foe, { id: 'shock', duration: 1, skipChance: 1 }, () => {}, session.state.players[0], { session });
    processEnemyAI(session);
    forcePlayerTurn(session, 'Ожидание');
    expect(foe.hp).toBe(980);

    resetOverheatStreakAfterCompletedEnemyTurn(session.state.players[0]);
    forcePlayerTurn(session, 'Ожидание');
    forcePlayerTurn(session, 'Ожидание');
    expect(foe.hp).toBe(960);
  });
});

describe('Elemental Resonance redesign', () => {
  test('progression caps and switching school starts level one', () => {
    const unit = {};
    const levels = Array.from({ length: 6 }, () => advanceElementalResonance(unit, 'fire').level);
    expect(levels).toEqual([1, 2, 3, 4, 5, 5]);
    expect(levels.map(getElementalResonanceDamageBonus)).toEqual([0, 0.08, 0.16, 0.24, 0.32, 0.32]);
    expect(levels.map(getElementalResonanceSplashRatio)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 0.8]);
    expect(advanceElementalResonance(unit, 'lightning')).toEqual({ school: 'lightning', level: 1 });
  });

  test('single-target level two uses pre-mitigation direct damage as splash reference', () => {
    const session = elementalistSession({
      passives: ['elemental_resonance'],
      abilities: [{ artId: 'fireball', name: 'Тестовый огонь', cooldown: 0, damage: 100, type: 'magical', school: 'fire' }],
      enemies: [enemy('A'), enemy('B'), enemy('C')],
    });
    forcePlayerTurn(session, 'Тестовый огонь');
    forcePlayerTurn(session, 'Тестовый огонь');
    expect(session.state.players[0]._elementalResonance).toEqual({ school: 'fire', level: 2 });
    expect(session.state.enemies.map(unit => unit.hp)).toEqual([792, 978, 978]);
    expect(session.state.enemies.slice(1).every(unit => unit.effects.length === 0)).toBe(true);
  });

  test('Chain Lightning advances once per cast but never creates Resonance splash', () => {
    const session = elementalistSession({
      passives: ['elemental_resonance'],
      abilities: [{ artId: 'chain_lightning', name: 'Цепная молния', cooldown: 2, damage: 100, type: 'magical', school: 'lightning' }],
      enemies: [enemy('A'), enemy('B'), enemy('C')],
    });
    forcePlayerTurn(session, 'Цепная молния');
    forcePlayerTurn(session, 'Цепная молния');
    expect(session.state.players[0]._elementalResonance).toEqual({ school: 'lightning', level: 2 });
    expect(isElementalResonanceSplashAbility(session.state.players[0].abilities[0])).toBe(false);
    expect(session.state.enemies.map(unit => unit.hp)).toEqual([792, 1000, 1000]);
  });

  test('a non-elemental action leaves progression unchanged', () => {
    const unit = { _elementalResonance: { school: 'fire', level: 2 } };
    expect(advanceElementalResonance(unit, 'nature')).toEqual({ school: 'fire', level: 2 });
  });
});

describe('Elementalist data and canonical Slow', () => {
  test('the explicit stable-ID whitelist contains exactly the four canonical splash skills', () => {
    expect(ELEMENTAL_RESONANCE_SPLASH_ABILITY_IDS).toEqual(['fireball', 'ice_lance', 'storm_discharge', 'elemental_echo']);
    expect(['Огненный шар', 'Ледяное копьё', 'Грозовой разряд', 'Стихийное эхо']
      .map(createAbilityByName).every(isElementalResonanceSplashAbility)).toBe(true);
    expect(isElementalResonanceSplashAbility(createAbilityByName('Цепная молния'))).toBe(false);
  });

  test('canonical Elementalist cooldowns distinguish ST splash from Chain Lightning', () => {
    ['Огненный шар', 'Ледяное копьё', 'Грозовой разряд']
      .forEach(name => expect(createAbilityByName(name).cooldown).toBe(1));
    expect(createAbilityByName('Стихийное эхо').cooldown).toBe(2);
    expect(createAbilityByName('Цепная молния').cooldown).toBe(2);
    expect(createAbilityByName('Буран').cooldown).toBe(4);
    expect(createAbilityByName('Морозный щит').cooldown).toBe(3);
    expect(createAbilityByName('Призыв элементаля').cooldown).toBe(5);
  });

  test('Fire + Ice uses the one canonical 20% one-turn Slow entity', () => {
    expect(EFFECT_LIBRARY.speed_penalty_minor).toMatchObject({ name: 'Замедление', defaultDuration: 1, statMultipliers: { speed: 0.8 } });
    expect(EFFECT_LIBRARY.thermal_shock_slow).toBeUndefined();
    expect(effectDefinitions.find(effect => effect.Name === 'Замедление').Описание).toContain('20%');
  });
});
