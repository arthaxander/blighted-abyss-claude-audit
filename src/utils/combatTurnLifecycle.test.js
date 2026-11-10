import { ABILITY_LIBRARY } from '../data/abilityPresets';
import { addEffect } from './effects';
import { initCombatSession, performPlayerAction, processEnemyAI } from './combatUtils';

const basic = { name: 'Атака', basic: true, damage: 1, cooldown: 0, alwaysHits: true };
const makePlayer = (abilities = [basic]) => ({ name: 'Защитник', hp: 100, maxHp: 100, attack: 5, speed: 100, physDef: 0, magicDef: 0, abilities });
const makeEnemy = (overrides = {}) => ({ name: 'Манекен', hp: 100, maxHp: 100, attack: 1, speed: 1, physDef: 0, magicDef: 0, abilities: [basic], ...overrides });
const selectPlayer = session => {
  session.state.players[0].turnMeter = 1000;
  session.state.enemies.forEach(enemy => { enemy.turnMeter = 0; });
  session.state.initiative.playerReady = false;
  processEnemyAI(session);
};
const selectEnemy = (session, enemy) => {
  session.state.players[0].turnMeter = 0;
  enemy.turnMeter = 1000;
  session.state.initiative.playerReady = false;
  processEnemyAI(session);
};

describe('single-owner acting-turn lifecycle', () => {
  test('one player boundary ticks cooldown 2 to 1 and action does not tick it again', () => {
    const session = initCombatSession(makePlayer([{ name: 'Ожидание', damage: 0, cooldown: 4, targeting: 'self' }, basic]), [makeEnemy()]);
    const cooldownAbility = session.state.players[0].abilities[0];
    cooldownAbility.currentCooldown = 2;

    selectPlayer(session);
    expect(cooldownAbility.currentCooldown).toBe(1);
    expect(session.state.initiative.playerReady).toBe(true);

    performPlayerAction(session, 'Атака', 0);
    expect(cooldownAbility.currentCooldown).toBe(1);
  });

  test('cooldown 1 becomes 0 at exactly one player boundary', () => {
    const session = initCombatSession(makePlayer([{ name: 'Ожидание', damage: 0, cooldown: 4, targeting: 'self' }, basic]), [makeEnemy()]);
    session.state.players[0].abilities[0].currentCooldown = 1;
    selectPlayer(session);
    expect(session.state.players[0].abilities[0].currentCooldown).toBe(0);
  });

  test('Endurance shield and protection durations tick once and not again on action', () => {
    const endurance = { ...ABILITY_LIBRARY['Стойкость'] };
    const session = initCombatSession(makePlayer([endurance, basic]), [makeEnemy()]);
    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Стойкость', 0);
    const player = session.state.players[0];
    expect(player.effects.filter(effect => ['shield', 'phys_def_boost_major'].includes(effect.id)).map(effect => effect.remainingTurns)).toEqual([3, 3]);

    selectPlayer(session);
    // The current owner's active statuses keep their full duration at turn start.
    expect(player.effects.filter(effect => ['shield', 'phys_def_boost_major'].includes(effect.id)).map(effect => effect.remainingTurns)).toEqual([3, 3]);
    performPlayerAction(session, 'Атака', 0);
    // End-of-turn expiry happens once, after the action rather than at readiness.
    expect(player.effects.filter(effect => ['shield', 'phys_def_boost_major'].includes(effect.id)).map(effect => effect.remainingTurns)).toEqual([2, 2]);
  });

  test('nonlethal periodic effects run once before readiness', () => {
    let passiveStarts = 0;
    const passive = { name: 'Счётчик начала хода', passive: true, onTurnStart: () => { passiveStarts += 1; } };
    const session = initCombatSession(makePlayer([basic, passive]), [makeEnemy()]);
    const player = session.state.players[0];
    addEffect(player, { id: 'poison', duration: 2 }, () => {}, { attack: 1 }, { session });
    selectPlayer(session);
    expect(player.effects.find(effect => effect.id === 'poison')?.remainingTurns).toBe(1);
    expect(session.state.initiative.playerReady).toBe(true);
    expect(passiveStarts).toBe(1);
    performPlayerAction(session, 'Атака', 0);
    expect(passiveStarts).toBe(1);
    expect(player.effects.find(effect => effect.id === 'poison')?.remainingTurns).toBe(1);
  });

  test('enemy cooldown and a summoned enemy effect tick exactly once per acting turn', () => {
    const special = { name: 'Рывок', damage: 1, cooldown: 2, alwaysHits: true };
    const session = initCombatSession(makePlayer(), [makeEnemy({ id: 'summon-1', speed: 1, abilities: [special, basic] })]);
    const summon = session.state.enemies[0];
    addEffect(summon, { id: 'regeneration', duration: 2 }, () => {}, summon, { session });
    selectEnemy(session, summon);
    expect(summon.abilities[0].currentCooldown).toBe(2);
    expect(summon.effects.find(effect => effect.id === 'regeneration')?.remainingTurns).toBe(1);
    selectEnemy(session, summon);
    expect(summon.abilities[0].currentCooldown).toBe(1);
    expect(summon.effects.some(effect => effect.id === 'regeneration')).toBe(false);
  });
});
