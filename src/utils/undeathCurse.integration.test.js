import { createAbilityByName } from '../data/abilityPresets';
import { applyDamage, applyHealing, getEffectiveSpeed, initCombatSession, performPlayerAction } from './combatUtils';
import { addEffect, getEffectStackCount } from './effects';
import { beginCombatPresentation, consumeCombatPresentationEvents } from './combatPresentationEvents';

const strike = { name: 'Удар души', targeting: 'enemy', accuracy: 1, cooldown: 0, damage: 100, type: 'physical' };
const attack = () => ({ ...createAbilityByName('Атака', 100), accuracy: 1 });
const makeSession = (tier = 1, overrides = {}) => initCombatSession({
  name: 'Некромант', hp: 500, maxHp: 500, attack: 100, speed: 100, critChance: 0,
  curses: tier ? { undeath: { tier } } : {}, abilities: [attack(), strike], ...overrides,
}, [{ name: 'Манекен', hp: 5000, maxHp: 5000, attack: 20, speed: 1, physDef: 0, abilities: [] }], { rng: () => 0.99 });
const act = (session, name = 'Удар души') => {
  session.state.turnState = null;
  session.state.initiative.playerReady = true;
  return performPlayerAction(session, name, 0);
};

describe('Несмертие I–V', () => {
  test('I: first nonbasic ability schedules one canonical 40% Echo; basic does not consume it', () => {
    const session = makeSession(1);
    const hero = session.state.players[0];
    act(session, 'Атака');
    expect(hero._undeathFirstEchoUsed).toBe(false);
    act(session);
    expect(hero._pendingRuinsEcho.efficiency).toBe(0.4);
    act(session);
    expect(hero._undeathFirstEchoUsed).toBe(true);
  });

  test('III: hero Echo is raised to 60%, resolves without recursion, and applies canonical Slow', () => {
    const session = makeSession(3);
    const hero = session.state.players[0];
    act(session);
    expect(hero._pendingRuinsEcho.efficiency).toBe(0.6);
    beginCombatPresentation(session);
    act(session);
    const events = consumeCombatPresentationEvents(session);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'procTriggered',
        procKind: 'curse',
        procId: 'undeath_echo',
        label: 'Эхо',
        efficiency: 0.6,
      }),
    ]));
    expect(getEffectStackCount(hero, 'speed_penalty_minor')).toBe(1);
    expect(hero._pendingRuinsEcho).toBeUndefined();
  });

  test('II: newly received shields are reduced by 10%, existing shield is untouched', () => {
    const session = makeSession(2);
    const hero = session.state.players[0];
    hero.shield = 20;
    addEffect(hero, { id: 'shield', duration: 2, value: 100 }, () => {}, hero, { session, forceIndependentInstance: true });
    expect(hero.shield).toBe(110);
  });

  test('IV: max HP and outgoing damage are combat-only modifiers', () => {
    const session = makeSession(4);
    const hero = session.state.players[0];
    const enemy = session.state.enemies[0];
    expect(hero.maxHp).toBe(575);
    expect(hero.baseStats.maxHp).toBe(500);
    const before = enemy.hp;
    applyDamage(enemy, 100, 'physical', { source: hero, session });
    expect(before - enemy.hp).toBe(110);
  });

  test('V: first lethal damage saves at 1 HP and cleanses removable debuffs; second kills', () => {
    const session = makeSession(5, { hp: 100, maxHp: 100 });
    const hero = session.state.players[0];
    const enemy = session.state.enemies[0];
    addEffect(hero, { id: 'speed_penalty_minor', duration: 2 }, () => {}, enemy, { session });
    applyDamage(hero, 999, 'pure', { source: enemy, session, isPeriodic: true, fromEffect: 'bleed' });
    expect(hero.hp).toBe(1);
    expect(getEffectStackCount(hero, 'speed_penalty_minor')).toBe(0);
    applyDamage(hero, 999, 'pure', { source: enemy, session, isPeriodic: true, fromEffect: 'bleed' });
    expect(hero.hp).toBe(0);
  });

  test('V: low-health penalty is linear for Speed and incoming healing', () => {
    const session = makeSession(5, { hp: 28.75, maxHp: 100 });
    const hero = session.state.players[0];
    expect(getEffectiveSpeed(hero, session)).toBeCloseTo(85, 0);
    expect(applyHealing(hero, 20, { source: hero, session })).toBe(17);
  });
});
