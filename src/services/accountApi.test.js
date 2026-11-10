import { authenticateTelegram, createSerializedSaveQueue, firstSaveDifference, resolveApiBase, saveAccountState } from './accountApi';

const travelSave = step => ({ currentScreen: 'dungeon', player: {
  hp: 100, expeditionMapRoomActive: false, expeditionMap: {
    state: { selectedSublocationId: null }, pendingCellId: null,
    mainLayout: { currentCellId: `cell-${step}`, cells: Array.from({ length: 32 }, (_, i) => ({
      id: `cell-${i}`, resolved: true, visited: i <= step, revealed: i <= step + 1,
    })) },
  },
} });

test('checkpoint and its identical autosave share one write, including after acknowledgment', async () => {
  let finish;
  const write = jest.fn(request => new Promise(resolve => { finish = () => resolve({ account: { revision: request.revision + 1 } }); }));
  const queue = createSerializedSaveQueue({ write });
  const snapshot = { currentScreen: 'combat', activeCombat: { autobattle: { phase: 'running' } } };
  const committed = queue.enqueue(snapshot);
  expect(queue.enqueue(JSON.parse(JSON.stringify(snapshot)))).toBe(committed);
  await Promise.resolve();
  finish();
  await committed;
  await queue.enqueue(snapshot);
  expect(write).toHaveBeenCalledTimes(1);
  expect(queue.getRevision()).toBe(1);
});

test('an identical rejected checkpoint can be explicitly retried', async () => {
  const write = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ account: { revision: 1 } });
  const queue = createSerializedSaveQueue({ write });
  await expect(queue.enqueue({ step: 'running' })).rejects.toThrow('offline');
  await expect(queue.enqueue({ step: 'running' })).resolves.toMatchObject({ revision: 1 });
  expect(write).toHaveBeenCalledTimes(2);
});

test('rapid exploration leaves one pending travel save before an autobattle checkpoint', async () => {
  const finish = [];
  const write = jest.fn(request => new Promise(resolve => finish.push(() => resolve({ account: { revision: request.revision + 1 } }))));
  const queue = createSerializedSaveQueue({ write });
  const first = queue.enqueue(travelSave(0));
  await Promise.resolve();
  const moves = Array.from({ length: 30 }, (_, i) => queue.enqueue(travelSave(i + 1)));
  const start = queue.enqueue({ ...travelSave(30), currentScreen: 'combat', activeCombat: { autobattle: { phase: 'running' } } });
  finish.shift()(); await first; await Promise.resolve();
  expect(write).toHaveBeenCalledTimes(2);
  expect(write.mock.calls[1][0].save.player.expeditionMap.mainLayout.currentCellId).toBe('cell-30');
  finish.shift()(); await Promise.all(moves); await Promise.resolve();
  expect(write).toHaveBeenCalledTimes(3);
  expect(write.mock.calls[2][0]).toMatchObject({ revision: 2, save: { activeCombat: { autobattle: { phase: 'running' } } } });
  finish.shift()(); await start;
});

test.each(['hp', 'key', 'resolved', 'branch', 'loot', 'combat'])('travel never coalesces across a %s change', async field => {
  const write = jest.fn(async request => ({ account: { revision: request.revision + 1 } }));
  const queue = createSerializedSaveQueue({ write });
  const changed = travelSave(1);
  if (field === 'hp') changed.player.hp = 90;
  if (field === 'key') changed.player.expeditionMap.state.keys = { boss: true };
  if (field === 'resolved') changed.player.expeditionMap.mainLayout.cells[0].resolved = false;
  if (field === 'branch') changed.player.expeditionMap.state.selectedSublocationId = 'rats';
  if (field === 'loot') changed.pendingLoot = { items: ['chest'] };
  if (field === 'combat') changed.activeCombat = { autobattle: { phase: 'running' } };
  await Promise.all([queue.enqueue(travelSave(0)), queue.enqueue(changed), queue.enqueue(travelSave(2))]);
  expect(write.mock.calls.map(([r]) => r.revision)).toEqual([0, 1, 2]);
  expect(write.mock.calls[1][0].save).toEqual(changed);
});

