import { createAutobattleCheckpoint, calculateAutobattle, chooseAutobattleResult, getAutobattleConsumables } from './autobattle';
import { createSimulationPlayer, chooseCombatAction } from './combatSimulator';
import { createAbilityByName } from '../data/abilityPresets';
import { createEnemyInstanceByName } from '../data/enemies';
import { reviveCombatSession } from './combatHydration';
import { executeCombatCommand } from './combatExecution';
import { snapshotCombatSession } from './combatSnapshot';

const copy = value => JSON.parse(JSON.stringify(value));
const initial = (attack = 2) => createAutobattleCheckpoint(
  createSimulationPlayer({ classId: 'Mage', hp: 40, abilityIds: ['Огненный шар', 'Атака'], items: [{ name: 'Малое зелье здоровья' }] }),
  [{ id: 'foe', name: 'Манекен', hp: 80, maxHp: 80, attack, speed: 80, abilities: [createAbilityByName('Атака', attack)] }], false, 42,
);

it.each([2, 999])('keeps the original state and gives the same outcome after reload (attack %s)', async attack => {
  const start = initial(attack); const before = copy(start);
  const first = await calculateAutobattle(start, chooseCombatAction);
  const second = await calculateAutobattle(copy(start), chooseCombatAction);
  expect(first.autobattle.outcome).toBe(attack === 999 ? 'defeat' : 'victory');
  expect(start).toEqual(before);
  expect(first).toEqual(second);
  expect(first.battleResult).toBeUndefined();
  expect(first.autobattle.result.state.encounterReward.resolvedLoot).toBeNull();
  const manual = chooseAutobattleResult(copy(first), 'manual');
  expect(manual.state).toEqual(start.state);
  expect(manual.rngState).toBe(start.rngState);
  expect(manual.autobattle).toEqual({ version: 1, phase: 'manual' });
  expect(() => chooseAutobattleResult(manual, 'accepted')).toThrow(/already/);
  const accepted = chooseAutobattleResult(first, 'accepted');
  expect(accepted.state).toEqual(first.autobattle.result.state);
  expect(accepted.autobattle.result).toBeUndefined();
});

it('resumes summons against the live restored state without mutating the saved checkpoint', () => {
  const start = createAutobattleCheckpoint(createSimulationPlayer({ classId: 'Mage', abilityIds: ['Призыв элементаля', 'Атака'] }), [createEnemyInstanceByName('Троглодит-заражённый')], false, 42);
  const original = copy(start);
  const session = reviveCombatSession(start);
  executeCombatCommand(session, { kind: 'advance' });
  executeCombatCommand(session, { kind: 'ability', name: 'Призыв элементаля' });
  expect(session.state.players.some(unit => unit.summoned)).toBe(true);
  expect(start).toEqual(original);
  const saved = snapshotCombatSession(session);
  const restored = reviveCombatSession(copy(saved));
  expect(restored.rng.getState()).toBe(session.rng.getState());
  expect(restored.state.players.map(unit => unit.id)).toEqual(session.state.players.map(unit => unit.id));
});

it('reports consumed items and refuses incomplete or invalid acceptance', async () => {
  const start = initial();
  expect(() => chooseAutobattleResult(start, 'accepted')).toThrow(/completed/);
  expect(() => chooseAutobattleResult(start, 'cancel')).toThrow(/Invalid/);
  const result = await calculateAutobattle(start, chooseCombatAction);
  const spent = getAutobattleConsumables(result);
  expect(spent.every(item => item.count > 0)).toBe(true);
  await expect(calculateAutobattle(start, () => null)).rejects.toThrow(/legal/);
});
