// Reproducible CPU/payload benchmark; synthetic players only, no account access.
require('./register-expedition.cjs');
const fs = require('node:fs');
const { performance } = require('node:perf_hooks');
const { createSimulationPlayer, chooseCombatAction } = require('../src/utils/combatSimulator');
const { createEnemyInstanceByName, enemies } = require('../src/data/enemies');
const { createSeededSimulationRng } = require('../src/utils/simulationRng');
const { createExpeditionMapRun } = require('../src/utils/expeditionMapRun');
const { createAutobattleCheckpoint, calculateAutobattle } = require('../src/utils/autobattle');
const size = value => Buffer.byteLength(JSON.stringify(value));
const classes = ['Defender', 'Archer', 'Mage'];
const groups = [
  ['Гоблин-палач', 'Гоблин-арбалетчик', 'Крысомант из Нор'],
  ['Крысиный матриарх', 'Крысиный всадник'],
  ...enemies.filter(enemy => enemy.boss).map(enemy => [enemy.name]),
];
(async () => {
  const map = createExpeditionMapRun({ locationId: 'Гоблинские Норы', templateId: 'goblin-caverns-02', rng: createSeededSimulationRng(42) });
  const cases = [];
  for (const classId of classes) for (const names of groups) for (const seed of [1, 7, 42]) {
    const foes = names.map((name, index) => createEnemyInstanceByName(name, { rng: createSeededSimulationRng(seed + index), idPrefix: `${seed}-${index}` }));
    const player = { ...createSimulationPlayer({ classId, items: [{ name: 'Малое зелье здоровья' }] }),
      currentLocation: foes[0].location, expeditionMap: map, activeExpeditionZone: 'approach' };
    const started = performance.now();
    const checkpoint = createAutobattleCheckpoint(player, foes, foes.some(e => e.boss), seed);
    const setupMs = performance.now() - started;
    const calculating = performance.now();
    let policyMs = 0, decisions = 0;
    try {
      const review = await calculateAutobattle(checkpoint, options => {
        const start = performance.now();
        const action = chooseCombatAction(options);
        policyMs += performance.now() - start; decisions++;
        return action;
      });
      const result = review.autobattle.result;
      cases.push({ classId, names, seed, setupMs, calculationMs: performance.now() - calculating,
        policyMs, decisions, checkpointBytes: size(checkpoint), reviewBytes: size(review),
        saveBytes: size({ player, activeCombat: review }),
        outcome: review.autobattle.outcome, hp: result.state.players[0].hp, rngState: result.rngState,
        enemyHp: result.state.enemies.map(e => e.hp), items: result.state.players[0].items.map(i => i.name),
      });
    } catch (error) { cases.push({ classId, names, seed, error: error.message }); }
  }
  const successful = cases.filter(c => !c.error);
  const sorted = successful.map(c => c.calculationMs).sort((a,b) => a-b);
  const report = { environment: process.version, measured: new Date().toISOString(), cases,
    summary: { cases: cases.length, errors: cases.filter(c => c.error).length,
      medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.ceil(sorted.length * 0.95)-1],
      maxMs: sorted[sorted.length-1], maxSaveBytes: Math.max(...successful.map(c => c.saveBytes)),
    },
  };
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.summary, null, 2));
  cases.filter(c => c.error).forEach(c => console.log(JSON.stringify(c)));
  if (report.summary.errors) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