test('a stalled response body times out and rejects the save', async () => {
  jest.useFakeTimers();
  const originalFetch = global.fetch;
  global.fetch = jest.fn((_url, { signal }) => Promise.resolve({ ok: true, status: 200,
    json: () => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
  }));
  try {
    const save = saveAccountState({ save: {}, revision: 0, schemaVersion: 1 });
    save.catch(() => {});
    await Promise.resolve();
    jest.advanceTimersByTime(20000);
    await expect(save).rejects.toMatchObject({ code: 'api-timeout' });
    expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  } finally { global.fetch = originalFetch; jest.useRealTimers(); }
});

test('serialized save queue preserves write order and monotonically advances revision', async () => {
  const calls = []; const resolvers = [];
  const write = jest.fn(request => { calls.push(request); return new Promise(resolve => resolvers.push(() => resolve({ account: { revision: request.revision + 1 } }))); });
  const queue = createSerializedSaveQueue({ initialRevision: 4, write });
  const first = queue.enqueue({ step: 1 }); const second = queue.enqueue({ step: 2 });
  await Promise.resolve();
  expect(calls).toEqual([expect.objectContaining({ save: { step: 1 }, revision: 4, schemaVersion: 1, requestId: expect.stringMatching(/^save-/) })]);
  resolvers.shift()(); await first; await Promise.resolve();
  expect(calls[1]).toEqual(expect.objectContaining({ save: { step: 2 }, revision: 5, schemaVersion: 1, requestId: expect.stringMatching(/^save-/) }));
  resolvers.shift()(); await second; expect(queue.getRevision()).toBe(6);
});

test('rapid boss completion and descent reach validation in canonical revision order', async () => {
  const { validateExpeditionTransition } = require('../../server/expeditionTransitionValidation');
  const basePlayer = { class: 'Defender', hp: 23, maxHp: 100, runSilver: 70, runResonance: 8, runInventory: [], equipment: {}, relics: {}, currentLocation: 'Гоблинские Норы' };
  let authoritative = { currentScreen: 'dungeon', player: { ...basePlayer, abyssLevel: 1, expeditionPhase: 'exploring' }, classProgression: { Defender: { cumulativeClassXp: 0 } } };
  const bossSave = { currentScreen: 'dungeon', player: { ...basePlayer, abyssLevel: 1, expeditionPhase: 'boss-defeated', bossClearId: 'boss-result-1', portalStone: { acquiredFrom: 'boss' } }, classProgression: { Defender: { cumulativeClassXp: 100 } } };
  const descentSave = { ...bossSave, currentScreen: 'levelTwoLocationSelect', player: { ...bossSave.player, abyssLevel: 2, expeditionPhase: 'level-selection', currentLocation: null, portalStone: null, roomGenerationState: { 'Лес Увядания': { completedCombatRooms: 0 } } } };
  const accepted = [];
  const queue = createSerializedSaveQueue({ initialRevision: 10, write: async request => {
    validateExpeditionTransition(request.save, authoritative);
    authoritative = request.save; accepted.push(request.save.currentScreen);
    return { account: { revision: request.revision + 1 } };
  } });
  await Promise.all([queue.enqueue(bossSave), queue.enqueue(descentSave)]);
  expect(accepted).toEqual(['dungeon', 'levelTwoLocationSelect']);
  expect(queue.getRevision()).toBe(12);
});

test('stale save invokes conflict reconciliation instead of silently overwriting', async () => {
  const onConflict = jest.fn(); const error = Object.assign(new Error('stale'), { status: 409, account: { revision: 9 } });
  const queue = createSerializedSaveQueue({ initialRevision: 2, onConflict, write: jest.fn(() => Promise.reject(error)) });
  await expect(queue.enqueue({ stale: true })).rejects.toThrow('stale');
  expect(onConflict).toHaveBeenCalledWith({ revision: 9 }); expect(queue.getRevision()).toBe(9);
});

