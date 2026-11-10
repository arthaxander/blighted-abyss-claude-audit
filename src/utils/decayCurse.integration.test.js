import { applyDamage, completeEntanglementTurn, getAbilityCooldownSum, initCombatSession, performPlayerAction } from './combatUtils';
import {
  addEffect, cleanseEffects, countUniqueActiveBuffs, countUniqueActiveDebuffs, getEffectDefinition,
} from './effects';

const ability = (name, damage = 50, cooldown = 3) => ({ name, targeting: 'enemy', accuracy: 1, damage, cooldown, type: 'physical' });
const basic = { ...ability('Атака', 20, 0), basic: true };
const makeSession = (tier = 1, overrides = {}, rng = () => 0.99) => initCombatSession({
  name: 'Испытатель', hp: 500, maxHp: 500, attack: 100, speed: 100, critChance: 0,
  curses: tier ? { decay: { tier } } : {}, abilities: [basic, ability('Пепел'), ability('Уголь', 80, 4)],
  ...overrides,
}, [{ name: 'Манекен', hp: 5000, maxHp: 5000, attack: 20, speed: 1, physDef: 0, abilities: [ability('Укус')] }], { rng });
const act = (session, name) => {
  session.state.turnState = null;
  session.state.initiative.playerReady = true;
  return performPlayerAction(session, name, 0);
};

