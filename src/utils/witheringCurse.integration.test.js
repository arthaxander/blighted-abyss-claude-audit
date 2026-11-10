import { createAbilityByName } from '../data/abilityPresets';
import {
  applyDamage, getEffectiveSpeed, initCombatSession, performPlayerAction, registerCompletedCombatTurn,
  WITHERING_GLOBAL_TURN_MAX, WITHERING_GLOBAL_TURN_MIN,
} from './combatUtils';
import { addEffect, getEffectStackCount } from './effects';

const wait = { name: 'Ожидание', targeting: 'self', cooldown: 0, damage: 0, effects: [] };
const makeSession = (tier = 1, { rng = () => 0, hero = {}, enemies = null } = {}) => initCombatSession({
  name: 'Герой', hp: 90, maxHp: 100, attack: 100, speed: 100, critChance: 0,
  curses: tier ? { withering: { tier } } : {}, abilities: [createAbilityByName('Атака', 100), wait], ...hero,
}, enemies || [
  { id: 'one', name: 'Первый', hp: 1000, maxHp: 1000, attack: 1, speed: 1, physDef: 0, abilities: [] },
  { id: 'two', name: 'Второй', hp: 1000, maxHp: 1000, attack: 1, speed: 1, physDef: 0, abilities: [] },
], { rng });
const hero = session => session.state.players[0];
const takeTurn = session => {
  session.state.turnState = null;
  session.state.initiative.playerReady = true;
  return performPlayerAction(session, 'Ожидание', 0);
};
let token = 1000;
const complete = (session, actor) => {
  actor._activeCombatTurnToken = ++token;
  return registerCompletedCombatTurn(session, actor, text => session.state.log.push(text));
};

