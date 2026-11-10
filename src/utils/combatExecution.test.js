import { createEnemyInstanceByName } from '../data/enemies';
import { resolveSimulationPlayerProfile } from './simulationPlayerProfiles';
import { createAbilityByName } from '../data/abilityPresets';
import { initCombatSession, processEnemyAI, performPlayerAction, applyItemInCombat } from './combatUtils';
import { createCombatRecording, executeCombatCommand, replayCombatRecording, snapshotCombatExecution } from './combatExecution';
import { createSimulationPlayer, simulateCombat } from './combatSimulator';
import { createSeededSimulationRng } from './simulationRng';

const dummy = () => ({ id: 'dummy', name: 'Манекен', hp: 450, maxHp: 450, attack: 4, speed: 70, physDef: 0, magicDef: 0, abilities: [createAbilityByName('Атака', 4)] });
const hero = () => createSimulationPlayer({ classId: 'Mage', hp: 60, abilityIds: ['Огненный шар', 'Призыв элементаля', 'Атака'], items: [{ name: 'Малое зелье здоровья' }] });
const fresh = (seed = 23) => initCombatSession(hero(), [dummy()], { rng: createSeededSimulationRng(seed) });
const copy = value => JSON.parse(JSON.stringify(value));

it('dispatch matches direct production execution for advance, item and ability', () => {
  const direct = fresh(); const dispatched = fresh();
  processEnemyAI(direct);
  executeCombatCommand(dispatched, { kind: 'advance' });
  expect(dispatched.state.initiative.playerReady).toBe(true);
  const item = applyItemInCombat(direct, 'Малое зелье здоровья', { rng: direct.rng });
  const dispatchedItem = executeCombatCommand(dispatched, { kind: 'item', name: 'Малое зелье здоровья' });
  expect(dispatchedItem.itemUsed).toBe(item.itemUsed);
  performPlayerAction(direct, 'Огненный шар', 0);
  executeCombatCommand(dispatched, { kind: 'ability', name: 'Огненный шар', targetIndex: 0 });
  expect(snapshotCombatExecution(dispatched)).toEqual(snapshotCombatExecution(direct));
  expect(dispatched.rng.getState()).toBe(direct.rng.getState());
});

it('JSON recording replays health, cooldowns, statuses, consumed items and allied summons', () => {
  const session = fresh(); const recording = createCombatRecording(session);
  executeCombatCommand(session, { kind: 'advance' }, recording);
  executeCombatCommand(session, { kind: 'item', name: 'Малое зелье здоровья' }, recording);
  executeCombatCommand(session, { kind: 'ability', name: 'Призыв элементаля' }, recording);
  executeCombatCommand(session, { kind: 'advance' }, recording);
  executeCombatCommand(session, { kind: 'ability', name: 'Огненный шар' }, recording);
  expect(session.state.players.some(unit => unit.summoned)).toBe(true);
  expect(session.state.players[0].items).toHaveLength(0);
  expect(recording.commands.every(step => !step.state && !step.afterState)).toBe(true);
  const replay = replayCombatRecording(fresh(), copy(recording));
  expect(replay.verified).toBe(true);
  expect(snapshotCombatExecution(replay.session)).toEqual(recording.final);
});

it.each(['naive', 'random', 'strategic'])('simulator recording replays without rerunning the %s policy', policy => {
  const result = simulateCombat({ player: hero(), enemies: [dummy()], seed: 23, policy, captureRecording: true });
  const replay = replayCombatRecording(fresh(), copy(result.recording));
  expect(replay.verified).toBe(true);
  expect(replay.session.state.players[0].hp).toBe(result.player.hp);
  expect(replay.session.state.players[0].items).toEqual(result.player.items);
  expect(result.outcome).not.toBe('abnormal');
});

it('records only on request and bounds command storage before executing another action', () => {
  expect(simulateCombat({ player: hero(), enemies: [dummy()], seed: 23 }).recording).toBeUndefined();
  const session = fresh(); const recording = createCombatRecording(session, { maxCommands: 1 });
  executeCombatCommand(session, { kind: 'advance' }, recording);
  const before = snapshotCombatExecution(session);
  expect(() => executeCombatCommand(session, { kind: 'ability', name: 'Атака' }, recording)).toThrow(/limit/);
  expect(snapshotCombatExecution(session)).toEqual(before);
});

