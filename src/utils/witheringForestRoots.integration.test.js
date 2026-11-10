import { addEffect, getEffectStackCount } from './effects';
import { applyDamage, initCombatSession, performPlayerAction } from './combatUtils';
import { beginForestRootsAction, endForestRootsAction } from './witheringForestRoots';

const makeSession = (location = 'Лес Увядания', abilities = null) => initCombatSession({
  name: 'Герой', hp: 200, maxHp: 200, attack: 150, magAtk: 30,
  physDef: 0, magicDef: 0, speed: 100, currentLocation: location,
  abilities: abilities || [{ name: 'Атака', basic: true, cooldown: 0, damage: 20, type: 'physical', alwaysHits: true }],
}, [
  { name: 'Первый', hp: 30, maxHp: 30, attack: 1, speed: 10, physDef: 0, magicDef: 0 },
  { name: 'Второй', hp: 30, maxHp: 30, attack: 1, speed: 10, physDef: 0, magicDef: 0 },
  { name: 'Третий', hp: 30, maxHp: 30, attack: 1, speed: 10, physDef: 0, magicDef: 0 },
], { rng: () => 0.99 });

const kill = (session, target, action = null, originActionId = null) => applyDamage(target, 1000, 'pure', {
  source: session.state.players[0], session, logFn: () => {},
  deliberateAction: action, originActionId, directAttack: true,
});
const stacks = session => getEffectStackCount(session.state.players[0], 'entanglement');
const count = session => session.state.witheringForestRoots?.triggeredOrigins?.length || 0;

describe('Roots of the Fallen: combat integration', () => {
  test('two kills from one originating action apply only one stack; another action applies another', () => {
    const session = makeSession();
    const action = { actorId: session.state.players[0].id, ability: 'Размашистый удар' };
    kill(session, session.state.enemies[0], action);
    expect(stacks(session)).toBe(1);
    kill(session, session.state.enemies[1], action);
    expect(stacks(session)).toBe(1);
    expect(count(session)).toBe(1);
    kill(session, session.state.enemies[2], { actorId: session.state.players[0].id, ability: 'Новый удар' });
    expect(stacks(session)).toBe(2);
    expect(count(session)).toBe(2);
  });

  test('enemy summons count, hero summons and enemy combat objects do not', () => {
    const session = makeSession();
    session.state.enemies[0].rewardBearing = false;
    session.state.enemies[0].summonOnly = true;
    const ally = { id: 'friendly-summon', name: 'Союзный призыв', hp: 5, maxHp: 5, effects: [] };
    session.state.players.push(ally);
    kill(session, ally);
    expect(count(session)).toBe(0);
    const object = session.state.enemies[1];
    object.nonActingCombatObject = true;
    object.hp = 0;
    expect(count(session)).toBe(0);
    kill(session, session.state.enemies[0]);
    expect(stacks(session)).toBe(1);
    expect(count(session)).toBe(1);
  });

  test('other locations are unaffected', () => {
    const session = makeSession('Гоблинские Норы');
    kill(session, session.state.enemies[0]);
    expect(stacks(session)).toBe(0);
    expect(session.state.witheringForestRoots).toBeUndefined();
  });

  test('first death consumes origin even if debuff application is blocked', () => {
    const session = makeSession();
    const hero = session.state.players[0];
    hero.blockDebuffs = true;
    const action = {};
    kill(session, session.state.enemies[0], action);
    expect(stacks(session)).toBe(0);
    expect(count(session)).toBe(1);
    hero.blockDebuffs = false;
    kill(session, session.state.enemies[1], action);
    expect(stacks(session)).toBe(0);
    kill(session, session.state.enemies[2], {});
    expect(stacks(session)).toBe(1);
  });

  test('five-charge cap holds even for a serialized multi-stack instance', () => {
    const session = makeSession();
    session.state.players[0].effects.push({ id: 'entanglement', stacks: 5, persistent: true });
    kill(session, session.state.enemies[0]);
    expect(stacks(session)).toBe(5);
    expect(count(session)).toBe(1);
  });

  test('shared poison cast retains dedupe origin across a JSON save and multiple later deaths', () => {
    const session = makeSession();
    const hero = session.state.players[0];
    const origin = beginForestRootsAction(session);
    expect(origin).toEqual(expect.any(String));
    const first = addEffect(session.state.enemies[0], { id: 'poison', duration: 3 }, () => {}, hero, { session });
    const second = addEffect(session.state.enemies[1], { id: 'poison', duration: 3 }, () => {}, hero, { session });
    expect(first.metadata.forestOriginId).toBe(origin);
    expect(second.metadata.forestOriginId).toBe(origin);
    endForestRootsAction(session, origin);
    const persisted = JSON.parse(JSON.stringify({
      roots: session.state.witheringForestRoots,
      firstOrigin: first.metadata.forestOriginId,
      secondOrigin: second.metadata.forestOriginId,
    }));
    session.state.witheringForestRoots = persisted.roots;
    kill(session, session.state.enemies[0], null, persisted.firstOrigin);
    expect(stacks(session)).toBe(1);
    kill(session, session.state.enemies[1], null, persisted.secondOrigin);
    expect(stacks(session)).toBe(1);
    expect(count(session)).toBe(1);
    kill(session, session.state.enemies[2]);
    expect(stacks(session)).toBe(2);
  });

  test('confirmed death is required: shields, nonlethal damage and a second hit on corpse do not count', () => {
    const session = makeSession();
    const target = session.state.enemies[0];
    applyDamage(target, 1, 'pure', { session, source: session.state.players[0], logFn: () => {} });
    expect(count(session)).toBe(0);
    kill(session, target);
    expect(count(session)).toBe(1);
    kill(session, target);
    expect(count(session)).toBe(1);
  });

  test('real hero action uses one origin for multiple lethal AoE packets', () => {
    const session = makeSession('Лес Увядания', [{
      name: 'Тестовая буря', basic: false, cooldown: 0, damage: 1000,
      type: 'physical', targeting: 'allEnemies', alwaysHits: true,
    }]);
    session.state.initiative.playerReady = true;
    const result = performPlayerAction(session, 'Тестовая буря', 0);
    expect(result.turnConsumed).toBe(true);
    expect(session.state.enemies.every(enemy => enemy.hp <= 0)).toBe(true);
    expect(count(session)).toBe(1);
    expect(session.state._forestRootsActiveOrigin).toBeUndefined();
    // Newly earned stacks are protected from the current action end phase.
    expect(stacks(session)).toBe(1);
  });
});
