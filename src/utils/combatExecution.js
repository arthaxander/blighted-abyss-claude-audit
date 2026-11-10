import { applyItemInCombat, checkBattleOutcome, performPlayerAction, processEnemyAI } from './combatUtils';
import { sanitizeForCombatSnapshot } from './combatSnapshot';

export const COMBAT_RECORDING_VERSION = 1;
export const MAX_RECORDED_COMMANDS = 2000;

// Diagnostic state only: functions and cyclic runtime references are restored
// by the caller's normal session factory, not deserialized from a recording.
export const snapshotCombatExecution = session => {
  const snapshot = sanitizeForCombatSnapshot(session);
  if (!snapshot?.state) throw new Error('Combat session is required');
  delete snapshot.state.log;
  delete snapshot.state.metrics; // includes simulator-only analytics
  (snapshot.state.players || []).forEach(unit => delete unit._lastSimulationAbilityId);
  return snapshot;
};

const canonicalJson = value => JSON.stringify(value, (_key, entry) => {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
  return Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]]));
});

// Two small checksums locate divergence without retaining a full state per turn.
// This is a debugging checksum, not a security or save-authentication mechanism.
const checksum = snapshot => {
  const text = canonicalJson(snapshot);
  let a = 2166136261; let b = 5381;
  for (let index = 0; index < text.length; index += 1) {
    a = Math.imul(a ^ text.charCodeAt(index), 16777619);
    b = Math.imul(b, 33) ^ text.charCodeAt(index);
  }
  return `${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`;
};

const requireStatefulRng = session => {
  if (typeof session?.rng?.getState !== 'function' || typeof session?.rng?.setState !== 'function') {
    throw new Error('Combat recording requires a stateful session RNG');
  }
  return session.rng;
};

const normalizeCommand = command => {
  if (command?.kind === 'advance') return { kind: 'advance' };
  if (!['ability', 'item'].includes(command?.kind) || typeof command.name !== 'string' || !command.name) {
    throw new Error('Invalid combat command');
  }
  const targetIndex = command.targetIndex ?? 0;
  if (!Number.isInteger(targetIndex) || targetIndex < 0) throw new Error('Invalid combat target index');
  return { kind: command.kind, name: command.name, targetIndex };
};

export const createCombatRecording = (session, { maxCommands = MAX_RECORDED_COMMANDS } = {}) => {
  const rng = requireStatefulRng(session);
  if (!Number.isInteger(maxCommands) || maxCommands < 1 || maxCommands > MAX_RECORDED_COMMANDS) {
    throw new Error('Invalid combat recording limit');
  }
  const initial = snapshotCombatExecution(session);
  return {
    version: COMBAT_RECORDING_VERSION, maxCommands, initial,
    initialRngState: rng.getState(), commands: [], final: initial,
    finalRngState: rng.getState(), outcome: checkBattleOutcome(session),
  };
};

// UI, simulator and future autobattle all dispatch through these same commands.
// Legality and turn consumption remain the responsibility of production combat.
export const executeCombatCommand = (session, input, recording = null) => {
  const command = normalizeCommand(input);
  let before; let rng;
  if (recording) {
    rng = requireStatefulRng(session);
    if (recording.commands.length >= recording.maxCommands) throw new Error('Combat recording limit exceeded');
    before = { checksum: checksum(snapshotCombatExecution(session)), rngState: rng.getState() };
  }
  const result = command.kind === 'advance'
    ? processEnemyAI(session)
    : command.kind === 'item'
      ? applyItemInCombat(session, command.name, { targetIndex: command.targetIndex, rng: session.rng })
      : performPlayerAction(session, command.name, command.targetIndex);
  if (recording) {
    const after = snapshotCombatExecution(session);
    recording.commands.push({ command, before, afterChecksum: checksum(after), rngAfter: rng.getState() });
    recording.final = after;
    recording.finalRngState = rng.getState();
    recording.outcome = checkBattleOutcome(session);
  }
  return result;
};

// Supply a freshly initialized session from the same scenario and engine
// revision. No policy is rerun: policy RNG draws are represented by rngState.
export const replayCombatRecording = (session, recording) => {
  const rng = requireStatefulRng(session);
  if (recording?.version !== COMBAT_RECORDING_VERSION || !Array.isArray(recording.commands) || recording.commands.length > MAX_RECORDED_COMMANDS) {
    throw new Error('Unsupported combat recording');
  }
  if (canonicalJson(snapshotCombatExecution(session)) !== canonicalJson(recording.initial) || rng.getState() !== recording.initialRngState) {
    throw new Error('Combat replay initial state mismatch');
  }
  recording.commands.forEach((step, index) => {
    if (checksum(snapshotCombatExecution(session)) !== step.before.checksum) {
      throw new Error(`Combat replay diverged before command ${index + 1}`);
    }
    rng.setState(step.before.rngState);
    executeCombatCommand(session, step.command);
    if (rng.getState() !== step.rngAfter || checksum(snapshotCombatExecution(session)) !== step.afterChecksum) {
      throw new Error(`Combat replay diverged after command ${index + 1}`);
    }
  });
  if (canonicalJson(snapshotCombatExecution(session)) !== canonicalJson(recording.final) || rng.getState() !== recording.finalRngState) {
    throw new Error('Combat replay final state mismatch');
  }
  return { session, outcome: checkBattleOutcome(session), commands: recording.commands.length, verified: true };
};
