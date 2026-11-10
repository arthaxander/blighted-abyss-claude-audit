import { createAbilityByName } from '../data/abilityPresets';
import {
  applyDamage, completeEntanglementTurn, getEffectiveSpeed, initCombatSession, performPlayerAction,
} from './combatUtils';
import {
  addEffect, cleanseEffects, getEffectStackCount, processEffects,
} from './effects';

const attack = () => ({ ...createAbilityByName('Атака', 100), accuracy: 1, critChance: 0 });
const wait = { name: 'Ожидание', targeting: 'self', cooldown: 0, damage: 0, effects: [] };
const makeSession = (tier = 1, overrides = {}) => initCombatSession({
  name: 'Испытатель', hp: 500, maxHp: 500, attack: 100, speed: 100,
  critChance: 0, curses: tier ? { corruption: { tier } } : {},
  abilities: [attack(), wait], ...overrides,
}, [{ name: 'Манекен', hp: 5000, maxHp: 5000, attack: 20, speed: 1, physDef: 0, abilities: [] }], { rng: () => 0.99 });

const takeTurn = (session, ability = 'Атака') => {
  session.state.turnState = null;
  session.state.initiative.playerReady = true;
  return performPlayerAction(session, ability, 0);
};

describe('Осквернение I–V', () => {
  test('I: one direct HP hit per own action grants [Жажда], and the next turn can grant another', () => {
    const session = makeSession(1);
    const player = session.state.players[0];
    takeTurn(session);
    expect(getEffectStackCount(player, 'thirst')).toBe(1);
    expect(player.attack).toBe(108);
    takeTurn(session);
    expect(getEffectStackCount(player, 'thirst')).toBe(2);
    expect(player.attack).toBe(116);
  });

  test('I: AoE and multihit share one deliberate action trigger', () => {
    const multi = { name: 'Шквал', targeting: 'allEnemies', accuracy: 1, cooldown: 0, damage: ({ attacker }) => attacker.attack, hits: 2 };
    const session = makeSession(1, { abilities: [multi] });
    session.state.enemies.push({ ...session.state.enemies[0], id: 'second', combatInstanceId: 'second', hp: 5000 });
    takeTurn(session, 'Шквал');
    expect(getEffectStackCount(session.state.players[0], 'thirst')).toBe(1);
  });

  test('I: shield-only and periodic damage do not grant [Жажда]', () => {
    const session = makeSession(1);
    const [enemy] = session.state.enemies;
    enemy.shield = 999;
    takeTurn(session);
    expect(getEffectStackCount(session.state.players[0], 'thirst')).toBe(0);
    applyDamage(enemy, 50, 'physical', { source: session.state.players[0], session, isPeriodic: true, fromEffect: 'bleed' });
    expect(getEffectStackCount(session.state.players[0], 'thirst')).toBe(0);
  });

  test('I: 1/2/3 charges add Attack and outgoing damage without changing base stats', () => {
    const session = makeSession(1);
    const player = session.state.players[0];
    const enemy = session.state.enemies[0];
    const losses = [];
    for (let index = 0; index < 3; index += 1) {
      const before = enemy.hp;
      takeTurn(session);
      losses.push(before - enemy.hp);
    }
    expect(player.attack).toBe(124);
    expect(player.baseStats.attack).toBe(100);
    expect(losses).toEqual([100, 113, 128]);
    const beforePeriodic = enemy.hp;
    applyDamage(enemy, 100, 'physical', { source: player, session, isPeriodic: true, fromEffect: 'bleed' });
    expect(beforePeriodic - enemy.hp).toBe(115);
  });

  test('II: only first direct incoming HP damage between turns grants [Жажда]', () => {
    const session = makeSession(2);
    const player = session.state.players[0];
    const enemy = session.state.enemies[0];
    const hit = () => applyDamage(player, 20, 'physical', { source: enemy, session, directAttack: true, deliberateAction: {} });
    hit(); hit();
    expect(getEffectStackCount(player, 'thirst')).toBe(1);
    takeTurn(session, 'Ожидание');
    hit();
    expect(getEffectStackCount(player, 'thirst')).toBe(2);
  });

  test('II: shield-only and periodic incoming damage do not trigger [Жажда]', () => {
    const session = makeSession(2);
    const player = session.state.players[0];
    const enemy = session.state.enemies[0];
    player.shield = 100;
    applyDamage(player, 20, 'physical', { source: enemy, session, directAttack: true, deliberateAction: {} });
    applyDamage(player, 20, 'physical', { source: enemy, session, isPeriodic: true, fromEffect: 'bleed' });
    expect(getEffectStackCount(player, 'thirst')).toBe(0);
  });

  test('II: at 3 [Жажда], vampirism heals 5% actual direct HP damage only', () => {
    const session = makeSession(2, { hp: 300 });
    const player = session.state.players[0];
    takeTurn(session); takeTurn(session); takeTurn(session);
    player.hp = 300;
    const before = session.state.enemies[0].hp;
    takeTurn(session);
    const actual = before - session.state.enemies[0].hp;
    expect(player.hp).toBe(300 + Math.round(actual * 0.05));
    const healed = player.hp;
    applyDamage(session.state.enemies[0], 100, 'physical', { source: player, session, isPeriodic: true, fromEffect: 'bleed' });
    expect(player.hp).toBe(healed);
  });

  test('III: turn without direct HP damage adds bleed; a real hit prevents it', () => {
    const session = makeSession(3);
    const player = session.state.players[0];
    takeTurn(session, 'Ожидание');
    expect(player.effects.find(effect => effect.id === 'bleed')?.remainingTurns).toBe(1);
    cleanseEffects(player, effect => effect.id === 'bleed');
    takeTurn(session);
    expect(player.effects.some(effect => effect.id === 'bleed')).toBe(false);
  });

  test('III: shield-only and DoT damage do not satisfy the direct HP condition', () => {
    const session = makeSession(3);
    const player = session.state.players[0];
    const enemy = session.state.enemies[0];
    enemy.shield = 999;
    takeTurn(session);
    expect(player.effects.some(effect => effect.id === 'bleed')).toBe(true);
    cleanseEffects(player, effect => effect.id === 'bleed');
    player._corruptionDirectHpDamageThisTurn = false;
    enemy.shield = 0;
    applyDamage(enemy, 50, 'physical', { source: player, session, isPeriodic: true, fromEffect: 'bleed' });
    completeEntanglementTurn(player, () => {}, session);
    expect(player.effects.some(effect => effect.id === 'bleed')).toBe(true);
  });

  test('IV: bleed ticks grant at most 3 [Багровый экстаз], with damage/speed bonuses, and cleanse removes it immediately', () => {
    const session = makeSession(4);
    const player = session.state.players[0];
    addEffect(player, { id: 'bleed', duration: 4 }, () => {}, player, { session });
    for (let i = 0; i < 4; i += 1) takeTurn(session);
    expect(getEffectStackCount(player, 'crimson_ecstasy')).toBe(3);
    expect(getEffectiveSpeed(player, session)).toBe(130);
    expect(player.baseStats.speed).toBe(100);
    cleanseEffects(player, effect => effect.id === 'bleed', () => {});
    expect(getEffectStackCount(player, 'crimson_ecstasy')).toBe(0);
    expect(player.speed).toBe(100);
  });

  test('IV: first arrival at 3 [Жажда] adds two bleed turns only once', () => {
    const session = makeSession(4);
    const player = session.state.players[0];
    takeTurn(session); takeTurn(session); takeTurn(session);
    const bleed = player.effects.find(effect => effect.id === 'bleed');
    expect(bleed.remainingTurns).toBe(2);
    takeTurn(session);
    expect(player._corruptionThirstPeakTriggered).toBe(true);
  });

  test('V: existing bleed ticks before one start-turn bleed is added, and III adds another at turn end', () => {
    const session = makeSession(5);
    const player = session.state.players[0];
    takeTurn(session, 'Ожидание');
    expect(player.effects.find(effect => effect.id === 'bleed')?.remainingTurns).toBe(2);
    expect(getEffectStackCount(player, 'crimson_ecstasy')).toBe(0);
    takeTurn(session, 'Ожидание');
    expect(getEffectStackCount(player, 'crimson_ecstasy')).toBe(1);
    expect(player.effects.find(effect => effect.id === 'bleed')?.remainingTurns).toBe(3);
  });

  test('no curse has no mechanics, tier I has no later mechanics, and combat state starts clean', () => {
    const plain = makeSession(0);
    takeTurn(plain);
    expect(getEffectStackCount(plain.state.players[0], 'thirst')).toBe(0);
    const first = makeSession(1);
    addEffect(first.state.players[0], { id: 'bleed', duration: 1 }, () => {}, first.state.enemies[0], { session: first });
    processEffects(first.state.players[0], () => {}, { session: first });
    expect(getEffectStackCount(first.state.players[0], 'crimson_ecstasy')).toBe(0);
    const next = makeSession(5);
    expect(next.state.players[0].effects).toEqual([]);
  });
});