describe('Тление I–V', () => {
  test('[Беспамятство] is a canonical refreshable two-turn debuff', () => {
    const definition = getEffectDefinition('forgetfulness');
    expect(definition).toMatchObject({ type: 'debuff', defaultDuration: 2, stacking: 'refresh' });
    const session = makeSession(3);
    const hero = session.state.players[0];
    addEffect(hero, { id: 'forgetfulness' }, () => {}, hero, { session });
    addEffect(hero, { id: 'forgetfulness' }, () => {}, hero, { session });
    expect(hero.effects.filter(effect => effect.id === 'forgetfulness')).toHaveLength(1);
    expect(hero.effects.find(effect => effect.id === 'forgetfulness').remainingTurns).toBe(2);
  });

  test('[Беспамятство] substitutes through normal execution and leaves the selected ability untouched', () => {
    const session = makeSession(3, { curses: { decay: { tier: 3 }, undeath: { tier: 1 } } }, () => 0);
    const hero = session.state.players[0];
    addEffect(hero, { id: 'forgetfulness' }, () => {}, hero, { session });
    act(session, 'Пепел');
    expect(hero.abilities.find(entry => entry.name === 'Пепел').currentCooldown || 0).toBe(0);
    expect(hero.abilities.find(entry => entry.name === 'Уголь').currentCooldown).toBe(3);
    expect(hero._pendingRuinsEcho.abilityName).toBe('Уголь');
  });

  test('[Беспамятство] adds one cooldown when substitution does not happen', () => {
    const session = makeSession(1, {}, () => 0.99);
    const hero = session.state.players[0];
    addEffect(hero, { id: 'forgetfulness' }, () => {}, hero, { session });
    act(session, 'Пепел');
    expect(hero.abilities.find(entry => entry.name === 'Пепел').currentCooldown).toBe(3);
  });

  test('I grants +5% hero damage and reduces only the first nonbasic final cooldown', () => {
    const session = makeSession(1);
    const hero = session.state.players[0];
    const enemy = session.state.enemies[0];
    const before = enemy.hp;
    act(session, 'Атака');
    expect(before - enemy.hp).toBe(21);
    act(session, 'Пепел');
    expect(hero.abilities.find(entry => entry.name === 'Пепел').currentCooldown).toBe(2);
    act(session, 'Уголь');
    expect(hero.abilities.find(entry => entry.name === 'Уголь').currentCooldown).toBe(4);
  });

  test('II transforms incoming finite durations without refresh drift', () => {
    const session = makeSession(2);
    const hero = session.state.players[0];
    const enemy = session.state.enemies[0];
    addEffect(hero, { id: 'speed_boost_minor', duration: 2 }, () => {}, hero, { session });
    expect(hero.effects.find(effect => effect.id === 'speed_boost_minor').remainingTurns).toBe(3);
    addEffect(hero, { id: 'speed_boost_minor', duration: 2 }, () => {}, hero, { session });
    expect(hero.effects.find(effect => effect.id === 'speed_boost_minor').remainingTurns).toBe(3);
    addEffect(hero, { id: 'speed_penalty_minor', duration: 2 }, () => {}, enemy, { session });
    expect(hero.effects.find(effect => effect.id === 'speed_penalty_minor').remainingTurns).toBe(2);
    addEffect(enemy, { id: 'speed_penalty_minor', duration: 2 }, () => {}, hero, { session });
    expect(enemy.effects.find(effect => effect.id === 'speed_penalty_minor').remainingTurns).toBe(3);
    addEffect(enemy, { id: 'speed_boost_minor', duration: 2 }, () => {}, enemy, { session });
    expect(enemy.effects.find(effect => effect.id === 'speed_boost_minor').remainingTurns).toBe(2);
  });

  test('III/IV count unique canonical buff and debuff ids for dynamic damage', () => {
    const session = makeSession(4);
    const hero = session.state.players[0];
    const enemy = session.state.enemies[0];
    addEffect(hero, { id: 'speed_boost_minor', duration: 2 }, () => {}, hero, { session, forceIndependentInstance: true });
    addEffect(hero, { id: 'speed_boost_minor', duration: 2 }, () => {}, hero, { session, forceIndependentInstance: true });
    addEffect(hero, { id: 'speed_penalty_minor', duration: 2 }, () => {}, enemy, { session });
    expect(countUniqueActiveBuffs(hero)).toBe(1);
    expect(countUniqueActiveDebuffs(hero)).toBe(1);
    const beforeEnemy = enemy.hp;
    applyDamage(enemy, 100, 'pure', { source: hero, session });
    expect(beforeEnemy - enemy.hp).toBe(112);
    const beforeHero = hero.hp;
    applyDamage(hero, 100, 'pure', { source: enemy, session });
    expect(beforeHero - hero.hp).toBe(93);
    cleanseEffects(hero, effect => effect.id === 'speed_boost_minor');
    const next = enemy.hp;
    applyDamage(enemy, 100, 'pure', { source: hero, session });
    expect(next - enemy.hp).toBe(108);
  });

  test('III and IV use independent three-own-turn triggers and canonical searing_mark', () => {
    const session = makeSession(4);
    const hero = session.state.players[0];
    const enemy = session.state.enemies[0];
    ['speed_boost_minor', 'attack_boost_minor', 'phys_def_boost_minor', 'magic_def_boost_minor'].forEach(id =>
      addEffect(hero, { id, duration: 2 }, () => {}, hero, { session }));
    expect(hero.effects.some(effect => effect.id === 'forgetfulness')).toBe(true);
    expect(hero.effects.some(effect => effect.id === 'searing_mark')).toBe(true);
    expect(enemy.effects.find(effect => effect.id === 'searing_mark').remainingTurns).toBe(4);
    expect(hero.effects.find(effect => effect.id === 'searing_mark').remainingTurns).toBe(3);
    expect(hero._decayForgetfulnessCooldown).toBe(3);
    expect(hero._decaySearingMarkCooldown).toBe(3);
    for (let index = 0; index < 3; index += 1) completeEntanglementTurn(hero, () => {}, session);
    expect(hero._decayForgetfulnessCooldown).toBe(0);
  });

  test('V derives hero and per-enemy modifiers directly from current cooldown sums', () => {
    const session = makeSession(5);
    const hero = session.state.players[0];
    const enemy = session.state.enemies[0];
    hero.abilities[1].currentCooldown = 3;
    hero.abilities[2].currentCooldown = 5;
    enemy.abilities[0].currentCooldown = 5;
    expect(getAbilityCooldownSum(hero)).toBe(8);
    let before = enemy.hp;
    applyDamage(enemy, 100, 'pure', { source: hero, session });
    expect(before - enemy.hp).toBe(151); // 5% I + 32% hero V, then 10% enemy incoming V
    before = hero.hp;
    applyDamage(hero, 100, 'pure', { source: enemy, session });
    expect(before - hero.hp).toBe(110);
    enemy.abilities[0].currentCooldown = 0;
    before = hero.hp;
    applyDamage(hero, 100, 'pure', { source: enemy, session });
    expect(before - hero.hp).toBe(100);
  });
});