test('replacement drops queued stale payloads and writes after an in-flight save with the latest revision', async () => {
  const calls = []; const resolvers = [];
  const write = jest.fn(request => { calls.push(request); return new Promise(resolve => resolvers.push(() => resolve({ account: { revision: request.revision + 1 } }))); });
  const queue = createSerializedSaveQueue({ initialRevision: 3, write });
  const inFlight = queue.enqueue({ step: 'in-flight' });
  const staleQueued = queue.enqueue({ step: 'stale-queued' });
  await Promise.resolve();
  const replacement = queue.replace({ step: 'fresh-reset' });
  resolvers.shift()(); await inFlight; await staleQueued; await Promise.resolve();
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual(expect.objectContaining({ save: { step: 'fresh-reset' }, revision: 4, schemaVersion: 1, requestId: expect.stringMatching(/^save-/) }));
  resolvers.shift()(); await replacement;
  expect(queue.getRevision()).toBe(5);
});

test('safe save diagnostics report only the first path and types after a wire round trip', () => {
  const wire = JSON.parse(JSON.stringify({ Defender: { classLevel: 2 } }));
  expect(firstSaveDifference(wire, { Defender: { classLevel: '2' } })).toEqual({
    path: '$.Defender.classLevel', kind: 'type', leftType: 'number', rightType: 'string',
  });
});

test('request boundary collapses a Mage sixth-skill divergence onto root progression', async () => {
  const rootProgression = { Mage: { unlockedSkillIds: ['Огненный шар', 'Цепная молния', 'Морозный щит', 'Ледяное копьё', 'Буран', 'Призыв элементаля'] } };
  const embeddedProgression = { Mage: { unlockedSkillIds: ['Огненный шар', 'Цепная молния', 'Морозный щит', 'Ледяное копьё', 'Буран', 'Грозовой разряд'] } };
  expect(firstSaveDifference(rootProgression, embeddedProgression)).toMatchObject({
    path: '$.Mage.unlockedSkillIds[5]', kind: 'value', leftType: 'string', rightType: 'string',
  });
  const write = jest.fn(async request => {
    expect(request.save.player.classProgression).toEqual(request.save.classProgression);
    expect(firstSaveDifference(request.save.classProgression, request.save.player.classProgression)).toBeNull();
    return { account: { revision: 1 } };
  });
  const queue = createSerializedSaveQueue({ write });
  await queue.enqueue({ classProgression: rootProgression, player: { class: 'Mage', classProgression: embeddedProgression } });
  expect(write).toHaveBeenCalledTimes(1);
});

test('Telegram auth preserves readable 401 invalid-hash as an HTTP error', async () => {
  const originalFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 401,
    json: jest.fn().mockResolvedValue({ error: 'invalid-hash' }),
  });
  try {
    await expect(authenticateTelegram('signed-raw')).rejects.toMatchObject({ status: 401, code: 'invalid-hash', message: 'invalid-hash' });
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/auth/telegram'), expect.objectContaining({ credentials: 'include' }));
  } finally {
    global.fetch = originalFetch;
  }
});


test('production API is always same-origin even when an external base is configured', () => {
  expect(resolveApiBase({ nodeEnv: 'production', configuredBase: 'https://ashenabyss-arthaxan.amvera.io/' })).toBe('');
});

test('development may still use an explicit API origin', () => {
  expect(resolveApiBase({ nodeEnv: 'development', configuredBase: 'http://localhost:8080/' })).toBe('http://localhost:8080');
});


test('server loadout diagnostics remain attached to a failed save request', async () => {
  const originalFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({
    error: 'invalid-class-loadout', diagnostic: { classId: 'Mage', reason: 'duplicate-skill', index: 2 },
  }) });
  try {
    await expect(authenticateTelegram('ignored')).rejects.toMatchObject({
      code: 'invalid-class-loadout', diagnostic: { classId: 'Mage', reason: 'duplicate-skill', index: 2 },
    });
  } finally { global.fetch = originalFetch; }
});

