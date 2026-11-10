import { initCombatSession, checkBattleOutcome } from './combatUtils';
import { executeCombatCommand } from './combatExecution';
import { snapshotCombatSession, sanitizeForCombatSnapshot } from './combatSnapshot';
import { reviveCombatSession } from './combatHydration';
import { createSeededSimulationRng } from './simulationRng';

export const AUTOBATTLE_VERSION = 1;
export const AUTOBATTLE_COMMAND_LIMIT = 1000;

export const createAutobattleCheckpoint = (player, enemies, isBoss, seed) => {
  const session = initCombatSession(player, enemies, { rng: createSeededSimulationRng(seed) });
  return {
    ...snapshotCombatSession(session, { isBoss }),
    autobattle: { version: AUTOBATTLE_VERSION, phase: 'running' },
  };
};

// No rewards or inventory writes: the initial checkpoint remains untouched.
export const calculateAutobattle = async (checkpoint, chooseAction, yieldFrame = () => new Promise(resolve => setTimeout(resolve, 0)), onProgress = null) => {
  checkpoint = sanitizeForCombatSnapshot(checkpoint);
  const session = reviveCombatSession(checkpoint);
  if (!session) throw new Error('Missing initial combat');
  const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
  let deadline = now() + 8;
  for (let count = 0; count < AUTOBATTLE_COMMAND_LIMIT; count += 1) {
    const outcome = checkBattleOutcome(session);
    if (outcome.victory || outcome.defeat) {
      return { ...checkpoint, autobattle: {
        version: AUTOBATTLE_VERSION, phase: 'review',
        outcome: outcome.defeat ? 'defeat' : 'victory',
        result: snapshotCombatSession(session, { isBoss: checkpoint.isBoss }),
      } };
    }
    if (!session.state.initiative?.playerReady) {
      executeCombatCommand(session, { kind: 'advance' });
    } else {
      const action = chooseAction({ session, policy: 'boss_aware', rng: session.rng });
      if (!action) throw new Error('No legal autobattle action');
      const result = executeCombatCommand(session, {
        kind: action.kind,
        name: action.kind === 'item' ? action.itemName : action.ability.name,
        targetIndex: action.targetIndex,
      });
      if (!result.turnConsumed && !result.itemUsed) throw new Error('Autobattle action made no progress');
    }
    // Bound diagnostics in saved checkpoints and yield to keep the screen responsive.
    if (session.state.log.length > 120) session.state.log.splice(0, session.state.log.length - 120);
    // Yield by elapsed CPU time rather than pausing every twenty commands.
    // Short fights finish in one slice; slower devices still get paint/input.
    if (now() >= deadline) {
      onProgress?.(count + 1);
      await yieldFrame();
      deadline = now() + 8;
    }
  }
  throw new Error('Autobattle command limit reached');
};

export const chooseAutobattleResult = (checkpoint, choice) => {
  if (!['running', 'review'].includes(checkpoint?.autobattle?.phase)) throw new Error('Autobattle choice already made');
  if (!['manual', 'accepted'].includes(choice)) throw new Error('Invalid autobattle choice');
  if (choice === 'accepted' && checkpoint.autobattle.phase !== 'review') throw new Error('No completed autobattle');
  const snapshot = choice === 'accepted' ? checkpoint.autobattle.result : checkpoint;
  return { ...snapshot, autobattle: { version: AUTOBATTLE_VERSION, phase: choice } };
};

export const getAutobattleConsumables = checkpoint => {
  const counts = items => (items || []).reduce((result, item) => {
    const name = typeof item === 'string' ? item : item.name;
    result[name] = (result[name] || 0) + 1;
    return result;
  }, {});
  const initial = counts(checkpoint.state.players[0].items);
  const final = counts(checkpoint.autobattle.result?.state.players[0].items);
  return Object.entries(initial).map(([name, count]) => ({ name, count: count - (final[name] || 0) })).filter(item => item.count > 0);
};

