import { addEffect } from './effects';
import { initCombatSession, processEnemyAI } from './combatUtils';

const basic = { name: 'Атака', basic: true, damage: 10, cooldown: 0, alwaysHits: true };
const special = { name: 'Особый удар', damage: 40, cooldown: 2, alwaysHits: true };

const make = () => {
  const session = initCombatSession({
    name: 'Герой', hp: 100, maxHp: 100, attack: 5, speed: 1,
    physDef: 0, magicDef: 0, abilities: [basic],
  }, [{
    name: 'Манекен', hp: 200, maxHp: 200, attack: 1, speed: 1,
    physDef: 0, magicDef: 0, abilities: [basic],
  }], { rng: () => 0.99 });
  const ally = {
    id: 'ally-test', name: 'Призванный союзник', summoned: true,
    hp: 100, maxHp: 100, attack: 10, magAtk: 0, speed: 100,
    physDef: 0, magicDef: 0, effects: [], abilities: [{ ...special }, { ...basic }],
    turnMeter: 1000,
  };
  session.state.players.push(ally);
  // Stop processEnemyAI immediately after this summon turn by making the hero next.
  session.state.players[0].turnMeter = 999;
  session.state.enemies[0].turnMeter = 0;
  session.state.initiative.playerReady = false;
  return { session, ally, enemy: session.state.enemies[0] };
};

describe('friendly summon effect-turn phases', () => {
  test('a stunned summon skips its action and still completes end-of-turn expiry', () => {
    const { session, ally, enemy } = make();
    addEffect(ally, { id: 'stun', duration: 1 }, () => {}, enemy, { session });
    const before = enemy.hp;
    processEnemyAI(session);
    expect(enemy.hp).toBe(before);
    expect(ally.effects.some(effect => effect.id === 'stun')).toBe(false);
    expect(ally._effectTurnActive).toBe(false);
  });

  test('Shock skip is honored and its one-turn status expires at the summon turn end', () => {
    const { session, ally, enemy } = make();
    addEffect(ally, { id: 'shock', duration: 1, extra: { skipChance: 1 } }, () => {}, enemy, { session });
    const before = enemy.hp;
    session.rng = () => 0;
    processEnemyAI(session);
    expect(enemy.hp).toBe(before);
    expect(ally.pendingShockSkip).toBe(false);
    expect(ally.effects.some(effect => effect.id === 'shock')).toBe(false);
    expect(ally._effectTurnActive).toBe(false);
  });

  test('Silence remains active through the summon turn and forces its ready basic attack', () => {
    const { session, ally, enemy } = make();
    addEffect(ally, { id: 'silence', duration: 1 }, () => {}, enemy, { session });
    const before = enemy.hp;
    processEnemyAI(session);
    expect(enemy.hp).toBeLessThan(before);
    expect(ally.abilities.find(ability => ability.name === 'Особый удар').currentCooldown || 0).toBe(0);
    expect(ally.effects.some(effect => effect.id === 'silence')).toBe(false);
    expect(ally._effectTurnActive).toBe(false);
  });
});
