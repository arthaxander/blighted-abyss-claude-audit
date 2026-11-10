import { createAbilityByName } from '../data/abilityPresets';
import {
  applyDamage, completeEntanglementTurn, getEffectiveSpeed, initCombatSession, performPlayerAction,
} from './combatUtils';
import { addEffect, getEffectStackCount } from './effects';

const basic = type => ({ ...createAbilityByName('Атака', 10), type, accuracy: 1, critChance: 0, damage: 10 });
const wait = { name: 'Ожидание', targeting: 'self', cooldown: 0, damage: 0, effects: [] };
const makeSession = (tier = 1, overrides = {}, enemyOverrides = {}) => initCombatSession({
  name: 'Испытатель', hp: 100, maxHp: 100, attack: 10, magAtk: 100, speed: 100,
  critChance: 0, curses: tier ? { distortion: { tier } } : {}, abilities: [basic('physical'), wait],
  ...overrides,
}, [{ name: 'Манекен', hp: 1000, maxHp: 1000, attack: 100, speed: 1, physDef: 0, magicDef: 0, abilities: [], ...enemyOverrides }], { rng: () => 0.99 });
const player = session => session.state.players[0];
const enemy = session => session.state.enemies[0];
const enemyHit = (session, raw, options = {}) => applyDamage(player(session), raw, options.type || 'physical', {
  source: enemy(session), session, directAttack: options.directAttack ?? true,
  deliberateAction: options.directAttack === false ? null : {},
  isPeriodic: options.isPeriodic || false, fromEffect: options.fromEffect || null,
});
const takeTurn = (session, ability = 'Атака') => {
  session.state.turnState = null;
  session.state.initiative.playerReady = true;
  return performPlayerAction(session, ability, 0);
};

