import { addEffect, getEffectStackCount, processEffects, finishEffectTurn } from './effects';
import { completeEntanglementTurn, initCombatSession, performPlayerAction } from './combatUtils';

const unit = () => ({
  name: 'Тестовый герой', hp: 100, maxHp: 100, attack: 20, magAtk: 20,
  physDef: 0, magicDef: 0, speed: 100, effects: [],
});
const noop = () => {};

// These are acceptance tests for the approved global timing migration.
// Do not merge the recovery PR until the integration and full-suite checks pass.
describe('canonical effect turn phases', () => {
  test('a one-turn buff survives turn start and expires only after the action', () => {
    const actor = unit();
    addEffect(actor, { id: 'attack_boost_minor', duration: 1 }, noop);
    expect(actor.attack).toBe(25);
    processEffects(actor, noop);
    expect(actor.attack).toBe(25);
    expect(actor.effects.find(effect => effect.id === 'attack_boost_minor').remainingTurns).toBe(1);
    finishEffectTurn(actor, noop);
    expect(actor.effects.some(effect => effect.id === 'attack_boost_minor')).toBe(false);
    expect(actor.attack).toBe(20);
  });

  test('self-applied and refreshed buffs are not instantly decremented', () => {
    const actor = unit();
    processEffects(actor, noop);
    addEffect(actor, { id: 'attack_boost_minor', duration: 1 }, noop);
    finishEffectTurn(actor, noop);
    expect(actor.effects.find(effect => effect.id === 'attack_boost_minor').remainingTurns).toBe(1);
    processEffects(actor, noop);
    finishEffectTurn(actor, noop);
    expect(actor.effects.some(effect => effect.id === 'attack_boost_minor')).toBe(false);

    addEffect(actor, { id: 'attack_boost_minor', duration: 1 }, noop);
    processEffects(actor, noop);
    addEffect(actor, { id: 'attack_boost_minor', duration: 2 }, noop);
    finishEffectTurn(actor, noop);
    expect(actor.effects.find(effect => effect.id === 'attack_boost_minor').remainingTurns).toBe(2);
  });

  test('two-turn debuff remains active until each own-turn end, including a skipped turn', () => {
    const actor = unit();
    addEffect(actor, { id: 'attack_penalty_minor', duration: 2 }, noop);
    processEffects(actor, noop);
    expect(actor.attack).toBe(15);
    finishEffectTurn(actor, noop);
    expect(actor.effects.find(effect => effect.id === 'attack_penalty_minor').remainingTurns).toBe(1);
    processEffects(actor, noop);
    expect(actor.attack).toBe(15);
    finishEffectTurn(actor, noop);
    expect(actor.attack).toBe(20);
  });

  test('regeneration ticks and expires at start, never a second time at end', () => {
    const actor = unit();
    actor.hp = 20;
    addEffect(actor, { id: 'regeneration', duration: 2 }, noop);
    processEffects(actor, noop);
    expect(actor.hp).toBe(35);
    expect(actor.effects.find(effect => effect.id === 'regeneration').remainingTurns).toBe(1);
    finishEffectTurn(actor, noop);
    expect(actor.hp).toBe(35);
    expect(actor.effects.find(effect => effect.id === 'regeneration').remainingTurns).toBe(1);
    processEffects(actor, noop);
    expect(actor.hp).toBe(50);
    expect(actor.effects.some(effect => effect.id === 'regeneration')).toBe(false);
    finishEffectTurn(actor, noop);
    expect(actor.hp).toBe(50);
  });

  test('poison retains two beginning-of-turn damage ticks and expiration', () => {
    const actor = unit();
    const source = { name: 'Отравитель', attack: 20, magAtk: 0 };
    addEffect(actor, { id: 'poison', duration: 2 }, noop, source);
    const initialHp = actor.hp;
    processEffects(actor, noop);
    const afterFirst = actor.hp;
    expect(afterFirst).toBeLessThan(initialHp);
    expect(actor.effects.find(effect => effect.id === 'poison').remainingTurns).toBe(1);
    finishEffectTurn(actor, noop);
    expect(actor.hp).toBe(afterFirst);
    processEffects(actor, noop);
    expect(actor.hp).toBeLessThan(afterFirst);
    expect(actor.effects.some(effect => effect.id === 'poison')).toBe(false);
  });

  test('prepared Ram resolves exactly once at the beginning of the owner turn', () => {
    const actor = unit();
    const enemy = { name: 'Мишень', hp: 100, maxHp: 100, effects: [] };
    let strikes = 0;
    addEffect(actor, { id: 'defender_ram_prepared', duration: 1, extra: { damage: 15 } }, noop, actor);
    processEffects(actor, noop, {
      getOpponents: () => [enemy],
      applyDamage: target => { strikes += 1; target.hp -= 15; return 15; },
    });
    expect(strikes).toBe(1);
    expect(actor.effects.some(effect => effect.id === 'defender_ram_prepared')).toBe(false);
    finishEffectTurn(actor, noop);
    processEffects(actor, noop, { getOpponents: () => [enemy] });
    expect(strikes).toBe(1);
  });

  test('new Entanglement is protected while an older stack can decay', () => {
    const actor = unit();
    addEffect(actor, { id: 'entanglement' }, noop);
    // The old stack has already survived one completed own turn and is due to
    // decay at the end of the next one.
    expect(completeEntanglementTurn(actor)).toBe(1);
    processEffects(actor, noop);
    addEffect(actor, { id: 'entanglement' }, noop);
    expect(getEffectStackCount(actor, 'entanglement')).toBe(2);
    expect(completeEntanglementTurn(actor)).toBe(1);
    expect(getEffectStackCount(actor, 'entanglement')).toBe(1);
    processEffects(actor, noop);
    expect(completeEntanglementTurn(actor)).toBe(1);
    processEffects(actor, noop);
    expect(completeEntanglementTurn(actor)).toBe(0);
  });

  test('Forest root earned from the killing action survives that action end', () => {
    const session = initCombatSession({
      name: 'Герой', hp: 200, maxHp: 200, attack: 150, magAtk: 10,
      speed: 100, currentLocation: 'Лес Увядания',
      abilities: [{ name: 'Удар', basic: true, cooldown: 0, damage: 1000, type: 'physical', alwaysHits: true }],
    }, [
      { name: 'Враг 1', hp: 20, maxHp: 20, speed: 10, attack: 1 },
      { name: 'Враг 2', hp: 20, maxHp: 20, speed: 10, attack: 1 },
    ], { rng: () => 0.99 });
    session.state.initiative.playerReady = true;
    expect(performPlayerAction(session, 'Удар', 0).turnConsumed).toBe(true);
    expect(getEffectStackCount(session.state.players[0], 'entanglement')).toBe(1);
  });
});
