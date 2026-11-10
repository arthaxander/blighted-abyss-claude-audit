import { addEffect, getEffectDefinition, getEffectStackCount, getEffectDurationLabel } from './effects';
import { completeEntanglementTurn, getEffectiveSpeed, initCombatSession, performPlayerAction } from './combatUtils';

const hero = () => ({
  name: 'Герой', hp: 200, maxHp: 200, attack: 20, magAtk: 5, physDef: 0, magicDef: 0,
  speed: 100, currentLocation: 'Гоблинские Норы',
  abilities: [{ name: 'Атака', basic: true, cooldown: 0, damage: 10, type: 'physical', alwaysHits: true }],
});
const createSession = () => initCombatSession(hero(), [
  { name: 'Учебный враг', hp: 1000, maxHp: 1000, attack: 1, speed: 10 },
], { rng: () => 0.99 });

// These tests must run after scripts/recover-withering-entanglement.mjs patches the
// canonical engine. They are intentionally NOT proof that the WIP is merge-ready.
describe('Withering Forest Entanglement canonical integration', () => {
  test('status registration caps at five actual instances and has no duration', () => {
    const unit = { name: 'Цель', speed: 100, effects: [] };
    expect(getEffectDefinition('entanglement')).toEqual(expect.objectContaining({
      id: 'entanglement', maxStacks: 5, persistent: true,
    }));
    addEffect(unit, { id: 'entanglement', stacks: 7 }, () => {});
    expect(getEffectStackCount(unit, 'entanglement')).toBe(5);
    expect(unit.effects.filter(effect => effect.id === 'entanglement')).toHaveLength(5);
    expect(getEffectDurationLabel(unit.effects.find(effect => effect.id === 'entanglement'))).toBeNull();
    expect(getEffectiveSpeed(unit)).toBe(70);
  });

  test('speed recalculates from canonical haste/slow without compounding', () => {
    const unit = { name: 'Цель', speed: 100, effects: [] };
    addEffect(unit, { id: 'entanglement', stacks: 5 }, () => {});
    addEffect(unit, { id: 'speed_boost_minor' }, () => {});
    expect(getEffectiveSpeed(unit)).toBe(81);
    expect(getEffectiveSpeed(unit)).toBe(81);
    addEffect(unit, { id: 'speed_penalty_minor' }, () => {});
    expect(getEffectiveSpeed(unit)).toBe(64);
    expect(getEffectiveSpeed(unit)).toBe(64);
  });

  test('a completed player action decays Entanglement only on every second own turn', () => {
    const session = createSession();
    const player = session.state.players[0];
    addEffect(player, { id: 'entanglement', stacks: 3 }, () => {});
    session.state.initiative.playerReady = true;
    expect(performPlayerAction(session, 'Атака', 0).turnConsumed).toBe(true);
    expect(getEffectStackCount(player, 'entanglement')).toBe(3);
    session.state.initiative.playerReady = true;
    expect(performPlayerAction(session, 'Атака', 0).turnConsumed).toBe(true);
    expect(getEffectStackCount(player, 'entanglement')).toBe(2);
  });

  test('a control-skipped own turn advances the same two-turn decay cadence', () => {
    const session = createSession();
    const player = session.state.players[0];
    addEffect(player, { id: 'entanglement', stacks: 3 }, () => {});
    addEffect(player, { id: 'stun', duration: 1 }, () => {});
    session.state.initiative.playerReady = true;
    expect(performPlayerAction(session, 'Атака', 0).turnConsumed).toBe(true);
    expect(getEffectStackCount(player, 'entanglement')).toBe(3);
    session.state.initiative.playerReady = true;
    expect(performPlayerAction(session, 'Атака', 0).turnConsumed).toBe(true);
    expect(getEffectStackCount(player, 'entanglement')).toBe(2);
  });

  test('a fresh Entanglement chain resets the two-turn decay cadence', () => {
    const unit = { name: 'Цель', speed: 100, effects: [] };
    addEffect(unit, { id: 'entanglement', stacks: 2 }, () => {});
    expect(completeEntanglementTurn(unit)).toBe(2);
    expect(unit._entanglementDecayTurns).toBe(1);
    unit.effects = unit.effects.filter(effect => effect.id !== 'entanglement');
    addEffect(unit, { id: 'entanglement' }, () => {});
    expect(unit._entanglementDecayTurns).toBe(0);
    expect(completeEntanglementTurn(unit)).toBe(1);
  });

  test('invalid action and not-ready player do not consume stacks', () => {
    const session = createSession();
    const player = session.state.players[0];
    addEffect(player, { id: 'entanglement', stacks: 2 }, () => {});
    session.state.initiative.playerReady = false;
    expect(performPlayerAction(session, 'Атака', 0).turnConsumed).toBe(false);
    session.state.initiative.playerReady = true;
    expect(performPlayerAction(session, 'Неизвестная способность', 0).turnConsumed).toBe(false);
    expect(getEffectStackCount(player, 'entanglement')).toBe(2);
  });

  test('standalone end-turn completion and restored effects preserve other statuses', () => {
    const unit = JSON.parse(JSON.stringify({
      name: 'Цель', speed: 100,
      effects: [{ id: 'entanglement', persistent: true }, { id: 'entanglement', persistent: true },
        { id: 'poison', remainingTurns: 3 }],
    }));
    expect(completeEntanglementTurn(unit)).toBe(2);
    expect(getEffectStackCount(unit, 'entanglement')).toBe(2);
    expect(unit.effects.find(effect => effect.id === 'poison').remainingTurns).toBe(3);
    expect(completeEntanglementTurn(unit)).toBe(1);
    expect(completeEntanglementTurn(unit)).toBe(1);
    expect(completeEntanglementTurn(unit)).toBe(0);
  });
});