describe('Искажение I–V', () => {
  test('I: reduces HP damage by 10% and stores only the prevented amount', () => {
    const session = makeSession(1);
    expect(enemyHit(session, 100)).toBe(90);
    expect(player(session).hp).toBe(10);
    expect(player(session)._refraction).toBe(10);
    expect(player(session).effects.find(effect => effect.id === 'refraction')?.description).toContain('10 / 30');
  });

  test('I: shield-only does not fill; partial shield resolves before defense and Distortion', () => {
    const session = makeSession(1);
    player(session).shield = 100;
    expect(enemyHit(session, 60)).toBe(0);
    expect(player(session)._refraction).toBe(0);
    expect(player(session).shield).toBe(40);
    expect(enemyHit(session, 100)).toBe(54);
    expect(player(session).shield).toBe(0);
    expect(player(session)._refraction).toBe(6);
  });

  test('I: DoT bypasses Shield but is reduced and stored; cap cannot exceed 30% Max HP', () => {
    const session = makeSession(1, { hp: 500, maxHp: 500 });
    player(session).shield = 500;
    expect(enemyHit(session, 100, { directAttack: false, isPeriodic: true, fromEffect: 'bleed' })).toBe(90);
    expect(player(session).shield).toBe(500);
    expect(player(session)._refraction).toBe(10);
    for (let i = 0; i < 20; i += 1) enemyHit(session, 100, { directAttack: false, isPeriodic: true, fromEffect: 'bleed' });
    expect(player(session)._refraction).toBe(150);
  });

  test('I: only a successful deliberate direct HP hit spends Refraction once', () => {
    const aoe = { name: 'Волна', targeting: 'allEnemies', cooldown: 0, accuracy: 1, damage: 10, type: 'physical' };
    const session = makeSession(1, { abilities: [aoe] });
    player(session)._refraction = 20;
    // Shield-only outgoing hit preserves the resource.
    enemy(session).shield = 100;
    takeTurn(session, 'Волна');
    expect(player(session)._refraction).toBe(20);
    enemy(session).shield = 0;
    session.state.enemies.push({ ...enemy(session), id: 'second', combatInstanceId: 'second', hp: 1000 });
    takeTurn(session, 'Волна');
    expect(player(session)._refraction).toBe(0);
    expect(session.state.log.filter(line => line.includes('расходует [Преломление]'))).toHaveLength(1);
  });

  test('II: first direct HP hit after own turn is 25%, next is base 10%, and shield does not consume readiness', () => {
    const session = makeSession(2, { hp: 500, maxHp: 500 });
    takeTurn(session, 'Ожидание');
    player(session).shield = 100;
    expect(enemyHit(session, 50)).toBe(0);
    expect(player(session)._distortionEnhancedHitReady).toBe(true);
    player(session).shield = 0;
    expect(enemyHit(session, 100)).toBe(75);
    expect(player(session)._distortionEnhancedHitReady).toBe(false);
    expect(enemyHit(session, 100)).toBe(90);
    takeTurn(session, 'Ожидание');
    expect(enemyHit(session, 100)).toBe(75);
  });

  test('III: full raw resource deals ×1.5 with triggering type and restores stepped Speed after spending', () => {
    const session = makeSession(3, { hp: 500, maxHp: 100, abilities: [basic('physical')] }, { physDef: 100 });
    player(session)._refraction = 30;
    // Synchronize through one prevented event without crossing another threshold.
    enemyHit(session, 10, { directAttack: false, isPeriodic: true, fromEffect: 'bleed' });
    expect(getEffectiveSpeed(player(session), session)).toBe(88);
    const before = enemy(session).hp;
    takeTurn(session);
    expect(before - enemy(session).hp).toBe(28); // 10 -> 5, Refraction 45 -> 23 through physical defense.
    expect(player(session)._refraction).toBe(0);
    expect(getEffectiveSpeed(player(session), session)).toBe(100);
  });

  test('III: Speed penalty follows 0/−4/−8/−12% thresholds', () => {
    const session = makeSession(3, { hp: 1000, maxHp: 100 });
    for (const [value, expected] of [[9, 100], [10, 96], [20, 92], [30, 88]]) {
      player(session)._refraction = value;
      enemyHit(session, 0);
      // A zero hit does not sync, so use the visible resource helper through a 1-damage DoT at threshold-1.
      if (value > 0) {
        player(session)._refraction = value - 1;
        enemyHit(session, 10, { directAttack: false, isPeriodic: true, fromEffect: 'bleed' });
      }
      expect(getEffectiveSpeed(player(session), session)).toBe(expected);
    }
  });

  test('IV: base reduction is 15%, II remains 25%, full overload yields 94 damage and clears on spend', () => {
    const session = makeSession(4, { hp: 1000, maxHp: 100 });
    expect(enemyHit(session, 100)).toBe(85);
    completeEntanglementTurn(player(session), () => {}, session);
    expect(enemyHit(session, 100)).toBe(75);
    player(session)._refraction = 29;
    enemyHit(session, 10, { directAttack: false, isPeriodic: true, fromEffect: 'bleed' });
    expect(player(session)._refraction).toBe(30);
    expect(getEffectiveSpeed(player(session), session)).toBe(85);
    expect(enemyHit(session, 100)).toBe(94);
    takeTurn(session);
    expect(player(session)._refraction).toBe(0);
    expect(getEffectiveSpeed(player(session), session)).toBe(100);
    player(session)._distortionEnhancedHitReady = false;
    expect(enemyHit(session, 100)).toBe(85);
  });

  test('IV: spending full Refraction uses existing [Заряд], including its standard third-charge discharge', () => {
    const session = makeSession(4);
    addEffect(enemy(session), { id: 'charge' }, () => {}, player(session), { session });
    addEffect(enemy(session), { id: 'charge' }, () => {}, player(session), { session });
    player(session)._refraction = 30;
    const before = enemy(session).hp;
    takeTurn(session);
    expect(getEffectStackCount(enemy(session), 'charge')).toBe(0);
    expect(before - enemy(session).hp).toBeGreaterThan(10 + 45);
  });

  test('V: direct death-save works once, while DoT never consumes it', () => {
    const session = makeSession(5, { hp: 100, maxHp: 100 });
    enemyHit(session, 1000, { directAttack: false, isPeriodic: true, fromEffect: 'bleed' });
    expect(player(session).hp).toBe(0);
    expect(player(session)._distortionDeathSaveConsumed).toBe(false);
    const direct = makeSession(5);
    enemyHit(direct, 1000);
    expect(player(direct).hp).toBe(1);
    expect(player(direct)._distortionDeathSaveConsumed).toBe(true);
    enemyHit(direct, 1000);
    expect(player(direct).hp).toBe(0);
  });

  test('V: crossing cap grants one Charge, staying full grants none, spending and refilling grants again', () => {
    const session = makeSession(5, { hp: 1000, maxHp: 100 });
    player(session)._refraction = 29;
    enemyHit(session, 10, { directAttack: false, isPeriodic: true, fromEffect: 'bleed' });
    expect(getEffectStackCount(player(session), 'charge')).toBe(1);
    enemyHit(session, 100, { directAttack: false, isPeriodic: true, fromEffect: 'bleed' });
    expect(getEffectStackCount(player(session), 'charge')).toBe(1);
    takeTurn(session);
    player(session)._refraction = 29;
    enemyHit(session, 10, { directAttack: false, isPeriodic: true, fromEffect: 'bleed' });
    expect(getEffectStackCount(player(session), 'charge')).toBe(2);
  });

  test('V: charge discharge in the death-save chain cannot kill, but a later discharge can', () => {
    const session = makeSession(5, { hp: 100, maxHp: 100, magAtk: 100 });
    addEffect(player(session), { id: 'charge' }, () => {}, player(session), { session });
    addEffect(player(session), { id: 'charge' }, () => {}, player(session), { session });
    player(session)._refraction = 20;
    enemyHit(session, 1000);
    expect(player(session).hp).toBe(1);
    player(session).hp = 50;
    addEffect(player(session), { id: 'charge' }, () => {}, player(session), { session });
    addEffect(player(session), { id: 'charge' }, () => {}, player(session), { session });
    addEffect(player(session), { id: 'charge' }, () => {}, player(session), { session });
    expect(player(session).hp).toBe(0);
  });

  test('no Distortion and a fresh combat have no Refraction or death-save state', () => {
    const plain = makeSession(0);
    expect(enemyHit(plain, 100)).toBe(100);
    expect(player(plain)._refraction).toBe(0);
    const fresh = makeSession(5, { _refraction: 30, _distortionDeathSaveConsumed: true });
    expect(player(fresh)._refraction).toBe(0);
    expect(player(fresh)._distortionDeathSaveConsumed).toBe(false);
    expect(player(fresh).effects.some(effect => effect.id === 'refraction')).toBe(false);
  });
});
