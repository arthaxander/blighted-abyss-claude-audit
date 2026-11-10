import { createAutobattleCheckpoint, calculateAutobattle, chooseAutobattleResult } from './autobattle';
import { createSimulationPlayer, chooseCombatAction } from './combatSimulator';
import { createExpeditionMapRun } from './expeditionMapRun';
import { createSeededSimulationRng } from './simulationRng';
import { initCombatSession } from './combatUtils';
import { reviveCombatSession } from './combatHydration';
import { snapshotCombatSession } from './combatSnapshot';
import { serializePersistentGameState, getFreshPersistentGameState } from '../hooks/usePersistentGameState';

const enemies = [{ id: 'dummy', name: 'Манекен', hp: 70, maxHp: 70, attack: 2, speed: 70, abilities: [] }];
const makePlayer = () => ({ ...createSimulationPlayer({ classId: 'Defender' }),
  currentLocation: 'Гоблинские Норы',
  expeditionMap: createExpeditionMapRun({ locationId: 'Гоблинские Норы', templateId: 'goblin-caverns-02', rng: createSeededSimulationRng(42) }),
});

test('the full new map stays authoritative on the player, never inside combat snapshots', async () => {
  const player = makePlayer();
  const original = JSON.stringify(player.expeditionMap);
  const initial = createAutobattleCheckpoint(player, enemies, false, 42);
  const review = await calculateAutobattle(initial, chooseCombatAction);
  for (const activeCombat of [initial, review, chooseAutobattleResult(review, 'accepted'), chooseAutobattleResult(review, 'manual')]) {
    const save = serializePersistentGameState({ ...getFreshPersistentGameState(), player, currentScreen: 'combat', activeCombat });
    expect(JSON.stringify(save).length).toBeLessThan(500000);
    expect(JSON.stringify(save.player.expeditionMap)).toBe(original);
    expect(save.activeCombat.state.players[0].expeditionMap).toBeUndefined();
    expect(save.activeCombat.autobattle.result?.state.players[0].expeditionMap).toBeUndefined();
  }
  expect(JSON.stringify(player.expeditionMap)).toBe(original);
});

test('legacy running/review/result snapshots compact on resume and save without losing combat state', async () => {
  const player = makePlayer();
  const initial = createAutobattleCheckpoint(player, enemies, false, 42);
  const review = await calculateAutobattle(initial, chooseCombatAction);
  const legacy = JSON.parse(JSON.stringify(review));
  legacy.state.players[0].expeditionMap = player.expeditionMap;
  legacy.autobattle.result.state.players[0].expeditionMap = player.expeditionMap;
  const revived = reviveCombatSession(legacy, player, enemies);
  expect(revived.state.players[0].expeditionMap).toBeUndefined();
  expect(revived.state.players[0].hp).toBe(initial.state.players[0].hp);
  const save = serializePersistentGameState({ ...getFreshPersistentGameState(), player, activeCombat: legacy });
  expect(save.activeCombat).toEqual(review);
  expect(legacy.state.players[0].expeditionMap).toBe(player.expeditionMap);
});

test('manual combat finalization also excludes redundant map copies in battleResult', () => {
  const player = makePlayer();
  const session = initCombatSession(player, enemies);
  expect(session.state.players[0].expeditionMap).toBeUndefined();
  const snapshot = snapshotCombatSession(session, { battleResult: { playerState: player, outcome: 'victory' } });
  expect(snapshot.battleResult.playerState.expeditionMap).toBeUndefined();
  expect(snapshot.battleResult.playerState.hp).toBe(player.hp);
});