it('detects wrong initial state, corrupted steps and incompatible versions', () => {
  const session = fresh(); const recording = createCombatRecording(session);
  executeCombatCommand(session, { kind: 'advance' }, recording);
  executeCombatCommand(session, { kind: 'ability', name: 'Огненный шар' }, recording);
  expect(() => replayCombatRecording(fresh(24), recording)).toThrow(/initial/);
  const changed = copy(recording); changed.commands[1].command.name = 'Атака';
  expect(() => replayCombatRecording(fresh(), changed)).toThrow(/after command 2/);
  expect(() => replayCombatRecording(fresh(), { ...recording, version: 999 })).toThrow(/Unsupported/);
  const changedFinal = copy(recording); changedFinal.final.state.players[0].hp = 1;
  expect(() => replayCombatRecording(fresh(), changedFinal)).toThrow(/final/);
});

it('RNG restores exact stream, rejects invalid state and stays independent between sessions', () => {
  const left = createSeededSimulationRng(42); const right = createSeededSimulationRng(42);
  const saved = left.getState(); const first = left(); const second = left();
  expect(right()).toBe(first); expect(right()).toBe(second);
  left.setState(saved); expect(left()).toBe(first);
  for (const invalid of [NaN, -1, 0.1, 0x100000000]) expect(() => left.setState(invalid)).toThrow();
});

it('seeded named encounters and enemy passive hooks do not access global randomness', () => {
  const ambient = jest.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Ambient RNG used'); });
  try {
    const result = simulateCombat({ classId: 'Archer', enemyNames: ['Троглодит-заражённый'], seed: 17, policy: 'random' });
    expect(result.outcome).not.toBe('abnormal');
    const session = fresh();
    const owner = session.state.enemies[0];
    createAbilityByName('Грибной симбиоз').onTurnStart({ owner, session, log: () => {} });
    createAbilityByName('Мицелиевое восстановление').onTurnStart({ owner, session, log: () => {} });
    expect(ambient).not.toHaveBeenCalled();
  } finally { ambient.mockRestore(); }
});

it('enemy summons use deterministic IDs and replay with their subsequent actions', () => {
  const create = () => {
    const rng = createSeededSimulationRng(3);
    const foe = dummy();
    foe.abilities = [{ name: 'Test summon', damage: 0, cooldown: 4, apply: ({ session, attacker }) => session.summonEnemy('Троглодит-заражённый', { source: attacker }) }];
    foe.speed = 150;
    return initCombatSession(hero(), [foe], { rng });
  };
  const session = create(); const recording = createCombatRecording(session);
  executeCombatCommand(session, { kind: 'advance' }, recording);
  executeCombatCommand(session, { kind: 'ability', name: 'Атака' }, recording);
  executeCombatCommand(session, { kind: 'advance' }, recording);
  expect(session.state.enemies.some(unit => unit.summoned)).toBe(true);
  expect(replayCombatRecording(create(), copy(recording)).verified).toBe(true);
});


it.each(['Пепельный Колпак Рагшнар', 'Троглодит-заражённый', 'Друид-медведь'])('prepared encounter %s replays with session-only randomness', name => {
  const makePlayer = () => resolveSimulationPlayerProfile({ classId: 'Defender', profile: 'prepared' }).player;
  const ambient = jest.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Ambient RNG used'); });
  try {
    const result = simulateCombat({ player: makePlayer(), enemyNames: [name], seed: 41, policy: 'strategic', captureRecording: true });
    const rng = createSeededSimulationRng(41);
    const foe = createEnemyInstanceByName(name, { rng, idPrefix: 'simulation-0' });
    expect(foe).toBeTruthy();
    const session = initCombatSession(makePlayer(), [foe], { rng });
    expect(replayCombatRecording(session, copy(result.recording)).verified).toBe(true);
    expect(ambient).not.toHaveBeenCalled();
  } finally { ambient.mockRestore(); }
});
