// End-to-end HTTP save check against the real API/SQLite with a synthetic account.
require('./register-expedition.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createApi } = require('../server/app');
const { SqliteAccountRepository } = require('../server/accountRepository');
const { createSimulationPlayer, chooseCombatAction } = require('../src/utils/combatSimulator');
const { createExpeditionMapRun } = require('../src/utils/expeditionMapRun');
const { createSeededSimulationRng } = require('../src/utils/simulationRng');
const { createAutobattleCheckpoint, calculateAutobattle, chooseAutobattleResult } = require('../src/utils/autobattle');
const { serializePersistentGameState, getFreshPersistentGameState } = require('../src/hooks/usePersistentGameState');
const { compactExpeditionMapForSave } = require('../src/utils/expeditionMapSnapshot');

(async () => {
  const repository = new SqliteAccountRepository(':memory:');
  const server = createApi({ repository, env: { NODE_ENV: 'test', ALLOW_DEV_AUTH: 'true', SESSION_SECRET: 'synthetic-autobattle-test-secret' } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const auth = await fetch(`${base}/api/auth/dev`, { method: 'POST', body: '{}' });
    const cookie = auth.headers.get('set-cookie').split(';')[0];
    const map = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
      : createExpeditionMapRun({ locationId: 'Гоблинские Норы', templateId: 'goblin-caverns-02', rng: createSeededSimulationRng(42) });
    const expectedMap = compactExpeditionMapForSave(map);
    const player = { ...createSimulationPlayer({ classId: 'Defender' }), currentLocation: 'Гоблинские Норы', expeditionMap: map };
    const enemies = [{ id: 'dummy', name: 'Манекен', hp: 100, maxHp: 100, attack: 2, speed: 70, abilities: [] }];
    const initial = createAutobattleCheckpoint(player, enemies, false, 42);
    const review = await calculateAutobattle(initial, chooseCombatAction);
    const accepted = chooseAutobattleResult(review, 'accepted');
    const oversized = serializePersistentGameState({ ...getFreshPersistentGameState(), player, currentScreen: 'combat', activeCombat: review });
    oversized.activeCombat.state.players[0].expeditionMap = map;
    oversized.activeCombat.autobattle.result.state.players[0].expeditionMap = map;
    oversized.player.expeditionMap = map;
    const brokenBody = JSON.stringify({ save: oversized, revision: 0, schemaVersion: 7 });
    const broken = await fetch(`${base}/api/save`, { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: brokenBody });
    assert.equal(broken.status, 413);
    assert.equal((await broken.json()).error, 'payload-too-large');
    console.log('Reproduced previous failure:', broken.status, Buffer.byteLength(brokenBody), 'bytes');
    let revision = 0;
    for (const checkpoint of [initial, review, accepted]) {
      // Simulate an older client whose initial/result copies contain the full map.
      const legacy = JSON.parse(JSON.stringify(checkpoint));
      legacy.state.players[0].expeditionMap = map;
      if (legacy.autobattle.result) legacy.autobattle.result.state.players[0].expeditionMap = map;
      const save = serializePersistentGameState({ ...getFreshPersistentGameState(), player, currentScreen: 'combat', activeCombat: legacy });
      const body = JSON.stringify({ save, revision, schemaVersion: 7 });
      const response = await fetch(`${base}/api/save`, { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body });
      const result = await response.json();
      console.log(checkpoint.autobattle.phase, response.status, Buffer.byteLength(body), 'bytes');
      assert.equal(response.status, 200, JSON.stringify(result));
      assert.deepEqual(result.account.save.player.expeditionMap, expectedMap);
      assert.equal(result.account.save.activeCombat.state.players[0].expeditionMap, undefined);
      assert.equal(result.account.save.activeCombat.autobattle.result?.state.players[0].expeditionMap, undefined);
      assert.equal(result.account.save.activeCombat.autobattle.phase, checkpoint.autobattle.phase);
      revision = result.account.revision;
    }
    const restored = await (await fetch(`${base}/api/account`, { headers: { cookie } })).json();
    assert.equal(restored.account.save.activeCombat.autobattle.phase, 'accepted');
    assert.deepEqual(restored.account.save.player.expeditionMap, expectedMap);
    console.log('Verified running → review → accepted → server reload, including legacy snapshots.');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    repository.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