describe('Увядание I–V', () => {
  test('I: heals 5% Max HP once and gives exactly +5% combat Speed', () => {
    const session = makeSession(1);
    expect(hero(session).hp).toBe(95);
    expect(hero(session).speed).toBe(105);
    expect(hero(session).baseStats.speed).toBe(100);
    expect(hero(makeSession(1, { hero: { hp: 100 } })).hp).toBe(100);
  });

  test('III+: Withering Speed is additive +15%, not 1.05 × 1.10', () => {
    expect(hero(makeSession(3)).speed).toBe(115);
    expect(hero(makeSession(5)).speed).toBe(115);
  });

  test('II: first actual turn applies one opening batch once to hero and deterministic enemy', () => {
    const session = makeSession(2, { rng: () => 0 });
    takeTurn(session);
    expect(getEffectStackCount(hero(session), 'entanglement')).toBe(1);
    expect(getEffectStackCount(session.state.enemies[0], 'entanglement')).toBe(1);
    expect(getEffectStackCount(session.state.enemies[1], 'entanglement')).toBe(0);
    takeTurn(session);
    expect(session.state.log.filter(line => line.includes('[Первые корни] распространяются'))).toHaveLength(1);
  });

  test('II: every third subsequent completed actor turn applies roots; retries and combat objects do not count', () => {
    const session = makeSession(2);
    takeTurn(session); // opening and completed turn 1
    const enemy = session.state.enemies[0];
    const ally = { id: 'ally', name: 'Саммон', hp: 10, maxHp: 10, effects: [] };
    session.state.players.push(ally);
    complete(session, enemy); // subsequent 1
    complete(session, ally); // subsequent 2
    expect(registerCompletedCombatTurn(session, ally, () => {})).toBe(false); // same token / UI retry
    expect(complete(session, { id: 'object', hp: 1, nonActingCombatObject: true })).toBe(false);
    const before = getEffectStackCount(enemy, 'entanglement');
    complete(session, hero(session)); // subsequent 3
    expect(getEffectStackCount(enemy, 'entanglement')).toBe(before + 1);
  });

  test('application events: +2 stacks and multi-target batches reward once; failed applications reward nothing', () => {
    const session = makeSession(3);
    const player = hero(session);
    player.turnMeter = 0;
    addEffect(session.state.enemies[0], { id: 'entanglement', stacks: 2 }, () => {}, player, { session });
    expect(player.turnMeter).toBe(100);
    const batchId = {};
    addEffect(session.state.enemies[0], { id: 'entanglement' }, () => {}, player, { session, applicationEventId: batchId });
    addEffect(session.state.enemies[1], { id: 'entanglement' }, () => {}, player, { session, applicationEventId: batchId });
    expect(player.turnMeter).toBe(200);
    session.state.enemies[1].entanglementImmune = true;
    addEffect(session.state.enemies[1], { id: 'entanglement' }, () => {}, player, { session });
    expect(player.turnMeter).toBe(200);
  });

  test('III: source-agnostic successful events grant +10% TM without cooldown', () => {
    const session = makeSession(3);
    const player = hero(session);
    player.turnMeter = 0;
    addEffect(player, { id: 'entanglement' }, () => {}, session.state.enemies[0], { session });
    addEffect(session.state.enemies[0], { id: 'entanglement' }, () => {}, session.state.enemies[1], { session });
    expect(player.turnMeter).toBe(200);
  });

  test('III: global trigger is deterministic in [4,8], runs once, and excludes combat objects', () => {
    expect(WITHERING_GLOBAL_TURN_MIN).toBe(4);
    expect(WITHERING_GLOBAL_TURN_MAX).toBe(8);
    expect(makeSession(3, { rng: () => 0 }).state._witheringGlobalTriggerTurn).toBe(4);
    expect(makeSession(3, { rng: () => 0.999 }).state._witheringGlobalTriggerTurn).toBe(8);
    const session = makeSession(3, { rng: () => 0 });
    const object = { id: 'object', name: 'Объект', hp: 1, maxHp: 1, effects: [], nonActingCombatObject: true };
    session.state.enemies.push(object);
    takeTurn(session);
    hero(session).turnMeter = 0;
    while (session.state._witheringCompletedTurns < 4) complete(session, session.state.enemies[0]);
    expect(session.state._witheringGlobalTriggered).toBe(true);
    expect(getEffectStackCount(object, 'entanglement')).toBe(0);
    expect(session.state.log.filter(line => line.includes('[Общая сеть]'))).toHaveLength(1);
  });

  test('IV: global batch adds two stacks while producing only one reward', () => {
    const session = makeSession(4, { rng: () => 0 });
    takeTurn(session);
    const first = session.state.enemies[0];
    const second = session.state.enemies[1];
    addEffect(first, { id: 'entanglement', stacks: 5 }, () => {}, hero(session), { session });
    hero(session).turnMeter = 0;
    while (session.state._witheringCompletedTurns < 4) complete(session, first);
    expect(getEffectStackCount(second, 'entanglement')).toBe(2);
    expect(hero(session).turnMeter).toBe(100);
  });

  test('IV: outgoing bonus counts living entangled enemies, not stacks, and never buffs summons', () => {
    const session = makeSession(4, { hero: { hp: 100 } });
    const [first, second] = session.state.enemies;
    addEffect(first, { id: 'entanglement', stacks: 5 }, () => {}, hero(session), { session });
    const hp1 = first.hp;
    applyDamage(first, 100, 'physical', { source: hero(session), session });
    expect(hp1 - first.hp).toBe(108);
    addEffect(second, { id: 'entanglement' }, () => {}, hero(session), { session });
    const hp2 = first.hp;
    applyDamage(first, 100, 'physical', { source: hero(session), session });
    expect(hp2 - first.hp).toBe(116);
    second.hp = 0;
    const hp3 = first.hp;
    applyDamage(first, 100, 'physical', { source: hero(session), session });
    expect(hp3 - first.hp).toBe(108);
    const summon = { id: 'summon', hp: 10, summoned: true };
    const hp4 = first.hp;
    applyDamage(first, 100, 'physical', { source: summon, session });
    expect(hp4 - first.hp).toBe(100);
  });

  test('V: one multi-stack event replaces III reward with +20% TM and 8% healing; separate events repeat', () => {
    const session = makeSession(5, { hero: { hp: 50 } });
    const player = hero(session);
    expect(player.hp).toBe(55); // Symbiosis first.
    player.turnMeter = 0;
    addEffect(session.state.enemies[0], { id: 'entanglement', stacks: 2 }, () => {}, player, { session });
    expect(player.turnMeter).toBe(200);
    expect(player.hp).toBe(63);
    addEffect(session.state.enemies[1], { id: 'entanglement' }, () => {}, session.state.enemies[0], { session });
    expect(player.turnMeter).toBe(400);
    expect(player.hp).toBe(71);
  });

  test('tiers are isolated and runtime state resets in every new combat', () => {
    const plain = makeSession(0);
    expect(hero(plain).hp).toBe(90);
    expect(hero(plain).speed).toBe(100);
    const tierOne = makeSession(1);
    takeTurn(tierOne);
    expect(getEffectStackCount(hero(tierOne), 'entanglement')).toBe(0);
    const fresh = makeSession(3);
    expect(fresh.state._witheringCompletedTurns).toBe(0);
    expect(fresh.state._witheringGlobalTriggered).toBe(false);
  });
});
